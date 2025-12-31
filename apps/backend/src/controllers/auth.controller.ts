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
              appleUserId = `mock-apple-${uuidv4()}`;
              email = 'mock@example.com';
          } else {
              return res.status(401).json({ error: 'Invalid identity token' });
          }
      }

      const userRepo = AppDataSource.getRepository(User);
      let user = await userRepo.findOne({ 
          where: [{ appleUserId }, { email }],
          relations: ['wallets'] 
      });

      // Create User if not exists
      if (!user) {
        user = userRepo.create({
            appleUserId,
            email,
        });
        await userRepo.save(user);
      } else {
          // Update missing fields
          if (!user.email && email) user.email = email;
          if (!user.appleUserId && appleUserId) user.appleUserId = appleUserId;
          await userRepo.save(user);
      }

      // Ensure User has a Default Wallet
      const walletRepo = AppDataSource.getRepository(Wallet);
      let mainWallet = user.wallets?.find(w => w.name === 'Main Wallet');

      if (!mainWallet) {
          const salt = 'main';
          const hash = ethers.keccak256(ethers.toUtf8Bytes(`${user.id}-${salt}`));
          const address = ethers.getAddress(`0x${hash.substring(26)}`);

          mainWallet = walletRepo.create({
              user,
              name: 'Main Wallet',
              salt,
              address,
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
