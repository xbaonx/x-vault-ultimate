import { Request, Response } from 'express';
import { ethers } from 'ethers';
import cbor from 'cbor';
import { MoreThan } from 'typeorm';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { Device } from '../entities/Device';
import { Transaction } from '../entities/Transaction';
import { ProviderService } from '../services/provider.service';

import bcrypt from 'bcryptjs';

 const GAS_FEE_BPS = 30n; // 0.3%
 const PLATFORM_FEE_BPS = 50n; // 0.5%
 const BPS_DENOM = 10_000n;

 const XACCOUNT_IFACE = new ethers.Interface([
   'function execute(address dest, uint256 value, bytes func)',
   'function executeBatch(address[] dest, uint256[] value, bytes[] func)'
 ]);

 const ERC20_IFACE = new ethers.Interface([
   'function transfer(address to, uint256 amount) returns (bool)'
 ]);

 const XFACTORY_ABI = [
  'function getAddress(uint256 publicKeyX, uint256 publicKeyY, uint256 salt) view returns (address)'
 ];

 const XPAYMASTER_ABI = [
  'function getHash((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature) userOp,uint48 validUntil,uint48 validAfter) view returns (bytes32)'
 ];

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

export class PaymasterController {
  
  // Helper to decode UserOp callData
  // Assumes SimpleAccount.execute(address dest, uint256 value, bytes func)
  private static decodeCallData(callData: string): { value: bigint, target: string } {
    try {
        const decoded = XACCOUNT_IFACE.parseTransaction({ data: callData });
        if (decoded) {
            if (decoded.name === 'execute') {
              return {
                  value: BigInt(decoded.args[1]),
                  target: String(decoded.args[0])
              };
            }

            if (decoded.name === 'executeBatch') {
              const dests = decoded.args[0] as string[];
              const values = decoded.args[1] as bigint[];
              let total = 0n;
              for (let i = 0; i < values.length; i++) {
                total += BigInt(values[i] ?? 0);
              }
              return {
                value: total,
                target: dests && dests.length > 0 ? String(dests[0]) : ''
              };
            }
        }
    } catch (e) {
        // Fallback or different account implementation
    }
    return { value: 0n, target: '' };
  }

  private static parseFeeFromXAccountCallData(callData: string, treasury: string): {
    feeAmount: bigint;
    grossAmount: bigint;
  } {
    if (!treasury || !ethers.isAddress(treasury)) {
      return { feeAmount: 0n, grossAmount: 0n };
    }

    try {
      const decoded = XACCOUNT_IFACE.parseTransaction({ data: callData });
      if (!decoded) return { feeAmount: 0n, grossAmount: 0n };

      if (decoded.name === 'execute') {
        // No structured fee recipient, can't reliably enforce.
        return { feeAmount: 0n, grossAmount: 0n };
      }

      if (decoded.name !== 'executeBatch') {
        return { feeAmount: 0n, grossAmount: 0n };
      }

      const dests = decoded.args[0] as string[];
      const values = decoded.args[1] as bigint[];
      const funcs = decoded.args[2] as string[];

      // Native: fee is value to treasury
      let nativeFee = 0n;
      let nativeNet = 0n;
      for (let i = 0; i < dests.length; i++) {
        const d = String(dests[i]).toLowerCase();
        const v = BigInt(values[i] ?? 0);
        if (d === treasury.toLowerCase()) {
          nativeFee += v;
        } else {
          nativeNet += v;
        }
      }

      if (nativeFee > 0n || nativeNet > 0n) {
        const gross = nativeNet + nativeFee;
        return { feeAmount: nativeFee, grossAmount: gross };
      }

      // ERC20: fee is transfer(to=treasury)
      let tokenFee = 0n;
      let tokenNet = 0n;
      for (let i = 0; i < funcs.length; i++) {
        try {
          const parsed = ERC20_IFACE.parseTransaction({ data: funcs[i] });
          if (!parsed || parsed.name !== 'transfer') continue;
          const to = String(parsed.args[0]).toLowerCase();
          const amount = BigInt(parsed.args[1]);
          if (to === treasury.toLowerCase()) tokenFee += amount;
          else tokenNet += amount;
        } catch {
          // ignore
        }
      }

      const gross = tokenNet + tokenFee;
      return { feeAmount: tokenFee, grossAmount: gross };
    } catch {
      return { feeAmount: 0n, grossAmount: 0n };
    }
  }

