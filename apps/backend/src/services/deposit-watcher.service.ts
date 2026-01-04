import { ethers } from 'ethers';
import { AppDataSource } from '../data-source';
import { Device } from '../entities/Device';
import { DepositEvent } from '../entities/DepositEvent';
import { ChainCursor } from '../entities/ChainCursor';
import { ProviderService } from './provider.service';
import { PassUpdateService } from './pass-update.service';
import { AaAddressMapService } from './aa-address-map.service';
import { config } from '../config';
import { deriveAaAddressFromCredentialPublicKey } from '../utils/aa-address';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

const TOKEN_MAP: Record<number, { address: string; symbol: string; decimals: number }[]> = {
  8453: [
    { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI', decimals: 18 },
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 }
  ],
  1: [
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 }
  ],
  137: [
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', decimals: 18 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 }
  ],
  42161: [
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', decimals: 18 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 }
  ],
  10: [
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', decimals: 18 },
    { address: '0x94b008aA00579c1307B0EF2c499a98a359659fc9', symbol: 'USDT', decimals: 6 },
    { address: '0x0b2C639c533813f4Aa9D7837CAf992c96bdB5a5f', symbol: 'USDC', decimals: 6 }
  ]
};

export class DepositWatcherService {
  static async runOnce(): Promise<void> {
    if (!AppDataSource.isInitialized) return;

    const deviceRepo = AppDataSource.getRepository(Device);
    const devices = await deviceRepo.find({ where: { isActive: true } });
    const activeDevices = devices.filter(d => !!d.credentialPublicKey);
    if (!activeDevices.length) return;

    const chains = Object.values(config.blockchain.chains || {});

    for (const chain of chains) {
      const provider = ProviderService.getProvider(chain.chainId);
      const latest = await provider.getBlockNumber();
      const toBlock = Math.max(0, latest - 2);

      const tokens = TOKEN_MAP[chain.chainId] || [];

      for (const device of activeDevices) {
        let walletAddress = '';
        let serialNumberForPassUpdate = '';
        try {
          // serialNumber is derived deterministically on the "base" chainId.
          // We keep pass serial stable even when scanning deposits on multiple chains.
          serialNumberForPassUpdate = await deriveAaAddressFromCredentialPublicKey({
            credentialPublicKey: Buffer.from(device.credentialPublicKey),
            chainId: Number(config.blockchain.chainId),
            salt: 0,
          });

          walletAddress = await deriveAaAddressFromCredentialPublicKey({
            credentialPublicKey: Buffer.from(device.credentialPublicKey),
            chainId: chain.chainId,
            salt: 0,
          });
        } catch {
          continue;
        }

        await AaAddressMapService.upsert({
          chainId: chain.chainId,
          aaAddress: walletAddress,
          serialNumber: serialNumberForPassUpdate,
          deviceId: device.deviceLibraryId,
        });

        const walletAddressLower = walletAddress.toLowerCase();
        for (const token of tokens) {
          await this.scanToken(chain.chainId, token.address, walletAddress, walletAddressLower, serialNumberForPassUpdate, toBlock);
        }
      }
    }
  }

  static async runOnceForDevice(device: Device, notifyPassUpdates = false): Promise<void> {
    if (!AppDataSource.isInitialized) return;
    if (!device?.isActive || !device.credentialPublicKey) return;

    const chains = Object.values(config.blockchain.chains || {});
    if (!chains.length) return;

    const baseSerialChainId = Number(config.blockchain.chainId);

    let serialNumberForPassUpdate = '';
    try {
      serialNumberForPassUpdate = await deriveAaAddressFromCredentialPublicKey({
        credentialPublicKey: Buffer.from(device.credentialPublicKey),
        chainId: baseSerialChainId,
        salt: 0,
      });
    } catch {
      return;
    }

    for (const chain of chains) {
      const provider = ProviderService.getProvider(chain.chainId);
      const latest = await provider.getBlockNumber();
      const toBlock = Math.max(0, latest - 2);

      let walletAddress = '';
      try {
        walletAddress = await deriveAaAddressFromCredentialPublicKey({
          credentialPublicKey: Buffer.from(device.credentialPublicKey),
          chainId: chain.chainId,
          salt: 0,
        });
      } catch {
        continue;
      }

      await AaAddressMapService.upsert({
        chainId: chain.chainId,
        aaAddress: walletAddress,
        serialNumber: serialNumberForPassUpdate,
        deviceId: device.deviceLibraryId,
      });

      const tokens = TOKEN_MAP[chain.chainId] || [];
      const walletAddressLower = walletAddress.toLowerCase();
      for (const token of tokens) {
        await this.scanToken(chain.chainId, token.address, walletAddress, walletAddressLower, serialNumberForPassUpdate, toBlock, notifyPassUpdates);
      }
    }
  }

