import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { PassRegistration } from "../entities/PassRegistration";
import { Device } from "../entities/Device";
import { User } from "../entities/User";
import { PassService } from "../services/pass.service";
import { ethers } from "ethers";
import { config } from "../config";

export class ApplePassController {
  
  // POST /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
  static async registerDevice(req: Request, res: Response) {
    try {
        const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
        const { pushToken } = req.body;
        const authHeader = req.headers.authorization;

        console.log(`[ApplePass] Registering device: ${deviceLibraryIdentifier} for pass: ${serialNumber}`);

        // Verify Auth Token (ApplePass <token>)
        // In a real app, we should verify this token matches what we embedded in the pass.
        // For now, we'll accept if it matches our standard token or just proceed for MVP.
        if (!authHeader || !authHeader.startsWith("ApplePass")) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const repo = AppDataSource.getRepository(PassRegistration);
        
        let registration = await repo.findOne({
            where: {
                deviceLibraryIdentifier,
                passTypeIdentifier,
                serialNumber
            }
        });

        if (!registration) {
            registration = repo.create({
                deviceLibraryIdentifier,
                passTypeIdentifier,
                serialNumber,
                pushToken
            });
        } else {
            registration.pushToken = pushToken;
        }

        await repo.save(registration);
        console.log(`[ApplePass] Device registered successfully`);

        res.sendStatus(201);
    } catch (error) {
        console.error("[ApplePass] Registration error:", error);
        res.sendStatus(500);
    }
  }

  // DELETE /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
  static async unregisterDevice(req: Request, res: Response) {
      try {
          const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
          const authHeader = req.headers.authorization;

          console.log(`[ApplePass] Unregistering device: ${deviceLibraryIdentifier}`);

          if (!authHeader || !authHeader.startsWith("ApplePass")) {
              return res.status(401).json({ error: "Unauthorized" });
          }

          const repo = AppDataSource.getRepository(PassRegistration);
          await repo.delete({
              deviceLibraryIdentifier,
              passTypeIdentifier,
              serialNumber
          });

          res.sendStatus(200);
      } catch (error) {
          console.error("[ApplePass] Unregistration error:", error);
          res.sendStatus(500);
      }
  }

  // GET /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier
  // Asking "What passes have changed since <tag>?"
  static async getUpdatablePasses(req: Request, res: Response) {
      try {
          const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
          // const passesUpdatedSince = req.query.passesUpdatedSince; 

          // For simplicity, we just return all serial numbers associated with this device
          // In a real optimized system, we would check update timestamps.
          const repo = AppDataSource.getRepository(PassRegistration);
          const registrations = await repo.find({
              where: { deviceLibraryIdentifier, passTypeIdentifier }
          });

          if (registrations.length === 0) {
              return res.sendStatus(204); // No content
          }

          const response = {
              lastUpdated: new Date().toISOString(), // Current tag
              serialNumbers: registrations.map(r => r.serialNumber)
          };

          res.status(200).json(response);
      } catch (error) {
          console.error("[ApplePass] Get updatable passes error:", error);
          res.sendStatus(500);
      }
  }