  static async sponsorUserOperationInternal(params: {
    userOp: any;
    chainId: number;
    user: User;
    device: Device;
    spendingPin?: string;
  }): Promise<{
    statusCode: number;
    body: any;
  }> {
    const { userOp, chainId, user, device, spendingPin } = params;

    const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId) || config.blockchain.chains.base;

    const paymasterAddress = config.blockchain.aa?.paymasterAddress
      ? config.blockchain.aa.paymasterAddress(chainConfig.chainId)
      : config.blockchain.paymaster.address;

    const paymasterSigningKey = config.blockchain.aa?.paymasterSigningKey
      ? config.blockchain.aa.paymasterSigningKey(chainConfig.chainId)
      : config.blockchain.paymaster.signingKey;

    const treasuryAddress = config.blockchain.aa?.treasuryAddress
      ? config.blockchain.aa.treasuryAddress(chainConfig.chainId)
      : '';

    if (!userOp) {
      return { statusCode: 400, body: { error: 'Missing userOp' } };
    }

    if (!user || !device) {
      return { statusCode: 401, body: { error: 'Unauthorized' } };
    }

    if (!device.credentialPublicKey) {
      return { statusCode: 400, body: { error: 'Device has no passkey registered' } };
    }

    const sender = userOp.sender;

    const factoryAddress = config.blockchain.aa.factoryAddress(chainConfig.chainId);
    if (!factoryAddress) {
      return {
        statusCode: 200,
        body: { paymasterAndData: '0x', message: `FACTORY_ADDRESS_${chainConfig.chainId} not configured` }
      };
    }

    try {
      const { x, y } = decodeP256PublicKeyXY(device.credentialPublicKey);
      const provider = ProviderService.getProvider(chainConfig.chainId);
      const factory = new ethers.Contract(factoryAddress, XFACTORY_ABI, provider);
      const expectedSender = await factory['getAddress(uint256,uint256,uint256)'](x, y, 0);
      if (String(expectedSender).toLowerCase() !== String(sender).toLowerCase()) {
        return { statusCode: 403, body: { error: 'Sender does not match device passkey-derived AA address' } };
      }
    } catch (e: any) {
      return { statusCode: 400, body: { error: e?.message || 'Failed to derive AA sender from passkey' } };
    }

    if (user.isFrozen) {
      return { statusCode: 403, body: { error: 'Account is frozen' } };
    }

    const { value } = PaymasterController.decodeCallData(userOp.callData);

    if (treasuryAddress && ethers.isAddress(treasuryAddress)) {
      const { feeAmount, grossAmount } = PaymasterController.parseFeeFromXAccountCallData(userOp.callData, treasuryAddress);
      if (grossAmount > 0n) {
        const minFee = (grossAmount * GAS_FEE_BPS) / BPS_DENOM;
        const maxFee = (grossAmount * (GAS_FEE_BPS + PLATFORM_FEE_BPS)) / BPS_DENOM;
        if (feeAmount < minFee || feeAmount > maxFee) {
          return {
            statusCode: 200,
            body: { paymasterAndData: '0x', message: 'Fee payment invalid; sponsorship declined' }
          };
        }
      } else {
        return {
          statusCode: 200,
          body: { paymasterAndData: '0x', message: 'Missing fee payment; sponsorship declined' }
        };
      }
    }

    // --- USDZ Economy: Gas Sponsorship Logic ---
    const callGasLimit = BigInt(userOp.callGasLimit || 0);
    const verificationGasLimit = BigInt(userOp.verificationGasLimit || 0);
    const preVerificationGas = BigInt(userOp.preVerificationGas || 0);
    const maxFeePerGas = BigInt(userOp.maxFeePerGas || 0);

    const totalGasLimit = callGasLimit + verificationGasLimit + preVerificationGas;
    const maxGasCostWei = totalGasLimit * maxFeePerGas;

    const gasCostEth = parseFloat(ethers.formatEther(maxGasCostWei));
    const gasCostUsd = gasCostEth * 2500;

    console.log(`[Paymaster] Estimated Gas Cost: ${gasCostEth} ETH ($${gasCostUsd.toFixed(4)})`);
    console.log(`[Paymaster] User Balance: ${user.usdzBalance} USDZ`);

    if ((user.usdzBalance || 0) <= 0) {
      console.log('[Paymaster] User out of USDZ credits. Sponsorship declined.');
      return {
        statusCode: 200,
        body: { paymasterAndData: '0x', message: 'Insufficient USDZ balance for sponsorship' }
      };
    }

