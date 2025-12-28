import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { config } from '../config';

export class MigrationController {

    // Helper to get device ID from header
    private static getDeviceId(req: Request): string | undefined {
        return req.headers['x-device-library-id'] as string;
    }

    static async initiateMigration(req: Request, res: Response) {
        try {
            const { userId } = req.body;
            const newDeviceId = MigrationController.getDeviceId(req);

            if (!newDeviceId) {
                return res.status(400).json({ error: "Device ID header missing" });
            }

            const userRepo = AppDataSource.getRepository(User);
            const user = await userRepo.findOneBy({ id: userId });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            if (user.deviceLibraryId === newDeviceId) {
                return res.status(200).json({ status: 'active', message: "Device already linked" });
            }

            // If a migration is already pending for this device, return existing status
            if (user.pendingDeviceLibraryId === newDeviceId && user.migrationExpiry) {
                 return res.status(200).json({
                    status: 'pending',
                    expiry: user.migrationExpiry,
                    message: "Migration already in progress"
                });
            }

            // Start new migration
            // Default 48 hours delay
            const delayHours = 48;
            const expiryDate = new Date(Date.now() + delayHours * 60 * 60 * 1000);

            user.pendingDeviceLibraryId = newDeviceId;
            user.migrationExpiry = expiryDate;

            await userRepo.save(user);

            // MOCK: Send Email/Push to old device
            console.log(`[Migration] Started for user ${userId}. New Device: ${newDeviceId}. Expires: ${expiryDate}`);
            console.log(`[Notification] Sending security alert to ${user.email}...`);

            res.status(200).json({
                status: 'pending',
                expiry: expiryDate,
                message: "Security delay started. Check your email."
            });

        } catch (error) {
            console.error("Error in initiateMigration:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    static async checkStatus(req: Request, res: Response) {
        try {
            const { userId } = req.params;
            const currentDeviceId = MigrationController.getDeviceId(req);

            const userRepo = AppDataSource.getRepository(User);
            const user = await userRepo.findOneBy({ id: userId });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            // Case 1: Current device is the active one
            if (user.deviceLibraryId === currentDeviceId) {
                return res.status(200).json({ status: 'active' });
            }

            // Case 2: Current device is pending
            if (user.pendingDeviceLibraryId === currentDeviceId) {
                const now = new Date();
                const isExpired = user.migrationExpiry && now > user.migrationExpiry;

                return res.status(200).json({
                    status: 'pending',
                    expiry: user.migrationExpiry,
                    canFinalize: isExpired
                });
            }

            // Case 3: Unknown device
            return res.status(403).json({ status: 'unauthorized', error: "Device not recognized" });

        } catch (error) {
            console.error("Error in checkMigrationStatus:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    static async finalizeMigration(req: Request, res: Response) {
        try {
            const { userId } = req.body;
            const currentDeviceId = MigrationController.getDeviceId(req);

            const userRepo = AppDataSource.getRepository(User);
            const user = await userRepo.findOneBy({ id: userId });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            if (user.pendingDeviceLibraryId !== currentDeviceId) {
                 return res.status(403).json({ error: "This device is not pending migration" });
            }

            const now = new Date();
            if (!user.migrationExpiry || now < user.migrationExpiry) {
                return res.status(403).json({ 
                    error: "Security delay not yet passed",
                    expiry: user.migrationExpiry
                });
            }

            // Success: Switch devices
            console.log(`[Migration] Finalizing for user ${userId}. Switching ${user.deviceLibraryId} -> ${currentDeviceId}`);
            
            user.deviceLibraryId = currentDeviceId!;
            user.pendingDeviceLibraryId = ""; // Clear pending
            // user.migrationExpiry = null; // TypeORM handles null date/time differently depending on config, but logic ignores if pendingId is empty

            await userRepo.save(user);

            res.status(200).json({ status: 'active', message: "Device successfully linked" });

        } catch (error) {
             console.error("Error in finalizeMigration:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    static async cancelMigration(req: Request, res: Response) {
        try {
            const { userId } = req.body;
            // This endpoint should ideally be protected by Admin Auth OR signed token from email
            // For MVP, we allow it (assuming it comes from a secure context like the "Cancel" link logic)
            
            const userRepo = AppDataSource.getRepository(User);
            const user = await userRepo.findOneBy({ id: userId });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            // Cancel migration and FREEZE account for safety
            user.pendingDeviceLibraryId = "";
            user.isFrozen = true;

            await userRepo.save(user);

            console.log(`[Migration] Cancelled for user ${userId}. Account FROZEN.`);

            res.status(200).json({ status: 'cancelled', isFrozen: true });

        } catch (error) {
             console.error("Error in cancelMigration:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
