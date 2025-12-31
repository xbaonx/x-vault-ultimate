import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { Device } from '../entities/Device';
import bcrypt from 'bcryptjs';

export class SecurityController {
  
  static async setSpendingPin(req: Request, res: Response) {
    try {
      // In a real app, this endpoint should be protected by:
      // 1. Biometric auth token (proof that user just authenticated)
      // 2. Or existing PIN if changing it
      
      const { userId, pin } = req.body;
      const deviceId = req.headers['x-device-library-id'] as string;
      if (!deviceId) {
          return res.status(401).json({ error: 'Device ID required' });
      }

      if (!pin || pin.length < 4 || pin.length > 6) {
        return res.status(400).json({ error: 'PIN must be 4-6 digits' });
      }

      // 1. Verify Device Ownership
      const deviceRepo = AppDataSource.getRepository(Device);
      const device = await deviceRepo.findOne({ 
          where: { deviceLibraryId: deviceId },
          relations: ['user']
      });

      if (!device || !device.user || device.user.id !== userId) {
        return res.status(404).json({ error: 'User not found or unauthorized device' });
      }

      const user = device.user;
      const userRepo = AppDataSource.getRepository(User);

      // Hash PIN
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(pin, salt);

      user.spendingPinHash = hash;
      await userRepo.save(user);

      console.log(`[Security] Spending PIN set for user ${user.id} via Device ${deviceId}`);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error in setSpendingPin:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async verifyPin(req: Request, res: Response) {
      // Helper endpoint to check PIN (e.g. before showing sensitive data)
      try {
        const { userId, pin } = req.body;
        const deviceId = req.headers['x-device-library-id'] as string;
        
        // 1. Verify Device Ownership
        const deviceRepo = AppDataSource.getRepository(Device);
        const device = await deviceRepo.findOne({ 
            where: { deviceLibraryId: deviceId },
            relations: ['user']
        });

        if (!device || !device.user || device.user.id !== userId) {
            return res.status(404).json({ error: 'Unauthorized device' });
        }

        const userRepo = AppDataSource.getRepository(User);
        const user = await userRepo.findOne({ 
            where: { id: userId },
            select: ['id', 'spendingPinHash'] // Explicitly select hash
        });

        if (!user || !user.spendingPinHash) {
            return res.status(400).json({ valid: false, error: 'PIN not set or user not found' });
        }

        const valid = await bcrypt.compare(pin, user.spendingPinHash);
        res.status(200).json({ valid });
      } catch (error) {
          console.error('Error in verifyPin:', error);
          res.status(500).json({ error: 'Internal server error' });
      }
  }
}
