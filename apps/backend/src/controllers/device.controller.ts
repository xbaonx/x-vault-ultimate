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
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { config } from '../config';
import { ethers } from 'ethers';
import { ProviderService } from '../services/provider.service';
import { deriveAaAddressFromCredentialPublicKey } from '../utils/aa-address';
import { AaAddressMapService } from '../services/aa-address-map.service';
import { TokenDiscoveryService } from '../services/token-discovery.service';
import { WalletSnapshot } from '../entities/WalletSnapshot';

export class DeviceController {
  
  // Helper to determine RP_ID and Origin dynamically if not set in env
  static getSecurityConfig(req: Request) {
    const requestOrigin = req.get('Origin') || '';
    let { rpId, origin } = config.security;

    // If we are in production or receiving a request from a real domain,
    // and the config is still default 'localhost' or 'zaur.at', try to adapt.
    if ((rpId === 'localhost' || rpId === 'zaur.at') && requestOrigin && !requestOrigin.includes('localhost')) {
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

  // Helpers for Base64/Base64URL conversion
  static toBase64URL(base64: string): string {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  static toBase64(base64url: string): string {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return base64;
  }

  /**
   * Login Flow Step 1: Generate Authentication Options (Assertion)
   * This allows existing users to sign in with a synced Passkey
   */
  static async generateLoginOptions(req: Request, res: Response) {
    try {
      const { userId } = req.body;
      const { rpId } = DeviceController.getSecurityConfig(req);

      if (!userId) {
        return res.status(400).json({ error: "User ID required" });
      }

      const deviceRepo = AppDataSource.getRepository(Device);

      const devices = await deviceRepo
        .createQueryBuilder('d')
        .select(['d.id', 'd.credentialID', 'd.transports'])
        .where('d.userId = :userId', { userId })
        .andWhere('d.isActive = :isActive', { isActive: true })
        .andWhere('d.credentialID IS NOT NULL')
        .getMany();

      if (devices.length === 0) {
        // No credentials found -> Must register
        return res.status(200).json({ canLogin: false, message: "No credentials found" });
      }

      const options = await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials: devices.map(d => ({
          // Ensure ID is Base64URL for the browser
          id: DeviceController.toBase64URL(d.credentialID),
          transports: d.transports ? (d.transports as any) : ['internal', 'hybrid'],
        })),
        userVerification: 'required',
      });

      // Save challenge to ALL candidate devices (since we don't know which one will sign yet)
      // In a stricter model, we might use a temporary auth session, but updating devices is OK for MVP.
      const deviceIds = devices.map(d => d.id).filter(Boolean);
      if (deviceIds.length > 0) {
        await deviceRepo
          .createQueryBuilder()
          .update(Device)
          .set({ currentChallenge: options.challenge })
          .where('id IN (:...ids)', { ids: deviceIds })
          .execute();
      }

      res.status(200).json({ canLogin: true, options });

    } catch (error) {
      console.error('Error generating login options:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Login Flow Step 2: Verify Authentication Response
   */
  static async verifyLogin(req: Request, res: Response) {
    try {
      const { userId, response } = req.body;
      const { rpId, origin } = DeviceController.getSecurityConfig(req);

      const credentialID = response.id; // Base64URL from client

      let clientChallenge: string | undefined;
      try {
        const clientDataJson = Buffer.from(
          DeviceController.toBase64(response?.response?.clientDataJSON || ''),
          'base64',
        ).toString('utf8');
        clientChallenge = JSON.parse(clientDataJson)?.challenge;
      } catch {
      }

      // 1. Find Device with Flexible Matching (Base64URL or Base64)
      const credentialIDBase64 = DeviceController.toBase64(credentialID);

      const deviceRepo = AppDataSource.getRepository(Device);
      const targetDevice = await deviceRepo
        .createQueryBuilder('d')
        .where('d.userId = :userId', { userId })
        .andWhere('d.isActive = :isActive', { isActive: true })
        .andWhere('(d.credentialID = :cid OR d.credentialID = :cidLegacy)', { cid: credentialID, cidLegacy: credentialIDBase64 })
        .getOne();

      if (!targetDevice) {
        console.warn(`[Device] VerifyLogin Failed: No device found for CredentialID ${credentialID} (or legacy equivalent)`);
        return res.status(400).json({ error: "Device credential not found or does not belong to user" });
      }

      if (!targetDevice.currentChallenge) {
        console.warn(`[Device] VerifyLogin Failed: No active challenge for Device ${targetDevice.id}`);
        return res.status(400).json({ error: "No active challenge for this device" });
      }

      if (targetDevice.currentChallenge.startsWith('used:') && clientChallenge) {
        const parts = targetDevice.currentChallenge.split(':');
        const usedChallenge = parts[1];
        const usedAt = Number(parts[2]);
        if (usedChallenge === clientChallenge && Number.isFinite(usedAt) && Date.now() - usedAt < 60_000) {
          return res.status(200).json({
            verified: true,
            deviceLibraryId: targetDevice.deviceLibraryId,
            walletAddress: '',
          });
        }
      }

      const verificationOptions = {
          response,
          expectedChallenge: targetDevice.currentChallenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          credential: {
            id: targetDevice.credentialID,
            publicKey: new Uint8Array(targetDevice.credentialPublicKey),
            counter: Number(targetDevice.counter || 0),
          },
      };

      let verification;
      try {
        verification = await verifyAuthenticationResponse(verificationOptions as any);
      } catch (e) {
        console.error(`[Device] Verification threw error:`, e);
        return res.status(400).json({ verified: false, error: "Verification failed", details: String(e) });
      }

      console.log(`[Device] Verification Result:`, JSON.stringify(verification, null, 2));

      if (!verification.verified) {
        console.error(`[Device] Verification failed: ${JSON.stringify(verification, null, 2)}`);
        return res.status(400).json({ verified: false, error: "Verification failed" });
      }

      // 4. Update Device
      const verifiedAtMs = Date.now();
      const usedChallengeMarker = `used:${targetDevice.currentChallenge}:${verifiedAtMs}`;
      targetDevice.counter = verification.authenticationInfo.newCounter;
      targetDevice.currentChallenge = usedChallengeMarker;
      targetDevice.lastActiveAt = new Date();
      
      // Self-healing: Migrate legacy Base64 ID to Base64URL if needed
      if (targetDevice.credentialID !== credentialID) {
        console.log(`[Device] Migrating credentialID to Base64URL for Device ${targetDevice.id}`);
        targetDevice.credentialID = credentialID;
      }

      await deviceRepo.save(targetDevice);

      // Respond immediately to avoid client-side timeouts; do heavier work in background.
      res.status(200).json({
        verified: true,
        deviceLibraryId: targetDevice.deviceLibraryId,
        walletAddress: '',
      });

      setImmediate(async () => {
        try {
          const baseSerialChainId = Number(config.blockchain.chainId);
          const serialAddress = await deriveAaAddressFromCredentialPublicKey({
            credentialPublicKey: Buffer.from(targetDevice.credentialPublicKey),
            chainId: baseSerialChainId,
            salt: 0,
          });

          const chains = Object.values(config.blockchain.chains || {});
          for (const c of chains) {
            try {
              const chainAddress = await deriveAaAddressFromCredentialPublicKey({
                credentialPublicKey: Buffer.from(targetDevice.credentialPublicKey),
                chainId: c.chainId,
                salt: 0,
              });
              await AaAddressMapService.upsert({
                chainId: c.chainId,
                aaAddress: chainAddress,
                serialNumber: serialAddress,
                deviceId: targetDevice.deviceLibraryId,
              });
            } catch {
            }
          }
        } catch (e) {
          console.warn('[Device] Background AA map upsert failed', e);
        }
      });
    } catch (error) {
      console.error('Error verifying login:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
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

      // In production, we should never create an anonymous/provisional user here.
      if (!userId && config.nodeEnv !== 'development') {
        return res.status(400).json({ error: 'User ID required' });
      }

      if (userId && !user) {
        return res.status(404).json({ error: 'User not found' });
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

      const deviceRepo = AppDataSource.getRepository(Device);
      const deviceLibraryId = uuidv4();
      const newDevice = deviceRepo.create({
        user,
        deviceLibraryId,
        name: 'New Device',
        isActive: false, // Pending verification
      });
      await deviceRepo.save(newDevice);

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
        // credential.id is Base64URL string. Store it directly.
        device.credentialID = credential.id;
        device.credentialPublicKey = Buffer.from(credential.publicKey);
        device.counter = credential.counter;
        device.isActive = true;
        device.currentChallenge = ''; // Clear challenge
        device.lastActiveAt = new Date();
        
        await deviceRepo.save(device);

        const chainId = Number(req.body.chainId || config.blockchain.chainId);
        const aaAddress = await deriveAaAddressFromCredentialPublicKey({
          credentialPublicKey: Buffer.from(device.credentialPublicKey),
          chainId,
          salt: 0,
        });

        const baseSerialChainId = Number(config.blockchain.chainId);
        const serialAddress = await deriveAaAddressFromCredentialPublicKey({
          credentialPublicKey: Buffer.from(device.credentialPublicKey),
          chainId: baseSerialChainId,
          salt: 0,
        });

        const chains = Object.values(config.blockchain.chains || {});
        for (const c of chains) {
          try {
            const chainAddress = await deriveAaAddressFromCredentialPublicKey({
              credentialPublicKey: Buffer.from(device.credentialPublicKey),
              chainId: c.chainId,
              salt: 0,
            });
            await AaAddressMapService.upsert({
              chainId: c.chainId,
              aaAddress: chainAddress,
              serialNumber: serialAddress,
              deviceId: device.deviceLibraryId,
            });
          } catch {
          }
        }

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
            walletAddress: aaAddress 
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
      const walletId = String((req.query as any)?.walletId || '');
      
      const deviceRepo = AppDataSource.getRepository(Device);

      const device = await deviceRepo.findOne({ where: { deviceLibraryId: deviceId }, relations: ['user'] });

      if (!device || !device.user || !device.credentialPublicKey) {
        return res.status(404).json({ error: 'Device not found' });
      }

      let walletSalt = 0;
      try {
        const walletRepo = AppDataSource.getRepository(Wallet);
        const wallet = walletId
          ? await walletRepo.findOne({ where: { id: walletId, user: { id: device.user.id } } })
          : await walletRepo.findOne({ where: { user: { id: device.user.id }, isActive: true } });
        walletSalt = Number((wallet as any)?.aaSalt ?? 0);
      } catch {
        walletSalt = 0;
      }

      const baseSerialChainId = Number(config.blockchain.chainId);
      const serialAddress = await deriveAaAddressFromCredentialPublicKey({
        credentialPublicKey: Buffer.from(device.credentialPublicKey),
        chainId: baseSerialChainId,
        salt: walletSalt,
        timeoutMs: 2000,
      });

      const snapshotRepo = AppDataSource.getRepository(WalletSnapshot);
      const snapshotRef = serialAddress && serialAddress.startsWith('0x')
        ? await snapshotRepo
            .createQueryBuilder('s')
            .where('LOWER(s.serialNumber) = LOWER(:sn)', { sn: serialAddress })
            .getOne()
        : null;

      const assets: Record<string, { amount: number; value: number; name?: string }> = {
        ...((snapshotRef?.assets as any) || {}),
      };

      const usdzBalance = Math.max(0, device.user.usdzBalance || 0);
      assets['usdz'] = { amount: Number(usdzBalance.toFixed(2)), value: Number(usdzBalance.toFixed(2)) };

      const totalBalanceUsd = Number(Number(snapshotRef?.totalBalanceUsd || 0).toFixed(2));

      const shouldRefreshSnapshot =
        !!(serialAddress && serialAddress.startsWith('0x')) &&
        (!snapshotRef || (snapshotRef.updatedAt && Date.now() - new Date(snapshotRef.updatedAt).getTime() > 60_000));

      if (shouldRefreshSnapshot) {
        setImmediate(async () => {
          try {
            let refreshTotalBalanceUsd = 0;
            const refreshAssets: Record<string, { amount: number; value: number; name?: string }> = {};

            const refreshUsdzBalance = Math.max(0, device.user.usdzBalance || 0);
            refreshAssets['usdz'] = { amount: Number(refreshUsdzBalance.toFixed(2)), value: Number(refreshUsdzBalance.toFixed(2)) };

            let prices: Record<string, number> = { ETH: 3000, MATIC: 1.0, DAI: 1.0, USDT: 1.0, USDC: 1.0 };
            try {
              const symbols = ['ETH', 'MATIC', 'DAI', 'USDT', 'USDC'];
              const requests = symbols.map(sym => fetch(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`).then(r => r.json()).catch(() => null));
              const results = await Promise.all(requests);
              results.forEach((data, index) => {
                if (data && data.data && data.data.amount) {
                  prices[symbols[index]] = parseFloat(data.data.amount);
                }
              });
            } catch {
            }

            const chains = Object.values(config.blockchain.chains || {});
            await Promise.all(chains.map(async (chain) => {
              try {
                const chainAddress = await deriveAaAddressFromCredentialPublicKey({
                  credentialPublicKey: Buffer.from(device.credentialPublicKey),
                  chainId: chain.chainId,
                  salt: walletSalt,
                  timeoutMs: 2000,
                });

                const provider = ProviderService.getProvider(chain.chainId);

                try {
                  const balanceWei = await Promise.race([
                    provider.getBalance(chainAddress),
                    new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 3000))
                  ]);
                  const nativeBalance = parseFloat(ethers.formatEther(balanceWei));
                  if (nativeBalance > 0) {
                    const price = chain.symbol === 'MATIC' || chain.symbol === 'POL' ? prices['MATIC'] : prices['ETH'];
                    const key = chain.symbol;
                    if (!refreshAssets[key]) refreshAssets[key] = { amount: 0, value: 0, name: key };
                    refreshAssets[key].amount += nativeBalance;
                    refreshAssets[key].value += nativeBalance * price;
                    refreshTotalBalanceUsd += nativeBalance * price;
                  }
                } catch {
                }

                const discovered = await TokenDiscoveryService.getErc20Assets({
                  chainId: chain.chainId,
                  address: chainAddress,
                  timeoutMs: 2500,
                  maxTokens: 40,
                  prices,
                });

                if (discovered.length) {
                  for (const t of discovered) {
                    const sym = String(t.symbol || '').toUpperCase();
                    if (!sym || sym === 'USDZ') continue;
                    if (!refreshAssets[sym]) refreshAssets[sym] = { amount: 0, value: 0, name: t.name || sym };
                    refreshAssets[sym].amount += t.amount;
                    refreshAssets[sym].value += t.value;
                    refreshTotalBalanceUsd += t.value;
                  }
                }
              } catch {
              }
            }));

            const snapshot = snapshotRef || snapshotRepo.create({
              serialNumber: serialAddress,
              totalBalanceUsd: 0,
              assets: null,
            });

            snapshot.totalBalanceUsd = Number(Number(refreshTotalBalanceUsd).toFixed(2));
            snapshot.assets = refreshAssets as any;
            await snapshotRepo.save(snapshot);
          } catch {
          }
        });
      }

      // If total balance is 0, let's put some dummy data for the user to see the beautiful UI (Mock Mode)
      // REMOVE THIS IN PRODUCTION
      // if (totalBalanceUsd === 0) {
      //   assets['ETH'] = { amount: 15.00, value: 33750 };
      //   assets['BTC'] = { amount: 0.52, value: 35100 };
      //   assets['USDT'] = { amount: 12000, value: 12000 };
      //   assets['SOL'] = { amount: 240.50, value: 0 }; // Value depends on price
      //   totalBalanceUsd = 80850 + 25; // Including usdz
      // }

      // FIX: Use HOST header for webServiceURL to ensure it points to the BACKEND, not the frontend (Origin)
      const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      const host = req.get('host');
      const serverUrl = `${protocol}://${host}`;

      const userData = {
        address: serialAddress,
        balance: totalBalanceUsd.toFixed(2),
        deviceId: deviceId,
        assets: assets,
        smartContract: "0x4337...Vault", // Placeholder
        securityDelay: "Active: 48h Window",
        origin: serverUrl // Pass the backend URL as origin
      };
      
      console.log(`[Device] Generating pass for ${deviceId} with Address: ${serialAddress}, Balance: ${totalBalanceUsd.toFixed(2)}, ServerUrl: ${serverUrl}`);

      const passBuffer = await PassService.generatePass(userData);
      
      console.log(`[Device] Pass generated successfully. Buffer size: ${passBuffer.length} bytes`);

      res.set('Content-Type', 'application/vnd.apple.pkpass');
      res.set('Content-Disposition', `attachment; filename=xvault-${deviceId}.pkpass`);
      res.send(passBuffer);
      
      console.log(`[Device] Sent pass response. Content-Type: application/vnd.apple.pkpass, Length: ${passBuffer.length}`);
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
