import { AppDataSource } from '../data-source';
import { AaAddressMap } from '../entities/AaAddressMap';

export class AaAddressMapService {
  static async upsert(params: {
    chainId: number;
    aaAddress: string;
    serialNumber: string;
    deviceId?: string;
  }): Promise<void> {
    if (!AppDataSource.isInitialized) return;

    const repo = AppDataSource.getRepository(AaAddressMap);

    const aaLower = (params.aaAddress || '').toLowerCase();
    if (!aaLower.startsWith('0x')) return;

    const serialLower = (params.serialNumber || '').toLowerCase();

    const id = `${params.chainId}:${aaLower}`;

    const row = repo.create({
      id,
      chainId: params.chainId,
      aaAddress: aaLower,
      serialNumber: serialLower,
      deviceId: params.deviceId || null,
    });

    await repo.save(row);
  }

  static async findDeviceIdByAddress(params: { chainId: number; aaAddress: string }): Promise<string | null> {
    if (!AppDataSource.isInitialized) return null;

    const repo = AppDataSource.getRepository(AaAddressMap);
    const aaLower = (params.aaAddress || '').toLowerCase();
    if (!aaLower.startsWith('0x')) return null;

    const id = `${params.chainId}:${aaLower}`;
    const row = await repo.findOne({ where: { id } });
    return row?.deviceId || null;
  }

  static async findSerialNumberByAddress(params: { chainId: number; aaAddress: string }): Promise<string | null> {
    if (!AppDataSource.isInitialized) return null;

    const repo = AppDataSource.getRepository(AaAddressMap);
    const aaLower = (params.aaAddress || '').toLowerCase();
    if (!aaLower.startsWith('0x')) return null;

    const id = `${params.chainId}:${aaLower}`;
    const row = await repo.findOne({ where: { id } });
    return row?.serialNumber || null;
  }

  static async findAaAddressBySerialNumber(params: { chainId: number; serialNumber: string }): Promise<string | null> {
    if (!AppDataSource.isInitialized) return null;

    const repo = AppDataSource.getRepository(AaAddressMap);
    const serialLower = (params.serialNumber || '').toLowerCase();
    if (!serialLower.startsWith('0x')) return null;

    const row = await repo
      .createQueryBuilder('m')
      .where('m.chainId = :chainId', { chainId: params.chainId })
      .andWhere('LOWER(m.serialNumber) = :serial', { serial: serialLower })
      .orderBy('m.updatedAt', 'DESC')
      .getOne();

    return row?.aaAddress || null;
  }
}
