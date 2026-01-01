import { AppDataSource } from '../data-source';
import { PassRegistration } from '../entities/PassRegistration';
import { ApnsService } from './apns.service';

export class PassUpdateService {
  static async notifyPassUpdateBySerialNumber(serialNumber: string) {
    if (!AppDataSource.isInitialized) return;

    if (!ApnsService.isEnabled()) {
      return;
    }

    const repo = AppDataSource.getRepository(PassRegistration);

    const registrations = await repo
      .createQueryBuilder('r')
      .where('LOWER(r.serialNumber) = LOWER(:serialNumber)', { serialNumber })
      .getMany();

    if (!registrations.length) {
      return;
    }

    await Promise.all(registrations.map(async (r) => {
      try {
        const result = await ApnsService.pushPassUpdate(r.pushToken);
        if (!result.ok) {
          console.warn('[PassUpdate] APNs push failed:', result);
        }
      } catch (e) {
        console.warn('[PassUpdate] Error pushing update:', e);
      }
    }));
  }
}
