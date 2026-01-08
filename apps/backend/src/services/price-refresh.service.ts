import { AppDataSource } from '../data-source';
import { WalletSnapshot } from '../entities/WalletSnapshot';
import { TokenPriceService } from './token-price.service';
import { config } from '../config';

function getAlchemyApiKey(): string {
  return String(process.env.ALCHEMY_API_KEY || '').trim();
}

function getPricesApiBaseUrl(apiKey: string): string {
  return `https://api.g.alchemy.com/prices/v1/${apiKey}`;
}

function getNetworkEnumByChainId(chainId: number): string | null {
  const map: Record<number, string> = {
    1: 'eth-mainnet',
    10: 'opt-mainnet',
    137: 'polygon-mainnet',
    42161: 'arb-mainnet',
    8453: 'base-mainnet',
    56: 'bsc-mainnet',
    43114: 'avax-mainnet',
    59144: 'linea-mainnet',
  };

  const envOverride = String(process.env[`ALCHEMY_PRICES_NETWORK_${chainId}`] || '').trim();
  if (envOverride) return envOverride;

  return map[chainId] || null;
}

function getNativeSymbolForPricing(chainId: number, displaySymbol: string): string {
  // Polygon native asset is still priced as MATIC on most price feeds.
  if (chainId === 137) return 'MATIC';
  return String(displaySymbol || '').trim().toUpperCase();
}

async function fetchJsonWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

export class PriceRefreshService {
  private static running = false;

  static async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!AppDataSource.isInitialized) return;

      const apiKey = getAlchemyApiKey();
      if (!apiKey) {
        console.warn('[PriceRefresh] ALCHEMY_API_KEY missing; skipping price refresh');
        return;
      }

      const baseUrl = getPricesApiBaseUrl(apiKey);

      // 1) Collect token addresses to price from WalletSnapshot portfolios.
      const snapshotRepo = AppDataSource.getRepository(WalletSnapshot);
      const snapshots = await snapshotRepo.find({ select: ['portfolio'] as any });

      const tokensByChain: Record<number, Set<string>> = {};
      for (const s of snapshots) {
        const assets: any[] = Array.isArray((s as any)?.portfolio?.assets) ? (s as any).portfolio.assets : [];
        for (const a of assets) {
          const chainId = Number(a?.chainId || 0);
          if (!chainId) continue;
          const tokenAddress = String(a?.tokenAddress || '').trim().toLowerCase();
          if (!tokenAddress || !tokenAddress.startsWith('0x')) continue;
          if (!tokensByChain[chainId]) tokensByChain[chainId] = new Set();
          tokensByChain[chainId].add(tokenAddress);
        }
      }

      // 2) Refresh native prices via by-symbol.
      const chains = Object.values(config.blockchain.chains || {});
      const nativeSymbols = Array.from(
        new Set(
          chains
            .map((c) => getNativeSymbolForPricing(c.chainId, c.symbol))
            .filter(Boolean),
        ),
      ).slice(0, 25);

      if (nativeSymbols.length) {
        try {
          const qs = new URLSearchParams();
          qs.set('symbols', JSON.stringify(nativeSymbols));
          const url = `${baseUrl}/tokens/by-symbol?${qs.toString()}`;
          const json = await fetchJsonWithTimeout(
            url,
            { method: 'GET', headers: { 'content-type': 'application/json' } },
            5000,
          );

          const rows: any[] = Array.isArray(json?.data) ? json.data : [];
          const priceBySymbol: Record<string, { price: number; lastUpdatedAt?: string }> = {};
          for (const r of rows) {
            const sym = String(r?.symbol || '').toUpperCase();
            const priceRow = Array.isArray(r?.prices) ? r.prices.find((p: any) => String(p?.currency || '').toUpperCase() === 'USD') : null;
            const v = priceRow?.value ? Number(priceRow.value) : NaN;
            if (sym && Number.isFinite(v) && v > 0) {
              priceBySymbol[sym] = { price: v, lastUpdatedAt: priceRow?.lastUpdatedAt };
            }
          }

          for (const c of chains) {
            const sym = getNativeSymbolForPricing(c.chainId, c.symbol);
            const found = priceBySymbol[sym];
            if (!found) continue;
            const updatedAt = found.lastUpdatedAt ? new Date(found.lastUpdatedAt) : undefined;
            await TokenPriceService.upsertUsdPrice({
              chainId: c.chainId,
              address: TokenPriceService.nativeAddressKey(),
              price: found.price,
              source: 'alchemy',
              updatedAt,
            });
          }
        } catch (e) {
          console.warn('[PriceRefresh] native by-symbol refresh failed:', e);
        }
      }

      // 3) Refresh ERC20 prices via by-address, per chain (max 25 addresses per call).
      for (const [chainIdStr, set] of Object.entries(tokensByChain)) {
        const chainId = Number(chainIdStr);
        if (!chainId) continue;

        const network = getNetworkEnumByChainId(chainId);
        if (!network) continue;

        const addresses = Array.from(set);
        for (let i = 0; i < addresses.length; i += 25) {
          const batch = addresses.slice(i, i + 25);
          try {
            const url = `${baseUrl}/tokens/by-address`;
            const body = {
              addresses: batch.map((address) => ({ network, address })),
            };

            const json = await fetchJsonWithTimeout(
              url,
              { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
              8000,
            );

            const rows: any[] = Array.isArray(json?.data) ? json.data : [];
            for (const r of rows) {
              const addr = String(r?.address || '').trim().toLowerCase();
              const priceRow = Array.isArray(r?.prices) ? r.prices.find((p: any) => String(p?.currency || '').toUpperCase() === 'USD') : null;
              const v = priceRow?.value ? Number(priceRow.value) : NaN;
              if (!addr || !addr.startsWith('0x') || !Number.isFinite(v) || v <= 0) continue;

              const updatedAt = priceRow?.lastUpdatedAt ? new Date(priceRow.lastUpdatedAt) : undefined;
              await TokenPriceService.upsertUsdPrice({ chainId, address: addr, price: v, source: 'alchemy', updatedAt });
            }
          } catch (e) {
            console.warn(`[PriceRefresh] by-address failed chainId=${chainId} batch=${i}-${i + batch.length}:`, e);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
