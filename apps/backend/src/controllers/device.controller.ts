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

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const TOKEN_MAP: Record<number, { address: string; symbol: string; decimals: number }[]> = {
    // Base
    8453: [
        { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI', decimals: 18 },
        { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 }
    ],
    // Ethereum
    1: [
        { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
        { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 }
    ],
    // Polygon
    137: [
        { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', decimals: 18 },
        { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
        { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 }
    ],
    // Arbitrum One
    42161: [
        { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', decimals: 18 },
        { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
        { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 }
    ],
    // Optimism
    10: [
        { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', decimals: 18 },
        { address: '0x94b008aA00579c1307B0EF2c499a98a359659fc9', symbol: 'USDT', decimals: 6 },
        { address: '0x0b2C639c533813f4Aa9D7837CAf992c96bdB5a5f', symbol: 'USDC', decimals: 6 }
    ]
};

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

      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOne({ 
        where: { id: userId },
        relations: ['devices']
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      console.log(`[Device] Checking login options for User ${userId}. Total Devices: ${user.devices?.length || 0}`);

      // Filter active devices with credentials
      const devices = user.devices.filter(d => {
        const hasCred = !!d.credentialID;
        console.log(`[Device] Device ${d.id} (${d.deviceLibraryId}): isActive=${d.isActive}, hasCred=${hasCred}`);
        return d.isActive && hasCred;
      });

      if (devices.length === 0) {
        console.log("[Device] No active devices with credentials found.");
        // No credentials found -> Must register
        return res.status(200).json({ canLogin: false, message: "No credentials found" });
      }

      const options = await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials: devices.map(d => ({
          // Ensure ID is Base64URL for the browser
          id: DeviceController.toBase64URL(DeviceController.toBase64URL(d.credentialID)),
          transports: d.transports ? (d.transports as any) : ['internal', 'hybrid'],
        })),
        userVerification: 'required',
      });

      // Save challenge to ALL candidate devices (since we don't know which one will sign yet)
      // In a stricter model, we might use a temporary auth session, but updating devices is OK for MVP.
      const deviceRepo = AppDataSource.getRepository(Device);
      for (const device of devices) {
        device.currentChallenge = options.challenge;
        await deviceRepo.save(device);
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

      // 1. Load User and Devices
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId }, relations: ['devices'] });

      if (!user) return res.status(404).json({ error: "User not found" });

      // 2. Find Device with Flexible Matching (Base64URL or Base64)
      const credentialIDBase64 = DeviceController.toBase64(credentialID);

      const targetDevice = user.devices.find(d => {
        // Match exact (Base64URL) OR Legacy (Base64)
        return d.credentialID === credentialID || d.credentialID === credentialIDBase64;
      });

      if (!targetDevice) {
        console.warn(`[Device] VerifyLogin Failed: No device found for CredentialID ${credentialID} (or legacy equivalent)`);
        return res.status(400).json({ error: "Device credential not found or does not belong to user" });
      }

      if (!targetDevice.currentChallenge) {
        console.warn(`[Device] VerifyLogin Failed: No active challenge for Device ${targetDevice.id}`);
        return res.status(400).json({ error: "No active challenge for this device" });
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
      targetDevice.counter = verification.authenticationInfo.newCounter;
      targetDevice.currentChallenge = '';
      targetDevice.lastActiveAt = new Date();
      
      // Self-healing: Migrate legacy Base64 ID to Base64URL if needed
      if (targetDevice.credentialID !== credentialID) {
        console.log(`[Device] Migrating credentialID to Base64URL for Device ${targetDevice.id}`);
        targetDevice.credentialID = credentialID;
      }

      const deviceRepo = AppDataSource.getRepository(Device);
      await deviceRepo.save(targetDevice);

      // 5. Success Response
      const walletRepo = AppDataSource.getRepository(Wallet);
      const mainWallet = await walletRepo.findOne({ 
        where: { user: { id: userId }, isActive: true } 
      });

      res.status(200).json({
        verified: true,
        deviceLibraryId: targetDevice.deviceLibraryId,
        walletAddress: mainWallet?.address,
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
      // Aggregate assets for the pass
      const assets: Record<string, { amount: number, value: number }> = {};
      
      // Initialize with some default tracked assets
      assets['ETH'] = { amount: 0, value: 0 };
      assets['BTC'] = { amount: 0, value: 0 }; 
      assets['USDT'] = { amount: 0, value: 0 };
      assets['SOL'] = { amount: 0, value: 0 };
      assets['usdz'] = { amount: 25.00, value: 25.00 }; // Internal Utility Credit

      if (walletAddress && walletAddress.startsWith('0x')) {
          // 1. Fetch Prices
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
          } catch (e) {
              console.warn("Failed to fetch prices for pass, using fallbacks");
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
                  
                  // 1. Native Balance
                  const balanceWei = await Promise.race([
                      provider.getBalance(walletAddress),
                      new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 3000))
                  ]);
                  const nativeBalance = parseFloat(ethers.formatEther(balanceWei));
                  if (nativeBalance > 0) {
                      const price = chain.symbol === 'MATIC' || chain.symbol === 'POL' ? prices['MATIC'] : prices['ETH'];
                      totalBalanceUsd += nativeBalance * price;
                      
                      const key = (chain.symbol === 'MATIC' || chain.symbol === 'POL') ? 'ETH' : chain.symbol;
                      if (!assets[key]) assets[key] = { amount: 0, value: 0 };
                      assets[key].amount += nativeBalance;
                      assets[key].value += nativeBalance * price;
                  }

                  // 2. ERC-20 Token Balances
                  const tokens = TOKEN_MAP[chain.chainId];
                  if (tokens) {
                      await Promise.all(tokens.map(async (token) => {
                          try {
                              const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
                              const tokenBalanceWei: bigint = await contract.balanceOf(walletAddress);
                              
                              if (tokenBalanceWei > 0n) {
                                  const formattedBalance = parseFloat(ethers.formatUnits(tokenBalanceWei, token.decimals));
                                  const price = prices[token.symbol] || 0;
                                  const value = formattedBalance * price;
                                  
                                  totalBalanceUsd += value;
                                  
                                  if (!assets[token.symbol]) assets[token.symbol] = { amount: 0, value: 0 };
                                  assets[token.symbol].amount += formattedBalance;
                                  assets[token.symbol].value += value;
                                  
                                  console.log(`[Device] Found ${formattedBalance} ${token.symbol} on chain ${chain.chainId}`);
                              }
                          } catch (err) {
                              // Ignore token fetch errors
                          }
                      }));
                  }

              } catch (e) { }
          }));
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

      const balance = totalBalanceUsd.toFixed(2);
      
      // FIX: Use HOST header for webServiceURL to ensure it points to the BACKEND, not the frontend (Origin)
      const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      const host = req.get('host');
      const serverUrl = `${protocol}://${host}`;

      const userData = {
        address: walletAddress,
        balance: balance,
        deviceId: deviceId,
        assets: assets,
        smartContract: "0x4337...Vault", // Placeholder
        securityDelay: "Active: 48h Window",
        origin: serverUrl // Pass the backend URL as origin
      };
      
      console.log(`[Device] Generating pass for ${deviceId} with Address: ${walletAddress}, Balance: ${balance}, ServerUrl: ${serverUrl}`);

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
