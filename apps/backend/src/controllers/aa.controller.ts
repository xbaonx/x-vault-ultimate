import { Request, Response } from 'express';
import { ethers } from 'ethers';
import cbor from 'cbor';
import { randomUUID } from 'crypto';
import { AppDataSource } from '../data-source';
import { Device } from '../entities/Device';
import { User } from '../entities/User';
import { Transaction } from '../entities/Transaction';
import { Wallet } from '../entities/Wallet';
import { config } from '../config';
import { ProviderService } from '../services/provider.service';
import { PaymasterController } from './paymaster.controller';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { TokenPriceService } from '../services/token-price.service';

const ENTRYPOINT_ABI = [
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
  'function getNonce(address sender, uint192 key) view returns (uint256)'
];

const XFACTORY_ABI = [
  'function getAddress(uint256 publicKeyX, uint256 publicKeyY, uint256 salt) view returns (address)'
];

const XACCOUNT_ABI = [
  'function execute(address dest, uint256 value, bytes func)',
  'function executeBatch(address[] dest, uint256[] value, bytes[] func)'
];

 const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)'
 ];

 const GAS_FEE_BPS = 30n; // 0.3%
 const PLATFORM_FEE_BPS = 50n; // 0.5%
 const BPS_DENOM = 10_000n;

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(data: string): Buffer {
  const pad = data.length % 4 === 0 ? '' : '='.repeat(4 - (data.length % 4));
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function parseDerEcdsaSignature(signatureDer: Buffer): { r: bigint; s: bigint } {
  // Basic DER parser for ECDSA signature: 30 len 02 lenR R 02 lenS S
  if (signatureDer.length < 8 || signatureDer[0] !== 0x30) {
    throw new Error('Invalid DER signature');
  }

  let offset = 2;
  if (signatureDer[offset] !== 0x02) throw new Error('Invalid DER signature');
  const lenR = signatureDer[offset + 1];
  const rBytes = signatureDer.subarray(offset + 2, offset + 2 + lenR);
  offset = offset + 2 + lenR;

  if (signatureDer[offset] !== 0x02) throw new Error('Invalid DER signature');
  const lenS = signatureDer[offset + 1];
  const sBytes = signatureDer.subarray(offset + 2, offset + 2 + lenS);

  const r = BigInt('0x' + rBytes.toString('hex'));
  const s = BigInt('0x' + sBytes.toString('hex'));

  return { r, s };
}

function decodeP256PublicKeyXY(cosePublicKey: Buffer): { x: bigint; y: bigint } {
  const decoded = cbor.decodeFirstSync(cosePublicKey);

  const xBuf: Buffer | undefined = decoded.get ? decoded.get(-2) : decoded[-2];
  const yBuf: Buffer | undefined = decoded.get ? decoded.get(-3) : decoded[-3];

  if (!xBuf || !yBuf) {
    throw new Error('Failed to decode P-256 COSE public key');
  }

  return {
    x: BigInt('0x' + xBuf.toString('hex')),
    y: BigInt('0x' + yBuf.toString('hex')),
  };
}

export class AaController {
  static async getAccount(req: Request, res: Response) {
    try {
      const user = (req as any).user as User;
      const device = (req as any).device as Device;

      if (!user || !device) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!device.credentialPublicKey) {
        return res.status(400).json({ error: 'Device has no passkey registered' });
      }

      const chainId = Number((req.query.chainId as string) || config.blockchain.chainId);
      const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId) || config.blockchain.chains.base;
      const factoryAddress = config.blockchain.aa.factoryAddress(chainConfig.chainId);
      const entryPointAddress = config.blockchain.aa.entryPointAddress(chainConfig.chainId);

      if (!factoryAddress) {
        return res.status(500).json({ error: 'FACTORY_ADDRESS not configured (universal mode)' });
      }

      if (!entryPointAddress) {
        return res.status(500).json({ error: `ENTRY_POINT_ADDRESS_${chainConfig.chainId} not configured` });
      }

      const { x, y } = decodeP256PublicKeyXY(device.credentialPublicKey);

      const provider = ProviderService.getProvider(chainConfig.chainId);

      const factoryCode = await provider.getCode(factoryAddress);
      if (!factoryCode || factoryCode === '0x') {
        return res.status(500).json({
          error: 'AA Factory not deployed',
          details: `chainId=${chainConfig.chainId} address=${factoryAddress}`,
        });
      }

      const factory = new ethers.Contract(factoryAddress, XFACTORY_ABI, provider);

      const walletRepo = AppDataSource.getRepository(Wallet);
      const walletId = (req.query.walletId as string) || '';
      const wallet = walletId
        ? await walletRepo.findOne({ where: { id: walletId, user: { id: user.id } } })
        : await walletRepo.findOne({ where: { user: { id: user.id }, isActive: true } });

      const salt = Number(wallet?.aaSalt ?? 0);
      const address = await factory['getAddress(uint256,uint256,uint256)'](x, y, salt);

      res.status(200).json({
        address,
        chainId: chainConfig.chainId,
        entryPoint: entryPointAddress,
        factory: factoryAddress,
        publicKeyX: x.toString(),
        publicKeyY: y.toString(),
        salt,
      });
    } catch (e: any) {
      console.error('[AA] getAccount error:', e);
      res.status(500).json({ error: e.message || 'Internal server error' });
    }
  }

  static async getUserOpOptions(req: Request, res: Response) {
    try {
      const user = (req as any).user as User;
      const device = (req as any).device as Device;

      if (!user || !device) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!device.credentialPublicKey) {
        return res.status(400).json({ error: 'Device has no passkey registered' });
      }

      const { transaction, spendingPin } = req.body;
      if (!transaction?.to) {
        return res.status(400).json({ error: 'Missing transaction.to' });
      }

      const chainId = Number(transaction.chainId || config.blockchain.chainId);
      const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId) || config.blockchain.chains.base;

      const factoryAddress = config.blockchain.aa.factoryAddress(chainConfig.chainId);
      const entryPointAddress = config.blockchain.aa.entryPointAddress(chainConfig.chainId);
      const bundlerUrl = config.blockchain.aa.bundlerUrl(chainConfig.chainId);

      if (!factoryAddress) {
        return res.status(500).json({ error: 'FACTORY_ADDRESS not configured (universal mode)' });
      }

      if (!entryPointAddress) {
        return res.status(500).json({ error: `ENTRY_POINT_ADDRESS_${chainConfig.chainId} not configured` });
      }

      if (!bundlerUrl) {
        return res.status(500).json({ error: `BUNDLER_URL_${chainConfig.chainId} not configured` });
      }

      const provider = ProviderService.getProvider(chainConfig.chainId);

      const factoryCode = await provider.getCode(factoryAddress);
      if (!factoryCode || factoryCode === '0x') {
        return res.status(500).json({
          error: 'AA Factory not deployed',
          details: `chainId=${chainConfig.chainId} address=${factoryAddress}`,
        });
      }

      const { x, y } = decodeP256PublicKeyXY(device.credentialPublicKey);
      const factory = new ethers.Contract(factoryAddress, XFACTORY_ABI, provider);

      const walletRepo = AppDataSource.getRepository(Wallet);
      const walletId = String(transaction.walletId || '');
      const wallet = walletId
        ? await walletRepo.findOne({ where: { id: walletId, user: { id: user.id } } })
        : await walletRepo.findOne({ where: { user: { id: user.id }, isActive: true } });

      const salt = Number(wallet?.aaSalt ?? 0);
      const sender = await factory['getAddress(uint256,uint256,uint256)'](x, y, salt);

      const code = await provider.getCode(sender);
      const isDeployed = code && code !== '0x';

      const ifaceFactory = new ethers.Interface([
        'function createAccount(uint256 publicKeyX, uint256 publicKeyY, uint256 salt)'
      ]);

      const initCode = isDeployed
        ? '0x'
        : ethers.concat([
            factoryAddress,
            ifaceFactory.encodeFunctionData('createAccount', [x, y, salt])
          ]);

      const entryPoint = new ethers.Contract(entryPointAddress, ENTRYPOINT_ABI, provider);
      const nonce = isDeployed ? await entryPoint.getNonce(sender, 0) : 0n;

      const accountInterface = new ethers.Interface(XACCOUNT_ABI);

      const treasuryAddress = config.blockchain.aa.treasuryAddress(chainConfig.chainId);
      const isNative = Boolean(transaction.isNative) || (String(transaction.data || '0x') === '0x' && BigInt(transaction.value || 0) > 0n);
      const assetSymbol = String(transaction.assetSymbol || (isNative ? chainConfig.symbol : 'ERC20'));
      const decimals = Number(transaction.decimals || 18);

      const feeBreakdown: any = {
        assetSymbol,
        gasFeeBps: Number(GAS_FEE_BPS),
        platformFeeBps: Number(PLATFORM_FEE_BPS),
        gasFee: '0',
        platformFee: '0',
        platformFeeChargedOnChain: false,
        platformFeeChargedUsdZ: false,
        netAmount: '0',
        treasury: treasuryAddress || ''
      };

      if (!treasuryAddress || !ethers.isAddress(treasuryAddress)) {
        return res.status(500).json({ error: `TREASURY_ADDRESS_${chainConfig.chainId} not configured` });
      }

      const usdzBalance = Number(user.usdzBalance || 0);

      let callData: string;

      if (isNative) {
        const grossWei = BigInt(transaction.value || 0);
        const gasFeeWei = (grossWei * GAS_FEE_BPS) / BPS_DENOM;
        const platformFeeWei = (grossWei * PLATFORM_FEE_BPS) / BPS_DENOM;

        let platformFeeOnChainWei = 0n;
        if (platformFeeWei > 0n) {
          const price = await TokenPriceService.getUsdPrice({
            chainId: chainConfig.chainId,
            address: TokenPriceService.nativeAddressKey(),
          });
          const platformFeeUsd = parseFloat(ethers.formatEther(platformFeeWei)) * (price || 0);
          feeBreakdown.platformFeeUsd = platformFeeUsd;
          if (platformFeeUsd > 0 && usdzBalance >= platformFeeUsd) {
            feeBreakdown.platformFeeChargedUsdZ = true;
          } else {
            platformFeeOnChainWei = platformFeeWei;
            feeBreakdown.platformFeeChargedOnChain = true;
          }
        }

        const feeWei = gasFeeWei + platformFeeOnChainWei;

        const netWei = grossWei - gasFeeWei - platformFeeOnChainWei;
        if (netWei < 0n) {
          return res.status(400).json({ error: 'Amount too small for fees' });
        }

        feeBreakdown.gasFee = gasFeeWei.toString();
        feeBreakdown.platformFee = platformFeeWei.toString();
        feeBreakdown.netAmount = netWei.toString();
        if (!feeBreakdown.platformFeeChargedUsdZ) {
          feeBreakdown.platformFeeChargedOnChain = platformFeeWei > 0n;
        }

        callData = accountInterface.encodeFunctionData('executeBatch', [
          [transaction.to, treasuryAddress],
          [netWei, feeWei],
          ['0x', '0x']
        ]);
      } else {
        // ERC20 transfer detection
        const erc20 = new ethers.Interface(ERC20_ABI);
        let decoded: any;
        try {
          decoded = erc20.parseTransaction({ data: transaction.data || '0x' });
        } catch {
          decoded = undefined;
        }

        if (!decoded || decoded.name !== 'transfer') {
          return res.status(400).json({ error: 'Only ERC20 transfer transactions are supported' });
        } else {
          const recipient = decoded.args[0] as string;
          const gross = BigInt(decoded.args[1]);
          const gasFee = (gross * GAS_FEE_BPS) / BPS_DENOM;
          const platformFee = (gross * PLATFORM_FEE_BPS) / BPS_DENOM;

          let platformFeeOnChain = 0n;
          if (platformFee > 0n) {
            const tokenAmount = Number(ethers.formatUnits(platformFee, decimals));
            const tokenAddress = String(transaction.to || '').trim().toLowerCase();
            const price = tokenAddress && tokenAddress.startsWith('0x')
              ? await TokenPriceService.getUsdPrice({ chainId: chainConfig.chainId, address: tokenAddress })
              : 0;
            const platformFeeUsd = tokenAmount * (price || 0);
            feeBreakdown.platformFeeUsd = platformFeeUsd;
            if (platformFeeUsd > 0 && usdzBalance >= platformFeeUsd) {
              feeBreakdown.platformFeeChargedUsdZ = true;
            } else {
              platformFeeOnChain = platformFee;
              feeBreakdown.platformFeeChargedOnChain = true;
            }
          }

          const fee = gasFee + platformFeeOnChain;

          const net = gross - gasFee - platformFeeOnChain;
          if (net < 0n) {
            return res.status(400).json({ error: 'Amount too small for fees' });
          }

          feeBreakdown.gasFee = gasFee.toString();
          feeBreakdown.platformFee = platformFee.toString();
          feeBreakdown.netAmount = net.toString();

          if (!feeBreakdown.platformFeeChargedUsdZ) {
            feeBreakdown.platformFeeChargedOnChain = platformFeeOnChain > 0n;
          }

          const onChainFee = fee;
          const tokenAddress = transaction.to;
          const transferNet = erc20.encodeFunctionData('transfer', [recipient, net]);
          const transferFee = erc20.encodeFunctionData('transfer', [treasuryAddress, onChainFee]);

          callData = accountInterface.encodeFunctionData('executeBatch', [
            [tokenAddress, tokenAddress],
            [0n, 0n],
            [transferNet, transferFee]
          ]);
        }
      }

      const userOp: any = {
        sender,
        nonce,
        initCode,
        callData,
        callGasLimit: BigInt(transaction.callGasLimit || 800_000),
        verificationGasLimit: 1_000_000n,
        preVerificationGas: 60_000n,
        maxFeePerGas: BigInt(transaction.maxFeePerGas || 0),
        maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas || 0),
        paymasterAndData: '0x',
        signature: '0x'
      };

      // If user didn't specify fees, estimate basic EIP-1559
      if (userOp.maxFeePerGas === 0n || userOp.maxPriorityFeePerGas === 0n) {
        const fee = await provider.getFeeData();
        userOp.maxFeePerGas = fee.maxFeePerGas ?? 0n;
        userOp.maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 0n;
      }

      // Attach paymaster sponsorship BEFORE computing userOpHash/challenge.
      // userOpHash includes hash(paymasterAndData), so paymasterAndData must be final here.
      try {
        const sponsor = await PaymasterController.sponsorUserOperationInternal({
          userOp,
          chainId: chainConfig.chainId,
          user,
          device,
          spendingPin,
          salt,
        });

        if (sponsor.statusCode !== 200) {
          return res.status(sponsor.statusCode).json(sponsor.body);
        }

        if (sponsor.body?.paymasterAndData && sponsor.body.paymasterAndData !== '0x') {
          userOp.paymasterAndData = sponsor.body.paymasterAndData;
        }
      } catch (e: any) {
        console.warn('[AA] paymaster sponsorship error:', e);
      }

      const userOpHash: string = await entryPoint.getUserOpHash(userOp);
      const challenge = base64UrlEncode(Buffer.from(userOpHash.slice(2), 'hex'));

      // Store challenge for WebAuthn verification in /userop/send
      device.currentChallenge = challenge;
      if (AppDataSource.isInitialized) {
        await AppDataSource.getRepository(Device).save(device);
      }

      if (AppDataSource.isInitialized) {
        try {
          const txRepo = AppDataSource.getRepository(Transaction);
          const userEntity = (req as any).user as User;
          const quoteId = `quote-${randomUUID()}`;
          const quoteTx = txRepo.create({
            userOpHash: quoteId,
            network: chainConfig.name,
            status: 'quote',
            value: String(transaction.value || '0'),
            asset: assetSymbol,
            user: userEntity,
            userId: userEntity.id,
            txData: {
              type: 'aa_quote',
              chainId: chainConfig.chainId,
              sender: userOp.sender,
              callData: userOp.callData,
              walletId: wallet?.id || null,
              challenge,
              fee: feeBreakdown,
              tx: {
                to: transaction.to,
                data: transaction.data || '0x',
                value: String(transaction.value || '0'),
                isNative: Boolean(isNative),
                decimals,
                assetSymbol,
              },
            },
          });
          await txRepo.save(quoteTx);
        } catch {
        }
      }

      res.status(200).json({
        sender,
        isDeployed,
        chainId: chainConfig.chainId,
        entryPoint: entryPointAddress,
        bundlerUrl,
        challenge,
        userOp,
        fee: feeBreakdown,
        walletId: wallet?.id || null,
        salt,
      });
    } catch (e: any) {
      console.error('[AA] getUserOpOptions error:', e);
      res.status(500).json({ error: e.message || 'Internal server error' });
    }
  }

  static async sendUserOperation(req: Request, res: Response) {
    try {
      const { userOp, assertion } = req.body;
      if (!userOp || !assertion) {
        return res.status(400).json({ error: 'Missing userOp or assertion' });
      }

      const user = (req as any).user as User;
      const device = (req as any).device as Device;
      if (!user || !device || !device.currentChallenge) {
        return res.status(400).json({ error: 'Device or challenge not found' });
      }

      if (!device.credentialPublicKey) {
        return res.status(400).json({ error: 'Device has no passkey registered' });
      }

      const chainId = Number(req.body.chainId || config.blockchain.chainId);
      const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId) || config.blockchain.chains.base;
      const provider = ProviderService.getProvider(chainConfig.chainId);

      const entryPointAddress = config.blockchain.aa.entryPointAddress(chainConfig.chainId);
      const bundlerUrl = config.blockchain.aa.bundlerUrl(chainConfig.chainId);
      const factoryAddress = config.blockchain.aa.factoryAddress(chainConfig.chainId);
      const paymasterAddress = config.blockchain.aa.paymasterAddress(chainConfig.chainId);

      if (!entryPointAddress) {
        return res.status(500).json({ error: `ENTRY_POINT_ADDRESS_${chainConfig.chainId} not configured` });
      }

      if (!bundlerUrl) {
        return res.status(500).json({ error: `BUNDLER_URL_${chainConfig.chainId} not configured` });
      }

      if (!factoryAddress) {
        return res.status(500).json({ error: `FACTORY_ADDRESS_${chainConfig.chainId} not configured` });
      }

      // Enforce that sender is the AA address derived from this device + selected wallet aaSalt.
      try {
        const walletRepo = AppDataSource.getRepository(Wallet);
        const walletId = String((req.body as any)?.walletId || '');
        const wallet = walletId
          ? await walletRepo.findOne({ where: { id: walletId, user: { id: user.id } } })
          : await walletRepo.findOne({ where: { user: { id: user.id }, isActive: true } });
        const salt = Number(wallet?.aaSalt ?? 0);

        const { x, y } = decodeP256PublicKeyXY(device.credentialPublicKey);
        const factory = new ethers.Contract(factoryAddress, XFACTORY_ABI, provider);
        const expectedSender = await factory['getAddress(uint256,uint256,uint256)'](x, y, salt);

        if (String(expectedSender).toLowerCase() !== String(userOp.sender || '').toLowerCase()) {
          return res.status(403).json({ error: 'Sender does not match passkey-derived AA address' });
        }

        // If initCode is present (counterfactual deploy), it must be a call to our factory.
        const initCode = String(userOp.initCode || '0x');
        if (initCode !== '0x') {
          const factoryPrefix = String(factoryAddress).toLowerCase();
          const initPrefix = initCode.slice(0, 2 + 40).toLowerCase();
          if (initPrefix !== `0x${factoryPrefix.replace(/^0x/, '')}`) {
            return res.status(400).json({ error: 'Invalid initCode factory prefix' });
          }
        }

        // If userOp uses a paymaster, it must be ours.
        const pnd = String(userOp.paymasterAndData || '0x');
        if (pnd !== '0x') {
          if (!paymasterAddress) {
            return res.status(400).json({ error: 'Paymaster not configured for this chain' });
          }
          const pfx = pnd.slice(0, 2 + 40).toLowerCase();
          const expectedPfx = `0x${String(paymasterAddress).toLowerCase().replace(/^0x/, '')}`;
          if (pfx !== expectedPfx) {
            return res.status(400).json({ error: 'Invalid paymasterAndData prefix' });
          }
        }
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || 'AA sender validation failed' });
      }

      const entryPoint = new ethers.Contract(entryPointAddress, ENTRYPOINT_ABI, provider);

      // Ensure signature empty for hash
      const userOpForHash = { ...userOp, signature: '0x' };
      const userOpHash: string = await entryPoint.getUserOpHash(userOpForHash);
      const expectedChallenge = base64UrlEncode(Buffer.from(userOpHash.slice(2), 'hex'));

      // Verify Passkey Assertion (defense in depth; contract also verifies)
      try {
        const verification = await verifyAuthenticationResponse({
          response: assertion,
          expectedChallenge: device.currentChallenge,
          expectedOrigin: config.security.origin,
          expectedRPID: config.security.rpId,
          credential: {
            id: device.credentialID,
            publicKey: new Uint8Array(device.credentialPublicKey),
            counter: Number(device.counter || 0),
          },
        } as any);

        if (!verification.verified) {
          return res.status(401).json({ error: 'Invalid passkey assertion' });
        }

        device.counter = verification.authenticationInfo.newCounter;
        device.currentChallenge = '';
        if (AppDataSource.isInitialized) {
          await AppDataSource.getRepository(Device).save(device);
        }
      } catch (e) {
        return res.status(401).json({ error: 'Passkey verification failed' });
      }

      let quoteTx: Transaction | null = null;
      if (AppDataSource.isInitialized) {
        try {
          const txRepo = AppDataSource.getRepository(Transaction);
          const userEntity = (req as any).user as User;
          quoteTx = await txRepo
            .createQueryBuilder('t')
            .where('t.userId = :uid', { uid: userEntity.id })
            .andWhere('t.status = :status', { status: 'quote' })
            .andWhere("t.txData->>'challenge' = :challenge", { challenge: expectedChallenge })
            .orderBy('t.createdAt', 'DESC')
            .getOne();

          const fee = (quoteTx as any)?.txData?.fee;
          const platformFeeUsd = Number(fee?.platformFeeUsd || 0);
          const wantsUsdZ = Boolean(fee?.platformFeeChargedUsdZ);
          if (wantsUsdZ && platformFeeUsd > 0) {
            const currentUsdZ = Number(userEntity.usdzBalance || 0);
            if (currentUsdZ < platformFeeUsd) {
              return res.status(402).json({
                error: 'Insufficient USDZ for platform fee; re-quote required',
                requiredUsd: platformFeeUsd,
                usdzBalance: currentUsdZ,
              });
            }

            userEntity.usdzBalance = Math.max(0, currentUsdZ - platformFeeUsd);
            await AppDataSource.getRepository(User).save(userEntity);
          }
        } catch {
          quoteTx = null;
        }
      }

      const clientDataJSON = base64UrlDecode(assertion.response.clientDataJSON);
      const authData = base64UrlDecode(assertion.response.authenticatorData);
      const sigDer = base64UrlDecode(assertion.response.signature);

      const idx = clientDataJSON.indexOf(Buffer.from(expectedChallenge, 'utf8'));
      if (idx < 0) {
        return res.status(400).json({ error: 'Challenge mismatch' });
      }

      const clientPrefix = clientDataJSON.subarray(0, idx);
      const clientSuffix = clientDataJSON.subarray(idx + expectedChallenge.length);

      const { r, s } = parseDerEcdsaSignature(sigDer);

      const coder = ethers.AbiCoder.defaultAbiCoder();
      const encodedSig = coder.encode(
        ['uint256', 'uint256', 'bytes', 'bytes', 'bytes'],
        [r, s, authData, clientPrefix, clientSuffix]
      );

      userOp.signature = encodedSig;

      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendUserOperation',
        params: [userOp, entryPointAddress]
      };

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 6000);
      const resp = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).finally(() => clearTimeout(id));

      const json = await resp.json();
      if (json.error) {
        return res.status(400).json({ error: json.error.message || 'Bundler error', details: json.error });
      }

      const sentUserOpHash = json.result;

      // Save transaction record
      if (AppDataSource.isInitialized) {
        const txRepo = AppDataSource.getRepository(Transaction);
        const userEntity = (req as any).user as User;

        try {
          if (quoteTx) {
            quoteTx.userOpHash = sentUserOpHash;
            quoteTx.status = 'pending';
            quoteTx.network = chainConfig.name;
            quoteTx.txData = {
              ...(quoteTx.txData || {}),
              type: 'aa',
              chainId: chainConfig.chainId,
              sender: userOp.sender,
              callData: userOp.callData,
              walletId: (req.body as any)?.walletId || (quoteTx as any)?.txData?.walletId || null,
            };
            await txRepo.save(quoteTx);
          } else {
            const newTx = txRepo.create({
              userOpHash: sentUserOpHash,
              network: chainConfig.name,
              status: 'pending',
              value: '0',
              asset: chainConfig.symbol,
              user: userEntity,
              userId: userEntity.id,
              txData: { type: 'aa', chainId: chainConfig.chainId, sender: userOp.sender, callData: userOp.callData, walletId: (req.body as any)?.walletId || null }
            });
            await txRepo.save(newTx);
          }
        } catch (e) {
          console.warn('[AA] Failed to save tx record:', e);
        }
      }

      res.status(200).json({ success: true, userOpHash: sentUserOpHash });
    } catch (e: any) {
      console.error('[AA] sendUserOperation error:', e);
      res.status(500).json({ error: e.message || 'Internal server error' });
    }
  }
}