  private static async scanToken(
    chainId: number,
    tokenAddress: string,
    walletAddress: string,
    walletAddressLower: string,
    serialNumberForPassUpdate: string,
    toBlock: number,
    notifyPassUpdates = true
  ): Promise<void> {
    const cursorRepo = AppDataSource.getRepository(ChainCursor);
    const depositRepo = AppDataSource.getRepository(DepositEvent);

    const tokenAddressLower = tokenAddress.toLowerCase();

    const cursorId = `${chainId}:${walletAddressLower}:${tokenAddressLower}`;

    let cursor = await cursorRepo.findOne({ where: { id: cursorId } });
    if (!cursor) {
      const initialLookbackBlocks = 50;
      cursor = cursorRepo.create({
        id: cursorId,
        chainId,
        walletAddress: walletAddressLower,
        tokenAddress: tokenAddressLower,
        lastScannedBlock: String(Math.max(0, toBlock - initialLookbackBlocks))
      });
      await cursorRepo.save(cursor);
    }

    let fromBlock = Math.max(0, Number(cursor.lastScannedBlock || '0'));

    // Prevent huge scans on first run (public RPCs often cap log ranges)
    const maxScanRange = 5000;
    if (fromBlock === 0 && toBlock > maxScanRange) {
      fromBlock = toBlock - maxScanRange;
    }
    if (toBlock <= fromBlock) return;

    const provider = ProviderService.getProvider(chainId);

    const paddedTo = ethers.zeroPadValue(walletAddressLower, 32);

    let start = fromBlock + 1;
    let chunkSize = 1000;

    const parseRpcErrorFromResponseBody = (e: unknown): { code?: number; message?: string } | null => {
      const anyErr = e as any;
      const body = anyErr?.info?.responseBody;
      if (!body || typeof body !== 'string') return null;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error && (typeof parsed.error === 'object')) {
          return { code: parsed.error.code, message: parsed.error.message };
        }
      } catch {
        return null;
      }
      return null;
    };

    const isAlchemyFreeTierRangeLimit = (e: unknown): boolean => {
      const anyErr = e as any;
      const rpcError = parseRpcErrorFromResponseBody(e);
      const code = rpcError?.code ?? anyErr?.info?.error?.code ?? anyErr?.code;
      const msg = [
        rpcError?.message,
        anyErr?.shortMessage,
        anyErr?.message,
        anyErr?.info?.responseBody,
      ].filter(Boolean).join(' ');

      const normalized = msg.toLowerCase();
      return (
        code === -32600 ||
        normalized.includes('free tier') ||
        (normalized.includes('eth_getlogs') && normalized.includes('10 block')) ||
        normalized.includes('up to a 10 block range')
      );
    };

    const isAlchemyThroughputLimit = (e: unknown): boolean => {
      const anyErr = e as any;
      const code = anyErr?.error?.code ?? anyErr?.info?.error?.code;
      const msg = [
        anyErr?.error?.message,
        anyErr?.shortMessage,
        anyErr?.message,
        anyErr?.info?.responseBody,
      ].filter(Boolean).join(' ');

      const normalized = msg.toLowerCase();
      return code === 429 || normalized.includes('compute units per second') || normalized.includes('throughput');
    };

    while (start <= toBlock) {
      const end = Math.min(toBlock, start + chunkSize - 1);

      let logs: ethers.Log[] = [];
      try {
        logs = await provider.getLogs({
          address: tokenAddressLower,
          fromBlock: start,
          toBlock: end,
          topics: [TRANSFER_TOPIC, null, paddedTo]
        });
      } catch (e) {
        // Alchemy Free tier: eth_getLogs supports only <= 10 blocks per request.
        if (isAlchemyFreeTierRangeLimit(e) && chunkSize > 10) {
          chunkSize = 10;
          continue;
        }

        // Alchemy throughput: avoid spamming errors; let the next run retry.
        if (isAlchemyThroughputLimit(e)) {
          return;
        }

        // Generic fallback: reduce chunk size and retry same range on flaky RPCs
        if (chunkSize > 10) {
          chunkSize = Math.max(10, Math.floor(chunkSize / 2));
          continue;
        }

        throw e;
      }

      for (const log of logs) {
        const id = `${chainId}:${log.transactionHash}:${log.index}`;

        const exists = await depositRepo.findOne({ where: { id } });
        if (exists) continue;

        let amount = '0';
        try {
          amount = BigInt(log.data).toString();
        } catch {
          amount = '0';
        }

        const dep = depositRepo.create({
          id,
          chainId,
          txHash: log.transactionHash,
          logIndex: log.index,
          walletAddress,
          tokenAddress: tokenAddressLower,
          amount
        });

        await depositRepo.save(dep);

        if (notifyPassUpdates) {
          await PassUpdateService.notifyPassUpdateBySerialNumber(serialNumberForPassUpdate);
        }
      }

      cursor.lastScannedBlock = String(end);
      await cursorRepo.save(cursor);
      start = end + 1;
    }
  }
}
