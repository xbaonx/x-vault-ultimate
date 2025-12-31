import { Request, Response } from 'express';
import appleSignin from 'apple-signin-auth';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { Wallet } from '../entities/Wallet';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';

export class AuthController {
  
  static async loginWithApple(req: Request, res: Response) {
    try {
      const { identityToken, user: appleUserString } = req.body;
      
      if (!identityToken) {
        return res.status(400).json({ error: 'Missing identity token' });
      }

      // Verify identity token
      let email = '';
      let appleUserId = '';
      
      try {
          const { sub, email: tokenEmail } = await appleSignin.verifyIdToken(identityToken, {
            audience: config.apple.clientId,
            ignoreExpiration: true,
          });
          
          appleUserId = sub;
          email = tokenEmail || '';
      } catch (err: any) {
          console.error('Apple Token Verification Failed:', JSON.stringify(err, null, 2));
          
          // Fallback for Dev/Mock environment
          if (config.nodeEnv === 'development' && identityToken.startsWith('mock-')) {
              // Stable ID to simulate the same user logging in again
              appleUserId = `mock-apple-stable-id`;
              
              // Dynamic Email to simulate Apple's "Hide My Email" / Private Relay
              // This verifies that we can link the user by ID even if email changes.
              email = `mock-${Date.now()}@privaterelay.appleid.com`;
          } else {
              return res.status(401).json({ error: 'Invalid identity token' });
          }
      }

      const userRepo = AppDataSource.getRepository(User);
      
      // Build query criteria
      const whereCriteria: any[] = [{ appleUserId }];
      if (email) {
          whereCriteria.push({ email });
      }

      let user = await userRepo.findOne({ 
          where: whereCriteria,
          relations: ['wallets'],
          select: ['id', 'email', 'appleUserId', 'usdzBalance', 'spendingPinHash', 'createdAt', 'updatedAt'] // Explicitly select spendingPinHash to check existence
      });

      // Create User if not exists
      if (!user) {
        user = userRepo.create({
            appleUserId,
            email,
            usdzBalance: 25.0 // Welcome Bonus
        });
        await userRepo.save(user);
        console.log(`[Auth] New user created: ${user.id}. Welcome Bonus: 25 USDZ credited.`);
        
        // Re-fetch to get all default fields if needed, but for new user pin is null.
      } else {
          // Update fields if changed
          let hasUpdates = false;
          
          if (email && user.email !== email) {
              console.log(`[Auth] Updating email for user ${user.id}: ${user.email} -> ${email}`);
              user.email = email;
              hasUpdates = true;
          }
          
          if (appleUserId && user.appleUserId !== appleUserId) {
              user.appleUserId = appleUserId;
              hasUpdates = true;
          }
          
          if (hasUpdates) {
              await userRepo.save(user);
          }
      }

      // Ensure User has a Default Wallet
      const walletRepo = AppDataSource.getRepository(Wallet);
      let mainWallet = user.wallets?.find(w => w.name === 'Main Wallet');

      if (!mainWallet) {
          // Generate a REAL random wallet with private key
          const randomWallet = ethers.Wallet.createRandom();
          
          mainWallet = walletRepo.create({
              user,
              name: 'Main Wallet',
              salt: 'random', // No longer using salt for derivation
              address: randomWallet.address,
              privateKey: randomWallet.privateKey,
              isActive: true
          });
          await walletRepo.save(mainWallet);
      }

      // Determine status based on whether they have a device/pin set up
      // For now, we return basic info. The frontend checks if they have a device linked via other API or assumes flow.
      // But actually, "hasWallet" in the legacy response meant "has address".
      // Now "hasWallet" is always true after this step.
      // "hasPin" checks if spendingPinHash is set.
      
      res.status(200).json({ 
          userId: user.id,
          email: user.email,
          hasWallet: true,
          hasPin: !!user.spendingPinHash
      });
      
    } catch (error) {
      console.error('Error in loginWithApple:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
