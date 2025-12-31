import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PassService } from '../services/pass.service';
import { AppDataSource } from '../data-source';
import { PollingSession } from '../entities/PollingSession';
import { User } from '../entities/User';
import { Device } from '../entities/Device';
import { Wallet } from '../entities/Wallet';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { config } from '../config';
import { ethers } from 'ethers';

export class DeviceController {
  
  // Helper to determine RP_ID and Origin dynamically if not set in env
  static getSecurityConfig(req: Request) {
    const requestOrigin = req.get('Origin') || '';
    let { rpId, origin } = config.security;

    // If we are in production or receiving a request from a real domain,
    // and the config is still default 'localhost', try to adapt.
    if (rpId === 'localhost' && requestOrigin && !requestOrigin.includes('localhost')) {
      try {
        const url = new URL(requestOrigin);
        rpId = url.hostname;
        origin = requestOrigin;
        console.log(`[Device] Adapted RP_ID to ${rpId} and Origin to ${origin} from request.`);
      } catch (e) {
        console.warn('[Device] Failed to parse request origin for dynamic RP_ID fallback');
      }
    }

    return { rpId, origin };
  }

  /**
   * Step 1: Generate WebAuthn Registration Options
   */
  static async generateRegistrationOptions(req: Request, res: Response) {
    try {
      const { rpId } = DeviceController.getSecurityConfig(req);
      const { userId } = req.body; 
      
      const userRepo = AppDataSource.getRepository(User);
      let user: User | null = null;

      if (userId) {
          user = await userRepo.findOne({ where: { id: userId } });
      }

      if (!user) {
          // If no user found, we might need to create one (Anonymous/Provisional flow)
          // But ideally we should have a user from Auth step.
          // For now, create a provisional user.
          user = userRepo.create({
              email: `anon-${uuidv4().slice(0, 8)}@zaur.local`,
          });
          await userRepo.save(user);
          
          // Create default wallet for provisional user
          const walletRepo = AppDataSource.getRepository(Wallet);
          
          const randomWallet = ethers.Wallet.createRandom();
          
          const wallet = walletRepo.create({
              user,
              name: 'Main Wallet',
              salt: 'random',
              address: randomWallet.address,
              privateKey: randomWallet.privateKey,
              isActive: true
          });
          await walletRepo.save(wallet);
      }
      
      const username = user.email || `user-${user.id.slice(0, 8)}`;

      // Create a NEW Device entity for this registration attempt
      const deviceRepo = AppDataSource.getRepository(Device);
      const deviceLibraryId = uuidv4();
      
      const newDevice = deviceRepo.create({
          user,
          deviceLibraryId,
          name: 'New Device',
          isActive: false, // Pending verification
      });

      // Generate options
      const options = await generateRegistrationOptions({
        rpName: config.security.rpName,
        rpID: rpId,
        userID: new Uint8Array(Buffer.from(user.id)), // User ID binds the credential to the User Identity
        userName: username,
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
          authenticatorAttachment: 'platform',
        },
      });

      // Save challenge to the DEVICE entity
      newDevice.currentChallenge = options.challenge;
      await deviceRepo.save(newDevice);

      // Return the DEVICE ID as 'tempUserId' so verify step knows which device to update
      // The frontend treats this as an opaque ID handle.
      res.status(200).json({ options, tempUserId: newDevice.id });
    } catch (error) {
      console.error('Error generating registration options:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Step 2: Verify WebAuthn Registration Response
   */
  static async verifyRegistration(req: Request, res: Response) {
    try {
      const { tempUserId, response } = req.body; // tempUserId is actually Device.id here
      const { rpId, origin } = DeviceController.getSecurityConfig(req);
      
      const deviceRepo = AppDataSource.getRepository(Device);
      const device = await deviceRepo.findOne({ 
          where: { id: tempUserId },
          relations: ['user']
      });

      if (!device || !device.currentChallenge) {
        res.status(400).json({ error: 'Device registration session not found' });
        return;
      }

      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: device.currentChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credential } = verification.registrationInfo;

        // 1. Update Device with Credential Info
        device.credentialID = Buffer.from(credential.id).toString('base64');
        device.credentialPublicKey = Buffer.from(credential.publicKey);
        device.counter = credential.counter;
        device.isActive = true;
        device.currentChallenge = ''; // Clear challenge
        device.lastActiveAt = new Date();
        
        await deviceRepo.save(device);

        // 2. Fetch User's Wallet Address
        const walletRepo = AppDataSource.getRepository(Wallet);
        let mainWallet = await walletRepo.findOne({ 
            where: { user: { id: device.user.id }, isActive: true } 
        });
        
        // Safety net: If no wallet exists (migration case), create one deterministically
        if (!mainWallet) {
             console.log(`[Device] No wallet found for User ${device.user.id} during verification. Creating default...`);
             
             const randomWallet = ethers.Wallet.createRandom();
             
             mainWallet = walletRepo.create({
                 user: device.user,
                 name: 'Main Wallet',
                 salt: 'random',
                 address: randomWallet.address,
                 privateKey: randomWallet.privateKey,
                 isActive: true
             });
             await walletRepo.save(mainWallet);
        }
        
        const walletAddress = mainWallet.address;

        // 3. Create Session for Pass Generation
        const sessionRepo = AppDataSource.getRepository(PollingSession);
        const sessionId = uuidv4();
        const newSession = sessionRepo.create({
            id: sessionId,
            status: 'completed',
            deviceId: device.deviceLibraryId,
            passUrl: `/api/device/pass/${device.deviceLibraryId}`
        });
        await sessionRepo.save(newSession);

        console.log(`[Device] WebAuthn Registration success. User: ${device.user.id}, Device: ${device.deviceLibraryId}`);

        res.status(200).json({ 
            verified: true, 
            sessionId,
            deviceLibraryId: device.deviceLibraryId,
            walletAddress: walletAddress 
        });
      } else {
        res.status(400).json({ verified: false, error: 'Verification failed' });
      }

    } catch (error) {
      console.error('Error verifying registration:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async register(req: Request, res: Response) {
    // Legacy mock register - kept for fallback or testing
    try {
      const sessionRepo = AppDataSource.getRepository(PollingSession);
      const userRepo = AppDataSource.getRepository(User);
      const deviceRepo = AppDataSource.getRepository(Device);
      const walletRepo = AppDataSource.getRepository(Wallet);
      
      const sessionId = uuidv4();
      const newSession = sessionRepo.create({
        id: sessionId,
        status: 'pending'
      });
      await sessionRepo.save(newSession);
      
      console.log(`[Device] Created session (LEGACY): ${sessionId}.`);
      
      const deviceLibraryId = uuidv4();
      
      setTimeout(async () => {
        try {
            const session = await sessionRepo.findOneBy({ id: sessionId });
            if (session) {
                session.status = 'completed';
                session.deviceId = deviceLibraryId;
                session.passUrl = `/api/device/pass/${deviceLibraryId}`;
                await sessionRepo.save(session);

                // Create User + Wallet + Device
                let user = await userRepo.findOne({ where: { email: 'legacy@mock.com' } });
                if (!user) {
                    user = userRepo.create({
                        email: 'legacy@mock.com',
                    });
                    await userRepo.save(user);

                    const salt = 'main';
                    const hash = ethers.keccak256(ethers.toUtf8Bytes(`${user.id}-${salt}`));
                    const address = ethers.getAddress(`0x${hash.substring(26)}`);
                    const wallet = walletRepo.create({
                        user,
                        name: 'Main Wallet',
                        salt,
                        address,
                        isActive: true
                    });
                    await walletRepo.save(wallet);
                }

                let device = await deviceRepo.findOneBy({ deviceLibraryId });
                if (!device) {
                    device = deviceRepo.create({
                        user,
                        deviceLibraryId,
                        isActive: true,
                        name: 'Legacy Device'
                    });
                    await deviceRepo.save(device);
                }
            }
        } catch (err) {
            console.error(`[Device] Error updating session ${sessionId}:`, err);
        }
      }, 2000);

      res.status(200).json({ sessionId });
    } catch (error) {
      console.error('Error in register:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async pollStatus(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const sessionRepo = AppDataSource.getRepository(PollingSession);
      const session = await sessionRepo.findOneBy({ id: sessionId });

      console.log(`[Device] Polling session: ${sessionId}. Found: ${!!session}`);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.status(200).json(session);
    } catch (error) {
      console.error('Error in pollStatus:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async downloadPass(req: Request, res: Response) {
    try {
      const { deviceId } = req.params;
      
      const deviceRepo = AppDataSource.getRepository(Device);
      const device = await deviceRepo.findOne({
          where: { deviceLibraryId: deviceId },
          relations: ['user', 'user.wallets']
      });

      if (!device) {
         res.status(404).json({ error: 'Device not found' });
         return;
      }

      // Find Main Wallet
      const mainWallet = device.user.wallets?.find(w => w.isActive) || device.user.wallets?.[0];
      const walletAddress = mainWallet?.address || '0x0000000000000000000000000000000000000000';

      // Fetch Real Balance for Pass (Aggregated across chains)
      let totalBalanceUsd = 0;
      if (walletAddress && walletAddress.startsWith('0x')) {
          // 1. Fetch Prices
          let ethPrice = 0;
          let maticPrice = 0;
          try {
              const [ethRes, maticRes] = await Promise.all([
                  fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot'),
                  fetch('https://api.coinbase.com/v2/prices/MATIC-USD/spot')
              ]);
              const ethData = await ethRes.json();
              const maticData = await maticRes.json();
              ethPrice = parseFloat(ethData.data.amount) || 3000;
              maticPrice = parseFloat(maticData.data.amount) || 1.0;
          } catch (e) {
              console.warn("Failed to fetch prices for pass, using fallbacks");
              ethPrice = 3000;
              maticPrice = 1.0;
          }

          // 2. Scan all chains
          const chains = Object.values(config.blockchain.chains || {});
          if (chains.length === 0) {
             chains.push({ 
                 rpcUrl: config.blockchain.rpcUrl, 
                 symbol: 'ETH', 
                 name: 'Default', 
                 chainId: config.blockchain.chainId 
             });
          }

          await Promise.all(chains.map(async (chain) => {
              try {
                  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
                  const balanceWei = await Promise.race([
                      provider.getBalance(walletAddress),
                      new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 3000))
                  ]);
                  const nativeBalance = parseFloat(ethers.formatEther(balanceWei));
                  if (nativeBalance > 0) {
                      const price = chain.symbol === 'MATIC' || chain.symbol === 'POL' ? maticPrice : ethPrice;
                      totalBalanceUsd += nativeBalance * price;
                  }
              } catch (e) { }
          }));
      }

      const balance = totalBalanceUsd.toFixed(2);

      const userData = {
        address: walletAddress,
        balance: balance
      };

      const passBuffer = await PassService.generatePass(userData);

      res.set('Content-Type', 'application/vnd.apple.pkpass');
      res.set('Content-Disposition', `attachment; filename=xvault-${deviceId}.pkpass`);
      res.send(passBuffer);
    } catch (error) {
      console.error('Error in downloadPass:', error);
      res.status(500).json({ error: 'Failed to generate pass' });
    }
  }

  static async verifyDevice(req: Request, res: Response) {
    try {
      const deviceId = req.headers['x-device-library-id'] as string;
      
      if (!deviceId) {
        res.status(403).json({ error: 'Device ID missing' });
        return;
      }

      const deviceRepo = AppDataSource.getRepository(Device);
      const device = await deviceRepo.findOneBy({ deviceLibraryId: deviceId });

      if (!device || !device.isActive) {
        res.status(403).json({ error: 'Invalid or Inactive Device ID' });
        return;
      }

      res.status(200).json({ valid: true });
    } catch (error) {
      console.error('Error in verifyDevice:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
