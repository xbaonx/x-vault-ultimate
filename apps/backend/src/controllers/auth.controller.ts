import { Request, Response } from 'express';
import appleSignin from 'apple-signin-auth';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

export class AuthController {
  
  static async loginWithApple(req: Request, res: Response) {
    try {
      const { identityToken, user: appleUserString } = req.body;
      
      if (!identityToken) {
        return res.status(400).json({ error: 'Missing identity token' });
      }

      // Verify identity token
      // In production, verify against Apple's public keys
      // For MVP/Dev with mock, we might skip strict verification if configured to do so,
      // but let's assume we want to try real verification or fail gracefully.
      
      let email = '';
      let appleUserId = '';
      
      try {
          const { sub, email: tokenEmail } = await appleSignin.verifyIdToken(identityToken, {
            audience: config.apple.clientId,
            ignoreExpiration: true, // For testing if needed, usually false
          });
          
          appleUserId = sub;
          email = tokenEmail || '';
      } catch (err) {
          console.error('Apple Token Verification Failed:', err);
          // Fallback for Dev/Mock environment if token is obviously fake
          if (config.nodeEnv === 'development' && identityToken.startsWith('mock-')) {
              appleUserId = `mock-apple-${uuidv4()}`;
              email = 'mock@example.com';
          } else {
              return res.status(401).json({ error: 'Invalid identity token' });
          }
      }

      // If user object is provided (only on first sign in), use it to update name if we had name fields
      if (appleUserString) {
          try {
            const appleUser = JSON.parse(appleUserString);
            // We could save name here if User entity had firstName/lastName
          } catch (e) {}
      }

      const userRepo = AppDataSource.getRepository(User);
      let user = await userRepo.findOne({ where: { appleUserId } });

      if (!user && email) {
          // Try to find by email if appleUserId didn't match (rare case of linking?)
          user = await userRepo.findOne({ where: { email } });
      }

      if (!user) {
        // Create new user (provisional, will be fully activated after Passkey setup)
        user = userRepo.create({
            appleUserId,
            email,
            walletAddress: 'pending-' + uuidv4(), // Placeholder
        });
        await userRepo.save(user);
      } else {
          // Update email if missing
          if (!user.email && email) {
              user.email = email;
              await userRepo.save(user);
          }
          if (!user.appleUserId && appleUserId) {
              user.appleUserId = appleUserId;
              await userRepo.save(user);
          }
      }

      res.status(200).json({ 
          userId: user.id,
          email: user.email,
          hasWallet: !user.walletAddress.startsWith('pending-'),
          hasPin: !!user.spendingPinHash
      });
      
    } catch (error) {
      console.error('Error in loginWithApple:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