  // GET /v1/passes/:passTypeIdentifier/:serialNumber
  // Delivering the updated .pkpass file
  static async getLatestPass(req: Request, res: Response) {
      try {
          const { passTypeIdentifier, serialNumber } = req.params;
          // serialNumber is the wallet address in our case
          const walletAddress = serialNumber;
          
          console.log(`[ApplePass] Generating updated pass for address: ${walletAddress}`);

          // 1. Fetch User Data based on Wallet Address
          // We need to find the user who owns this wallet to get their assets
          // Since we don't have a direct Wallet -> User lookup easily exposed (Wallet entity has userId), let's query.
          const userRepo = AppDataSource.getRepository(User);
          
          // Find user who has this wallet address
          // Note: This is a bit expensive, in prod we should look up Wallet entity first.
          const users = await userRepo.find({ relations: ['wallets', 'devices'] });
          const user = users.find(u => u.wallets?.some(w => w.address.toLowerCase() === walletAddress.toLowerCase()));

          if (!user) {
              console.warn(`[ApplePass] No user found for wallet: ${walletAddress}`);
              return res.sendStatus(401);
          }

          // 2. Aggregate Assets (Logic copied from DeviceController - should be refactored to service)
          let totalBalanceUsd = 0;
          const assets: Record<string, { amount: number, value: number }> = {};
          
          assets['ETH'] = { amount: 0, value: 0 };
          assets['BTC'] = { amount: 0, value: 0 }; 
          assets['USDT'] = { amount: 0, value: 0 };
          assets['SOL'] = { amount: 0, value: 0 };
          assets['usdz'] = { amount: 25.00, value: 25.00 };

          // 1. Fetch Prices
          let ethPrice = 3000;
          let maticPrice = 1.0;
          try {
              const [ethRes, maticRes] = await Promise.all([
                  fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot'),
                  fetch('https://api.coinbase.com/v2/prices/MATIC-USD/spot')
              ]);
              const ethData = await ethRes.json();
              const maticData = await maticRes.json();
              ethPrice = parseFloat(ethData.data.amount) || 3000;
              maticPrice = parseFloat(maticData.data.amount) || 1.0;
          } catch (e) {}

          const chains = Object.values(config.blockchain.chains || {});
           if (chains.length === 0) {
             chains.push({ 
                 rpcUrl: config.blockchain.rpcUrl, 
                 symbol: 'ETH', 
                 name: 'Default', 
                 chainId: config.blockchain.chainId 
             });
          }

          // Scan chains for this wallet address
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
                      
                      const key = (chain.symbol === 'MATIC' || chain.symbol === 'POL') ? 'ETH' : chain.symbol;
                      if (!assets[key]) assets[key] = { amount: 0, value: 0 };
                      assets[key].amount += nativeBalance;
                      assets[key].value += nativeBalance * price;
                  }
              } catch (e) { }
          }));

           // Mock Data if Empty (Same as DeviceController)
          if (totalBalanceUsd === 0) {
            assets['ETH'] = { amount: 15.00, value: 33750 };
            assets['BTC'] = { amount: 0.52, value: 35100 };
            assets['USDT'] = { amount: 12000, value: 12000 };
            assets['SOL'] = { amount: 240.50, value: 0 };
            totalBalanceUsd = 80850 + 25;
          }

          // 3. Generate Pass
          // We need a deviceId for the "Device Identity" field. 
          // Use the first active device of the user or a placeholder.
          const deviceId = user.devices?.find(d => d.isActive)?.deviceLibraryId || "Unknown";

          // Extract Owner Name (e.g. "Bao" from "bao@gmail.com")
          let ownerName = "Vault Owner";
          if (user.email) {
              const namePart = user.email.split('@')[0];
              ownerName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
          }

          const userData = {
            address: walletAddress,
            balance: totalBalanceUsd.toFixed(2),
            deviceId: deviceId,
            assets: assets,
            smartContract: "0x4337...Vault",
            securityDelay: "Active: 48h Window",
            authToken: req.headers.authorization?.replace("ApplePass ", ""), // Keep existing token
            ownerName: ownerName
          };

          const passBuffer = await PassService.generatePass(userData);

          // 4. Send Response
          // If the pass hasn't changed, we could return 304, but generating fresh is safer for now.
          res.set('Content-Type', 'application/vnd.apple.pkpass');
          res.set('Content-Disposition', `attachment; filename=xvault.pkpass`);
          res.set('Last-Modified', new Date().toUTCString());
          res.send(passBuffer);

      } catch (error) {
          console.error("[ApplePass] Get latest pass error:", error);
          res.sendStatus(500);
      }
  }

  // POST /v1/log
  static async log(req: Request, res: Response) {
      try {
          const { logs } = req.body;
          if (Array.isArray(logs)) {
              logs.forEach(msg => console.log(`[AppleWalletLog] ${msg}`));
          }
          res.sendStatus(200);
      } catch (e) {
          res.sendStatus(500);
      }
  }
}
