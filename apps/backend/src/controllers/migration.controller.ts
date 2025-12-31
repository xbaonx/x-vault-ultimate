import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { Device } from '../entities/Device';
import { config } from '../config';

export class MigrationController {

    // Helper to get device ID from header
    private static getDeviceId(req: Request): string | undefined {
        return req.headers['x-device-library-id'] as string;
    }

    static async initiateMigration(req: Request, res: Response) {
        // Deprecated in Multi-Device Architecture.
        // Adding a new device is now handled by Auth/Device Controller directly.
        res.status(400).json({ error: "Migration flow is deprecated. Just sign in on the new device." });
    }

    static async checkStatus(req: Request, res: Response) {
        try {
            const { userId } = req.params;
            const currentDeviceId = MigrationController.getDeviceId(req);

            if (!currentDeviceId) {
                 return res.status(403).json({ error: "Device ID missing" });
            }

            // Check if this device exists and is active
            const deviceRepo = AppDataSource.getRepository(Device);
            const device = await deviceRepo.findOne({
                where: { deviceLibraryId: currentDeviceId },
                relations: ['user']
            });

            if (device && device.user.id === userId && device.isActive) {
                return res.status(200).json({ status: 'active' });
            }

            // If device doesn't exist or doesn't match user
            return res.status(403).json({ status: 'unauthorized', error: "Device not recognized" });

        } catch (error) {
            console.error("Error in checkMigrationStatus:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    static async finalizeMigration(req: Request, res: Response) {
         res.status(400).json({ error: "Migration flow is deprecated." });
    }

    static async cancelMigration(req: Request, res: Response) {
        res.status(400).json({ error: "Migration flow is deprecated." });
    }
}
