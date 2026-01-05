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

export async function deriveAaAddressFromCredentialPublicKey(params: {
  credentialPublicKey: Buffer;
  chainId: number;
  salt?: number | bigint;
  timeoutMs?: number;
}): Promise<string> {
  const { credentialPublicKey, chainId } = params;
  const salt = BigInt(params.salt ?? 0);

  const factoryAddress = config.blockchain.aa.factoryAddress(chainId);
  if (!factoryAddress) {
    throw new Error(`FACTORY_ADDRESS_${chainId} not configured`);
  }

  const { x, y } = decodeP256PublicKeyXY(credentialPublicKey);

  const provider = ProviderService.getProvider(chainId);
  const factory = new ethers.Contract(factoryAddress, XFACTORY_ABI, provider);

  const timeoutMs = Number(params.timeoutMs ?? 2000);
  const address = await Promise.race([
    factory['getAddress(uint256,uint256,uint256)'](x, y, salt),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('AA Derivation Timeout')), timeoutMs)),
  ]);
  return String(address);
}