    user.usdzBalance = Math.max(0, (user.usdzBalance || 0) - gasCostUsd);
    await AppDataSource.getRepository(User).save(user);
    console.log(`[Paymaster] Sponsored! New Balance: ${user.usdzBalance.toFixed(4)} USDZ`);

    if (value > 0n) {
      const ethValue = parseFloat(ethers.formatEther(value));
      const usdValue = ethValue * 2500;

      if (usdValue >= user.largeTransactionThresholdUsd) {
        if (!user.spendingPinHash) {
          return { statusCode: 400, body: { error: 'Spending PIN required for this amount but not set on account.' } };
        }
        if (!spendingPin) {
          return { statusCode: 401, body: { error: 'Spending PIN required for large transactions.' } };
        }
        const validPin = await bcrypt.compare(spendingPin, user.spendingPinHash);
        if (!validPin) {
          return { statusCode: 401, body: { error: 'Invalid Spending PIN.' } };
        }
        console.log(`[Paymaster] Large transaction ($${usdValue}) authorized with PIN.`);
      }

      const txRepo = AppDataSource.getRepository(Transaction);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const recentTxs = await txRepo.find({
        where: {
          user: { id: user.id },
          createdAt: MoreThan(oneDayAgo)
        }
      });

      let totalSpentUsd = 0;
      for (const tx of recentTxs) {
        if (tx.value) {
          const txEth = parseFloat(ethers.formatEther(tx.value));
          totalSpentUsd += txEth * 2500;
        }
      }

      if (totalSpentUsd + usdValue > user.dailyLimitUsd) {
        console.warn(`[Paymaster] Blocked transaction: Limit exceeded. Spent: $${totalSpentUsd}, Attempt: $${usdValue}, Limit: $${user.dailyLimitUsd}`);
        return { statusCode: 403, body: { error: `Daily spending limit exceeded ($${user.dailyLimitUsd})` } };
      }
    }

    const validUntil = Math.floor(Date.now() / 1000) + 3600;
    const validAfter = Math.floor(Date.now() / 1000);

    if (!paymasterAddress || paymasterAddress.length === 0 || !paymasterSigningKey || paymasterSigningKey.length === 0) {
      return {
        statusCode: 200,
        body: { paymasterAndData: '0x', message: `Paymaster not configured for chainId=${chainConfig.chainId}` }
      };
    }

    const provider = ProviderService.getProvider(chainConfig.chainId);
    const paymaster = new ethers.Contract(paymasterAddress, XPAYMASTER_ABI, provider);

    const hash: string = await paymaster.getHash(
      {
        sender: userOp.sender,
        nonce: BigInt(userOp.nonce || 0),
        initCode: userOp.initCode || '0x',
        callData: userOp.callData || '0x',
        callGasLimit: BigInt(userOp.callGasLimit || 0),
        verificationGasLimit: BigInt(userOp.verificationGasLimit || 0),
        preVerificationGas: BigInt(userOp.preVerificationGas || 0),
        maxFeePerGas: BigInt(userOp.maxFeePerGas || 0),
        maxPriorityFeePerGas: BigInt(userOp.maxPriorityFeePerGas || 0),
        paymasterAndData: '0x',
        signature: '0x',
      },
      validUntil,
      validAfter
    );

    const signer = new ethers.Wallet(paymasterSigningKey);
    const signature = await signer.signMessage(ethers.getBytes(hash));

    const validUntilHex = ethers.toBeHex(validUntil, 6);
    const validAfterHex = ethers.toBeHex(validAfter, 6);

    const paymasterAndData = ethers.concat([
      paymasterAddress,
      validUntilHex,
      validAfterHex,
      signature
    ]);

    return {
      statusCode: 200,
      body: {
        paymasterAndData: ethers.hexlify(paymasterAndData),
        validUntil,
        validAfter
      }
    };
  }

  static async sponsorUserOperation(req: Request, res: Response) {
    try {
      const user = (req as any).user as User;
      const device = (req as any).device as Device;
      const { userOp, spendingPin } = req.body;
      const chainId = Number(req.body.chainId || config.blockchain.chainId);

      const result = await PaymasterController.sponsorUserOperationInternal({
        userOp,
        chainId,
        user,
        device,
        spendingPin,
      });

      res.status(result.statusCode).json(result.body);
      return;

    } catch (error) {
      console.error('Error in sponsorUserOperation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
