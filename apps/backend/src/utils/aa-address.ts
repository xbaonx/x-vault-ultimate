import { ethers } from 'ethers';
import cbor from 'cbor';
import { config } from '../config';
import { ProviderService } from '../services/provider.service';

const XFACTORY_ABI = [
  'function getAddress(uint256 publicKeyX, uint256 publicKeyY, uint256 salt) view returns (address)'
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(message));
  }
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

export async function deriveAaAddressFromCredentialPublicKey(params: {
  credentialPublicKey: Buffer;
  chainId: number;
  salt?: number | bigint;
  timeoutMs?: number;
}): Promise<string> {
  const { credentialPublicKey, chainId } = params;
  const salt = BigInt(params.salt ?? 0);

  const factoryAddressRaw = String(config.blockchain.aa.factoryAddress(chainId) || '').trim();
  if (!factoryAddressRaw) {
    throw new Error('FACTORY_ADDRESS not configured (universal mode)');
  }
  const factoryAddresses = [factoryAddressRaw];

  const { x, y } = decodeP256PublicKeyXY(credentialPublicKey);

  const provider = ProviderService.getProvider(chainId);

  const timeoutMs = Number(params.timeoutMs ?? 2000);
  const deadlineAt = Date.now() + timeoutMs;

  let lastError: unknown;
  for (const factoryAddress of factoryAddresses) {
    let remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) break;

    try {
      const code = await withTimeout(
        provider.getCode(factoryAddress),
        remainingMs,
        `AA Derivation Timeout (getCode) chainId=${chainId}`,
      );

      if (!code || code === '0x') {
        throw new Error(`AA Factory not deployed on chainId=${chainId} at ${factoryAddress}`);
      }

      remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new Error('AA Derivation Timeout');
      }

      const factory = new ethers.Contract(factoryAddress, XFACTORY_ABI, provider);
      const address = await withTimeout(
        factory['getAddress(uint256,uint256,uint256)'](x, y, salt),
        remainingMs,
        `AA Derivation Timeout (getAddress) chainId=${chainId}`,
      );
      return String(address);
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    throw lastError as any;
  }
  throw new Error('AA Derivation Timeout');
}
