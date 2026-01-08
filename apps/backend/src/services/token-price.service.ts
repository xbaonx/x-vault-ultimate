import { AppDataSource } from '../data-source';
import { TokenPrice } from '../entities/TokenPrice';

const NATIVE_ADDRESS = 'native';

function normalizeAddress(addr: string): string {
  const a = String(addr || '').trim().toLowerCase();
  return a;
}

export class TokenPriceService {
  static nativeAddressKey(): string {
    return NATIVE_ADDRESS;
  }

  static async getUsdPrice(params: { chainId: number; address: string }): Promise<number> {
    if (!AppDataSource.isInitialized) return 0;

    const repo = AppDataSource.getRepository(TokenPrice);
    const chainId = Number(params.chainId);
    const address = normalizeAddress(params.address);
    if (!chainId || !address) return 0;

    const row = await repo.findOne({ where: { chainId, address, currency: 'USD' } });
    const p = Number(row?.price || 0);
    return Number.isFinite(p) && p > 0 ? p : 0;
  }

  static async getUsdPrices(params: { chainId: number; addresses: string[] }): Promise<Record<string, number>> {
    if (!AppDataSource.isInitialized) return {};

    const chainId = Number(params.chainId);
    const addresses = Array.from(new Set((params.addresses || []).map(normalizeAddress))).filter(Boolean);
    if (!chainId || addresses.length === 0) return {};

    const repo = AppDataSource.getRepository(TokenPrice);

    const rows = await repo
      .createQueryBuilder('p')
      .where('p.chainId = :chainId', { chainId })
      .andWhere('p.currency = :currency', { currency: 'USD' })
      .andWhere('p.address IN (:...addresses)', { addresses })
      .getMany();

    const out: Record<string, number> = {};
    for (const a of addresses) out[a] = 0;
    for (const r of rows) {
      const key = normalizeAddress(r.address);
      const val = Number(r.price || 0);
      out[key] = Number.isFinite(val) && val > 0 ? val : 0;
    }
    return out;
  }

  static async upsertUsdPrice(params: {
    chainId: number;
    address: string;
    price: number;
    source?: string;
    updatedAt?: Date;
  }): Promise<void> {
    if (!AppDataSource.isInitialized) return;

    const repo = AppDataSource.getRepository(TokenPrice);
    const chainId = Number(params.chainId);
    const address = normalizeAddress(params.address);
    const price = Number(params.price);
    if (!chainId || !address || !Number.isFinite(price) || price < 0) return;

    const existing = await repo.findOne({ where: { chainId, address, currency: 'USD' } });
    if (existing) {
      existing.price = price;
      existing.source = params.source || existing.source || 'alchemy';
      if (params.updatedAt) (existing as any).updatedAt = params.updatedAt;
      await repo.save(existing);
      return;
    }

    const row = repo.create({
      chainId,
      address,
      currency: 'USD',
      price,
      source: params.source || 'alchemy',
    });
    if (params.updatedAt) (row as any).updatedAt = params.updatedAt;
    await repo.save(row);
  }
}
