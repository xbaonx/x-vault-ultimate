import { Request, Response } from 'express';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';

export class SecurityController {
  
  static async setSpendingPin(req: Request, res: Response) {
    try {
      // In a real app, this endpoint should be protected by:
      // 1. Biometric auth token (proof that user just authenticated)
      // 2. Or existing PIN if changing it
      
      const { userId, pin } = req.body;
      // Also expect a 'deviceLibraryId' in headers to verify caller, or use the 'user' attached by middleware if we had auth middleware for users.
      // For now, we'll rely on userId + deviceId check.
      
      const deviceId = req.headers['x-device-library-id'] as string;
      if (!deviceId) {
          return res.status(401).json({ error: 'Device ID required' });
      }

      if (!pin || pin.length < 4 || pin.length > 6) {
        return res.status(400).json({ error: 'PIN must be 4-6 digits' });
      }

      const userRepo = AppDataSource.getRepository(User);
      // Find user by ID AND Device ID to ensure ownership
      const user = await userRepo.findOne({ 
          where: { id: userId, deviceLibraryId: deviceId } 
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or unauthorized device' });
      }

      // Hash PIN
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(pin, salt);

      user.spendingPinHash = hash;
      await userRepo.save(user);

      console.log(`[Security] Spending PIN set for user ${user.id}`);
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
        
        const userRepo = AppDataSource.getRepository(User);
        const user = await userRepo.findOne({ 
            where: { id: userId, deviceLibraryId: deviceId },
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
