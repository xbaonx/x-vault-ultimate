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
import { TokenPriceService } from '../services/token-price.service';

import bcrypt from 'bcryptjs';

 const GAS_MARKUP_BPS = BigInt(String(process.env.GAS_MARKUP_BPS || '12000').trim());
 const FEE_MAX_MULTIPLIER_BPS = BigInt(String(process.env.FEE_MAX_MULTIPLIER_BPS || '12000').trim());
 const BPS_DENOM = 10_000n;
 const PAYMASTER_POSTOP_GAS = BigInt(String(process.env.PAYMASTER_POSTOP_GAS || '15000').trim());
 const PRICE_SCALE = 1_000_000_000n;
 const WEI_PER_ETH = 1_000_000_000_000_000_000n;

 const XACCOUNT_IFACE = new ethers.Interface([
   'function execute(address dest, uint256 value, bytes func)',
   'function executeBatch(address[] dest, uint256[] value, bytes[] func)'
 ]);

 const ERC20_IFACE = new ethers.Interface([
   'function transfer(address to, uint256 amount) returns (bool)'
 ]);

 const ERC20_DECIMALS_IFACE = new ethers.Interface([
  'function decimals() view returns (uint8)'
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
    isNativeFee: boolean;
    firstDest: string;
    nonTreasuryNativeValue: bigint;
  } {
    if (!treasury || !ethers.isAddress(treasury)) {
      return { feeAmount: 0n, grossAmount: 0n, isNativeFee: false, firstDest: '', nonTreasuryNativeValue: 0n };
    }

    try {
      const decoded = XACCOUNT_IFACE.parseTransaction({ data: callData });
      if (!decoded) return { feeAmount: 0n, grossAmount: 0n, isNativeFee: false, firstDest: '', nonTreasuryNativeValue: 0n };

      if (decoded.name === 'execute') {
        // No structured fee recipient, can't reliably enforce.
        return { feeAmount: 0n, grossAmount: 0n, isNativeFee: false, firstDest: '', nonTreasuryNativeValue: 0n };
      }

      if (decoded.name !== 'executeBatch') {
        return { feeAmount: 0n, grossAmount: 0n, isNativeFee: false, firstDest: '', nonTreasuryNativeValue: 0n };
      }

      const dests = decoded.args[0] as string[];
      const values = decoded.args[1] as bigint[];
      const funcs = decoded.args[2] as string[];

      const firstDest = dests && dests.length > 0 ? String(dests[0] || '') : '';

      // Native: fee is value to treasury
      let nativeFee = 0n;
      let nativeNet = 0n;
      let nonTreasuryNativeValue = 0n;
      for (let i = 0; i < dests.length; i++) {
        const d = String(dests[i]).toLowerCase();
        const v = BigInt(values[i] ?? 0);
        if (d === treasury.toLowerCase()) {
          nativeFee += v;
        } else {
          nativeNet += v;
          nonTreasuryNativeValue += v;
        }
      }

      if (nativeFee > 0n || nativeNet > 0n) {
        const gross = nativeNet + nativeFee;
        return { feeAmount: nativeFee, grossAmount: gross, isNativeFee: true, firstDest, nonTreasuryNativeValue };
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
      return { feeAmount: tokenFee, grossAmount: gross, isNativeFee: false, firstDest, nonTreasuryNativeValue: 0n };
    } catch {
      return { feeAmount: 0n, grossAmount: 0n, isNativeFee: false, firstDest: '', nonTreasuryNativeValue: 0n };
    }
  }

  private static async getTokenDecimals(provider: ethers.Provider, tokenAddress: string): Promise<number> {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_DECIMALS_IFACE, provider);
      const d = await contract.decimals();
      const n = Number(d);
      if (Number.isFinite(n) && n >= 0 && n <= 255) return n;
    } catch {
    }
    return 18;
  }

  static async sponsorUserOperationInternal(params: {
    userOp: any;
    chainId: number;
    user: User;
    device: Device;
    spendingPin?: string;
    salt?: number;
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
        body: { paymasterAndData: '0x', message: 'FACTORY_ADDRESS not configured (universal mode)' }
      };
    }

    try {
      const { x, y } = decodeP256PublicKeyXY(device.credentialPublicKey);
      const provider = ProviderService.getProvider(chainConfig.chainId);

      const factoryCode = await provider.getCode(factoryAddress);
      if (!factoryCode || factoryCode === '0x') {
        return {
          statusCode: 200,
          body: {
            paymasterAndData: '0x',
            message: `AA Factory not deployed on chainId=${chainConfig.chainId} at ${factoryAddress}; sponsorship declined`,
          }
        };
      }

      const factory = new ethers.Contract(factoryAddress, XFACTORY_ABI, provider);
      const salt = Number(params.salt ?? 0);
      const expectedSender = await factory['getAddress(uint256,uint256,uint256)'](x, y, salt);
      if (String(expectedSender).toLowerCase() !== String(sender).toLowerCase()) {
        return { statusCode: 403, body: { error: 'Sender does not match device passkey-derived AA address' } };
      }
    } catch (e: any) {
      return { statusCode: 400, body: { error: e?.message || 'Failed to derive AA sender from passkey' } };
    }

    if (user.isFrozen) {
      return { statusCode: 403, body: { error: 'Account is frozen' } };
    }

    if (!treasuryAddress || !ethers.isAddress(treasuryAddress)) {
      return {
        statusCode: 200,
        body: { paymasterAndData: '0x', message: `TREASURY_ADDRESS_${chainConfig.chainId} not configured; sponsorship declined` }
      };
    }

    // Require fee payment embedded in callData (executeBatch).
    const { feeAmount, grossAmount, isNativeFee, firstDest, nonTreasuryNativeValue } =
      PaymasterController.parseFeeFromXAccountCallData(userOp.callData, treasuryAddress);
    if (grossAmount <= 0n || feeAmount <= 0n) {
      return {
        statusCode: 200,
        body: { paymasterAndData: '0x', message: 'Missing fee payment; sponsorship declined' }
      };
    }

    const callGasLimit = BigInt(userOp.callGasLimit || 0);
    const verificationGasLimit = BigInt(userOp.verificationGasLimit || 0);
    const preVerificationGas = BigInt(userOp.preVerificationGas || 0);
    const maxFeePerGas = BigInt(userOp.maxFeePerGas || 0);
    if (callGasLimit <= 0n || verificationGasLimit <= 0n || preVerificationGas <= 0n || maxFeePerGas <= 0n) {
      return {
        statusCode: 200,
        body: { paymasterAndData: '0x', message: 'Invalid gas fields; sponsorship declined' }
      };
    }

    const gasUnits = callGasLimit + verificationGasLimit + preVerificationGas + PAYMASTER_POSTOP_GAS;
    const gasCostWei = gasUnits * maxFeePerGas;
    const gasReimbursementWei = (gasCostWei * GAS_MARKUP_BPS) / BPS_DENOM;
    const platformFeeWeiTotal = gasReimbursementWei * 2n;

    const nativeUsdPrice = await TokenPriceService.getUsdPrice({
      chainId: chainConfig.chainId,
      address: TokenPriceService.nativeAddressKey(),
    });
    const nativeUsdPriceScaled = nativeUsdPrice > 0 ? BigInt(Math.round(nativeUsdPrice * Number(PRICE_SCALE))) : 0n;
    const usdzBalanceScaled = Number(user.usdzBalance || 0) > 0
      ? BigInt(Math.floor(Number(user.usdzBalance || 0) * Number(PRICE_SCALE)))
      : 0n;

    const platformFeeUsdTotalScaled = nativeUsdPriceScaled > 0n
      ? (platformFeeWeiTotal * nativeUsdPriceScaled) / WEI_PER_ETH
      : 0n;

    const platformFeeUsdChargedUsdZScaled = platformFeeUsdTotalScaled > 0n
      ? (usdzBalanceScaled < platformFeeUsdTotalScaled ? usdzBalanceScaled : platformFeeUsdTotalScaled)
      : 0n;

    const platformFeeUsdRemainingScaled = platformFeeUsdTotalScaled - platformFeeUsdChargedUsdZScaled;

    const platformFeeWeiOnChain = (nativeUsdPriceScaled > 0n && platformFeeUsdRemainingScaled > 0n)
      ? ((platformFeeUsdRemainingScaled * WEI_PER_ETH + nativeUsdPriceScaled - 1n) / nativeUsdPriceScaled)
      : (nativeUsdPriceScaled > 0n ? 0n : platformFeeWeiTotal);

    const totalOnChainNativeEquivalentWei = gasReimbursementWei + platformFeeWeiOnChain;

    let expectedFee = 0n;
    if (isNativeFee) {
      expectedFee = totalOnChainNativeEquivalentWei;
    } else {
      const tokenAddress = String(firstDest || '').trim();
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        return {
          statusCode: 200,
          body: { paymasterAndData: '0x', message: 'Invalid token destination; sponsorship declined' }
        };
      }

      if (nativeUsdPriceScaled <= 0n) {
        return {
          statusCode: 200,
          body: { paymasterAndData: '0x', message: 'Missing native USD price; sponsorship declined' }
        };
      }

      const tokenAddressLower = tokenAddress.toLowerCase();
      const tokenUsdPrice = await TokenPriceService.getUsdPrice({ chainId: chainConfig.chainId, address: tokenAddressLower });
      const tokenUsdPriceScaled = tokenUsdPrice > 0 ? BigInt(Math.round(tokenUsdPrice * Number(PRICE_SCALE))) : 0n;
      if (tokenUsdPriceScaled <= 0n) {
        return {
          statusCode: 200,
          body: { paymasterAndData: '0x', message: 'Missing token USD price; sponsorship declined' }
        };
      }

      const provider = ProviderService.getProvider(chainConfig.chainId);
      const decimals = await PaymasterController.getTokenDecimals(provider, tokenAddress);
      const scaleToken = (() => {
        let out = 1n;
        for (let i = 0; i < decimals; i++) out *= 10n;
        return out;
      })();

      const totalOnChainFeeUsdScaled = (totalOnChainNativeEquivalentWei * nativeUsdPriceScaled) / WEI_PER_ETH;
      expectedFee = ((totalOnChainFeeUsdScaled * scaleToken + tokenUsdPriceScaled - 1n) / tokenUsdPriceScaled);
    }

    const maxFee = (expectedFee * FEE_MAX_MULTIPLIER_BPS) / BPS_DENOM;
    if (feeAmount < expectedFee || feeAmount > maxFee) {
      return {
        statusCode: 200,
        body: { paymasterAndData: '0x', message: 'Fee payment invalid; sponsorship declined' }
      };
    }

    // Optional security: require spending pin for native transfers above threshold (exclude pure-fee native to treasury).
    if (nonTreasuryNativeValue > 0n && (user.spendingPinHash || '').length > 0) {
      if (!spendingPin) {
        return { statusCode: 401, body: { error: 'Spending PIN required.' } };
      }
      const validPin = await bcrypt.compare(spendingPin, user.spendingPinHash);
      if (!validPin) {
        return { statusCode: 401, body: { error: 'Invalid Spending PIN.' } };
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
