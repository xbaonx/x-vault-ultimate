import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { Wallet } from '../entities/Wallet';
import { Device } from '../entities/Device';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

export class WalletController {
  static async getAddress(req: Request, res: Response) {
    try {
      // Authenticated by Gatekeeper
      const user = (req as any).user as User;
      
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const walletRepo = AppDataSource.getRepository(Wallet);
      // Get the requested wallet ID from query, or default to active/main
      const walletId = req.query.walletId as string;
      
      let wallet: Wallet | null = null;
      if (walletId) {
          wallet = await walletRepo.findOne({ where: { id: walletId, user: { id: user.id } } });
      } else {
          wallet = await walletRepo.findOne({ where: { user: { id: user.id }, isActive: true } });
      }

      const address = wallet?.address || '0x0000000000000000000000000000000000000000';

      res.status(200).json({ address, walletId: wallet?.id });
    } catch (error) {
      console.error('Error in getAddress:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async listWallets(req: Request, res: Response) {
    try {
        const user = (req as any).user as User;
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const walletRepo = AppDataSource.getRepository(Wallet);
        const wallets = await walletRepo.find({ 
            where: { user: { id: user.id } },
            order: { createdAt: 'ASC' }
        });

        res.status(200).json(wallets);
    } catch (error) {
        console.error('Error in listWallets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async createWallet(req: Request, res: Response) {
      try {
          const user = (req as any).user as User;
          if (!user) return res.status(401).json({ error: 'Unauthorized' });

          const { name } = req.body;
          const walletRepo = AppDataSource.getRepository(Wallet);
          
          // Generate deterministic address based on user ID and a unique salt (timestamp or uuid)
          const salt = uuidv4(); 
          const hash = ethers.keccak256(ethers.toUtf8Bytes(`${user.id}-${salt}`));
          const address = ethers.getAddress(`0x${hash.substring(26)}`);

          const newWallet = walletRepo.create({
              user,
              name: name || `Wallet ${new Date().toLocaleDateString()}`,
              salt,
              address,
              isActive: false // Default new wallets to inactive? Or active? Let's say inactive unless switched.
          });

          await walletRepo.save(newWallet);
          res.status(201).json(newWallet);
      } catch (error) {
          console.error('Error in createWallet:', error);
          res.status(500).json({ error: 'Internal server error' });
      }
  }

  static async getPortfolio(req: Request, res: Response) {
    try {
      const user = (req as any).user as User;

      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const walletId = req.query.walletId as string;
      const walletRepo = AppDataSource.getRepository(Wallet);
      
      let wallet: Wallet | null = null;
      if (walletId) {
          wallet = await walletRepo.findOne({ where: { id: walletId, user: { id: user.id } } });
      } else {
          wallet = await walletRepo.findOne({ where: { user: { id: user.id }, isActive: true } });
      }

      const address = wallet?.address;
      
      // If address is pending or invalid, return empty portfolio
      if (!address || !address.startsWith('0x')) {
         res.status(200).json({
            totalBalanceUsd: 0.00,
            assets: [],
            history: []
         });
         return;
      }

      // Fetch Real Prices
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
          console.warn("Failed to fetch prices, using fallbacks");
          ethPrice = 3000;
          maticPrice = 1.0;
      }

      // Define chains to scan
      const chains = Object.values(config.blockchain.chains);
      const assets: any[] = [];
      let totalBalanceUsd = 0;

      // Scan all chains in parallel
      await Promise.all(chains.map(async (chain) => {
          try {
              const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
              // Set a short timeout for RPC calls to avoid hanging
              const balanceWei = await Promise.race([
                  provider.getBalance(address),
                  new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 3000))
              ]);
              
              const nativeBalance = parseFloat(ethers.formatEther(balanceWei));
              
              if (nativeBalance > 0) {
                  const price = chain.symbol === 'MATIC' || chain.symbol === 'POL' ? maticPrice : ethPrice;
                  const valueUsd = nativeBalance * price;
                  
                  totalBalanceUsd += valueUsd;
                  assets.push({
                      symbol: chain.symbol,
                      balance: nativeBalance,
                      network: chain.name.toLowerCase(),
                      valueUsd: valueUsd
                  });
              }
          } catch (err) {
              console.warn(`Failed to fetch balance for ${chain.name}:`, err);
          }
      }));

      // Sort assets by value (descending)
      assets.sort((a, b) => b.valueUsd - a.valueUsd);

      // Construct Portfolio
      const portfolio = {
        totalBalanceUsd,
        assets,
        // Keep history empty for now as it requires an Indexer
        history: []
      };

      res.status(200).json(portfolio);
    } catch (error) {
      console.error('Error in getPortfolio:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async deployWallet(req: Request, res: Response) {
    // In "Lazy Deployment" model, this might be called manually or just triggered by a transaction.
    // For this endpoint, we can check if it's deployed and if not, return the initCode.
    res.status(200).json({ status: 'lazy', message: 'Wallet will be deployed on first transaction' });
  }

  /**
   * Step 1: Generate Challenge for Transaction Signing
   */
  static async getTransactionOptions(req: Request, res: Response) {
    try {
      const device = (req as any).device as Device;

      if (!device) {
        res.status(401).json({ error: 'Unauthorized Device' });
        return;
      }

      const options = await generateAuthenticationOptions({
        rpID: config.security.rpId === 'localhost' ? 'localhost' : config.security.rpId,
        allowCredentials: device.credentialID ? [{
          id: device.credentialID,
          transports: ['internal'],
        }] : [],
        userVerification: 'required',
      });

      // Save challenge to DEVICE
      device.currentChallenge = options.challenge;
      const deviceRepo = AppDataSource.getRepository(Device);
      await deviceRepo.save(device);

      res.status(200).json(options);
    } catch (error) {
      console.error('Error generating transaction options:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Step 2: Verify Signature and Execute Transaction
   */
  static async sendTransaction(req: Request, res: Response) {
    try {
      const { transaction, signature } = req.body;
      const device = (req as any).device as Device;
      const user = (req as any).user as User;

      if (!device || !device.currentChallenge) {
        res.status(400).json({ error: 'Device or challenge not found' });
        return;
      }

      // Verify Passkey Signature (Authentication Assertion)
      let verification;
      try {
          verification = await verifyAuthenticationResponse({
            response: signature,
            expectedChallenge: device.currentChallenge,
            expectedOrigin: config.security.origin,
            expectedRPID: config.security.rpId,
            credentialPublicKey: device.credentialPublicKey,
            credentialID: device.credentialID,
            counter: device.counter,
          } as any);
      } catch (err) {
          console.error('Verification failed:', err);
          return res.status(401).json({ error: 'Invalid signature', details: err });
      }

      if (verification.verified) {
          // Update device counter
          device.counter = verification.authenticationInfo.newCounter;
          device.currentChallenge = ''; // Clear challenge
          
          const deviceRepo = AppDataSource.getRepository(Device);
          await deviceRepo.save(device);

          // ---------------------------------------------------------
          // AT THIS POINT, THE REQUEST IS AUTHENTICATED & NON-REPUDIABLE
          // ---------------------------------------------------------
          
          console.log(`[Wallet] Transaction authorized for User ${user.id} via Device ${device.deviceLibraryId}:`, transaction);

          // TODO: Submit transaction to Blockchain via Relayer/Bundler
          // For MVP, we simulate success
          
          res.status(200).json({ 
              success: true, 
              txHash: ethers.hexlify(ethers.randomBytes(32)) // Mock Hash
          });
      } else {
          res.status(401).json({ error: 'Signature verification failed' });
      }

    } catch (error) {
      console.error('Error in sendTransaction:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
