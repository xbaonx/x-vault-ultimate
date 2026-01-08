import { ethers } from 'ethers';
import { config } from '../config';

type TokenBalanceEntry = {
  contractAddress: string;
  tokenBalance: string | null;
  error?: any;
};

type TokenMetadata = {
  name?: string;
  symbol?: string;
  decimals?: number;
};

async function fetchJsonWithTimeout(url: string, body: any, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

function getRpcUrl(chainId: number): string {
  const chainConfig = Object.values(config.blockchain.chains).find((c) => c.chainId === chainId);
  if (!chainConfig?.rpcUrl) throw new Error(`No RPC url for chainId=${chainId}`);
  return chainConfig.rpcUrl;
}

function toBigIntFromHex(hex: string | null | undefined): bigint {
  if (!hex || typeof hex !== 'string') return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

export class TokenDiscoveryService {
  private static metadataCache: Record<number, Record<string, TokenMetadata>> = {};

  private static getCachedMetadata(chainId: number, contractAddress: string): TokenMetadata | null {
    const byChain = this.metadataCache[chainId];
    if (!byChain) return null;
    return byChain[String(contractAddress || '').toLowerCase()] || null;
  }

  private static setCachedMetadata(chainId: number, contractAddress: string, meta: TokenMetadata) {
    const key = String(contractAddress || '').toLowerCase();
    if (!this.metadataCache[chainId]) this.metadataCache[chainId] = {};
    this.metadataCache[chainId][key] = meta || {};
  }

  static async getErc20Assets(params: {
    chainId: number;
    address: string;
    timeoutMs?: number;
    maxTokens?: number;
  }): Promise<Array<{ symbol: string; name: string; amount: number; contractAddress: string; decimals: number; balanceRaw: string }>> {
    const timeoutMs = params.timeoutMs ?? 2500;
    const maxTokens = params.maxTokens ?? 25;

    if (!params.address || !params.address.startsWith('0x')) return [];

    const rpcUrl = getRpcUrl(params.chainId);

    // 1) Get balances for all ERC-20 tokens the address has interacted with.
    // Alchemy supports token specification "erc20".
    let balances: TokenBalanceEntry[] = [];
    try {
      const json = await fetchJsonWithTimeout(
        rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'alchemy_getTokenBalances',
          params: [params.address, 'erc20'],
        },
        timeoutMs,
      );

      if (json?.error) {
        return [];
      }

      balances = (json?.result?.tokenBalances || []) as TokenBalanceEntry[];
    } catch {
      return [];
    }

    const nonZero = balances
      .filter((b) => b && typeof b.contractAddress === 'string')
      .filter((b) => toBigIntFromHex(b.tokenBalance) > 0n)
      .slice(0, maxTokens);

    if (!nonZero.length) return [];

    // 2) Fetch metadata for each token (decimals/symbol/name)
    const metas = await Promise.all(
      nonZero.map(async (b) => {
        try {
          const cached = this.getCachedMetadata(params.chainId, b.contractAddress);
          if (cached) {
            return { contractAddress: b.contractAddress, meta: cached, balanceHex: b.tokenBalance };
          }

          const json = await fetchJsonWithTimeout(
            rpcUrl,
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'alchemy_getTokenMetadata',
              params: [b.contractAddress],
            },
            timeoutMs,
          );

          if (json?.error) {
            return { contractAddress: b.contractAddress, meta: {} as TokenMetadata, balanceHex: b.tokenBalance };
          }

          const meta = (json?.result || {}) as TokenMetadata;
          this.setCachedMetadata(params.chainId, b.contractAddress, meta);
          return { contractAddress: b.contractAddress, meta, balanceHex: b.tokenBalance };
        } catch {
          return { contractAddress: b.contractAddress, meta: {} as TokenMetadata, balanceHex: b.tokenBalance };
        }
      }),
    );

    const assets = metas
      .map((m) => {
        const decimals = typeof m.meta.decimals === 'number' ? m.meta.decimals : 18;
        const symbol = (m.meta.symbol || '').trim() || m.contractAddress.slice(0, 6);
        const name = (m.meta.name || '').trim() || symbol;

        const raw = toBigIntFromHex(m.balanceHex);
        const amountStr = ethers.formatUnits(raw, decimals);
        const amount = Number(amountStr);
        if (!Number.isFinite(amount) || amount <= 0) return null;

        return { symbol, name, amount, contractAddress: m.contractAddress, decimals, balanceRaw: raw.toString() };
      })
      .filter(Boolean) as Array<{ symbol: string; name: string; amount: number; contractAddress: string; decimals: number; balanceRaw: string }>;

    return assets;
  }
}
