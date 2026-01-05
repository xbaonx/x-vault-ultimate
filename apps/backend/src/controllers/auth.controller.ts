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

      console.log(`[Auth] SIWA token parsed: appleUserId=${String(appleUserId || '').slice(0, 8)}..., email=${email ? `${String(email).slice(0, 3)}...` : ''}`);

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

      console.log(`[Auth] SIWA user lookup result: ${user ? `found userId=${user.id}` : 'not found'}`);

      // Create User if not exists
      if (!user) {
        user = userRepo.create({
            appleUserId,
            email,
            usdzBalance: 20.0 // Welcome Bonus
        });
        await userRepo.save(user);
        console.log(`[Auth] New user created: ${user.id}. Welcome Bonus: 20 USDZ credited.`);
        
        // Re-fetch to get all default fields if needed, but for new user pin is null.
        const refetchedUser = await userRepo.findOne({ 
          where: { id: user.id },
          relations: ['wallets'],
          select: ['id', 'email', 'appleUserId', 'usdzBalance', 'spendingPinHash', 'createdAt', 'updatedAt']
        });
        
        if (!refetchedUser) {
            throw new Error("User creation failed or could not be retrieved");
        }
        user = refetchedUser;

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
      const wallets = await walletRepo.find({
          where: { user: { id: user.id } },
          order: { createdAt: 'ASC' },
      });

      console.log(`[Auth] Wallets for user ${user.id}: count=${wallets.length}, active=${wallets.filter(w => w.isActive).length}`);

      if (wallets.length === 0) {
        // Generate a REAL random wallet with private key
        const randomWallet = ethers.Wallet.createRandom();

        const mainWallet = walletRepo.create({
          user: user,
          name: 'Main Wallet',
          salt: 'random',
          address: randomWallet.address,
          privateKey: randomWallet.privateKey,
          isActive: true,
        });
        await walletRepo.save(mainWallet);
        console.log(`[Auth] Created default wallet for user ${user.id}: walletId=${mainWallet.id}, address=${mainWallet.address}`);
      } else {
        // Make sure we have exactly one active wallet (prefer existing active, else oldest).
        const active = wallets.find(w => w.isActive) || wallets[0];
        let changed = false;
        for (const w of wallets) {
          const shouldBeActive = w.id === active.id;
          if (w.isActive !== shouldBeActive) {
            w.isActive = shouldBeActive;
            changed = true;
          }
        }
        if (changed) {
          await walletRepo.save(wallets);
          console.log(`[Auth] Normalized active wallet for user ${user.id}: activeWalletId=${active.id}`);
        }
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
