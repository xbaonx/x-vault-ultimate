import { Request, Response } from 'express';
import { ethers } from 'ethers';
import cbor from 'cbor';
import { AppDataSource } from '../data-source';
import { Device } from '../entities/Device';
import { User } from '../entities/User';
import { Transaction } from '../entities/Transaction';
import { config } from '../config';
import { ProviderService } from '../services/provider.service';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';

const ENTRYPOINT_ABI = [
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
  'function getNonce(address sender, uint192 key) view returns (uint256)'
];

const XFACTORY_ABI = [
  'function getAddress(uint256 publicKeyX, uint256 publicKeyY, uint256 salt) view returns (address)'
];

const XACCOUNT_ABI = [
  'function execute(address dest, uint256 value, bytes func)'
];

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

      if (!config.blockchain.factoryAddress) {
        return res.status(500).json({ error: 'FACTORY_ADDRESS not configured' });
      }

      const { x, y } = decodeP256PublicKeyXY(device.credentialPublicKey);

      const provider = ProviderService.getProvider(config.blockchain.chainId);
      const factory = new ethers.Contract(config.blockchain.factoryAddress, XFACTORY_ABI, provider);

      const salt = 0;
      const address = await factory['getAddress(uint256,uint256,uint256)'](x, y, salt);

      res.status(200).json({
        address,
        chainId: config.blockchain.chainId,
        entryPoint: config.blockchain.entryPointAddress,
        factory: config.blockchain.factoryAddress,
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

      if (!config.blockchain.factoryAddress) {
        return res.status(500).json({ error: 'FACTORY_ADDRESS not configured' });
      }

      if (!config.blockchain.entryPointAddress) {
        return res.status(500).json({ error: 'ENTRY_POINT_ADDRESS not configured' });
      }

      const { transaction } = req.body;
      if (!transaction?.to) {
        return res.status(400).json({ error: 'Missing transaction.to' });
      }

      const chainId = Number(transaction.chainId || config.blockchain.chainId);
      const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId) || config.blockchain.chains.base;

      const provider = ProviderService.getProvider(chainConfig.chainId);

      const { x, y } = decodeP256PublicKeyXY(device.credentialPublicKey);
      const factory = new ethers.Contract(config.blockchain.factoryAddress, XFACTORY_ABI, provider);

      const salt = 0;
      const sender = await factory['getAddress(uint256,uint256,uint256)'](x, y, salt);

      const code = await provider.getCode(sender);
      const isDeployed = code && code !== '0x';

      const ifaceFactory = new ethers.Interface([
        'function createAccount(uint256 publicKeyX, uint256 publicKeyY, uint256 salt)'
      ]);

      const initCode = isDeployed
        ? '0x'
        : ethers.concat([
            config.blockchain.factoryAddress,
            ifaceFactory.encodeFunctionData('createAccount', [x, y, salt])
          ]);

      const entryPoint = new ethers.Contract(config.blockchain.entryPointAddress, ENTRYPOINT_ABI, provider);
      const nonce = isDeployed ? await entryPoint.getNonce(sender, 0) : 0n;

      const accountInterface = new ethers.Interface(XACCOUNT_ABI);
      const callData = accountInterface.encodeFunctionData('execute', [
        transaction.to,
        BigInt(transaction.value || 0),
        transaction.data || '0x'
      ]);

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

      const userOpHash: string = await entryPoint.getUserOpHash(userOp);
      const challenge = base64UrlEncode(Buffer.from(userOpHash.slice(2), 'hex'));

      // Store challenge for WebAuthn verification in /userop/send
      device.currentChallenge = challenge;
      if (AppDataSource.isInitialized) {
        await AppDataSource.getRepository(Device).save(device);
      }

      res.status(200).json({
        sender,
        isDeployed,
        chainId: chainConfig.chainId,
        entryPoint: config.blockchain.entryPointAddress,
        bundlerUrl: config.blockchain.bundlerUrl,
        challenge,
        userOp
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

      const device = (req as any).device as Device;
      if (!device || !device.currentChallenge) {
        return res.status(400).json({ error: 'Device or challenge not found' });
      }

      const chainId = Number(req.body.chainId || config.blockchain.chainId);
      const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId) || config.blockchain.chains.base;
      const provider = ProviderService.getProvider(chainConfig.chainId);

      if (!config.blockchain.entryPointAddress) {
        return res.status(500).json({ error: 'ENTRY_POINT_ADDRESS not configured' });
      }

      const entryPoint = new ethers.Contract(config.blockchain.entryPointAddress, ENTRYPOINT_ABI, provider);

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

      const bundlerUrl = config.blockchain.bundlerUrl;
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendUserOperation',
        params: [userOp, config.blockchain.entryPointAddress]
      };

      const resp = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

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
          const newTx = txRepo.create({
            userOpHash: sentUserOpHash,
            network: chainConfig.name,
            status: 'pending',
            value: '0',
            asset: chainConfig.symbol,
            user: userEntity,
            userId: userEntity.id,
            txData: { type: 'aa', sender: userOp.sender, callData: userOp.callData }
          });
          await txRepo.save(newTx);
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
