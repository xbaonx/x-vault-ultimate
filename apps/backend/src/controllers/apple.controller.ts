import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { PassRegistration } from "../entities/PassRegistration";
import { Device } from "../entities/Device";
import { User } from "../entities/User";
import { PassService } from "../services/pass.service";
import { ethers } from "ethers";
import { config } from "../config";

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
          const authHeader = req.headers.authorization;
          
          console.log(`[ApplePass] [Update Request] Serial: ${serialNumber}, PassType: ${passTypeIdentifier}`);
          console.log(`[ApplePass] [Update Request] Auth Header: ${authHeader ? 'Present' : 'Missing'}`);
          console.log(`[ApplePass] [Update Request] User-Agent: ${req.headers['user-agent']}`);

          // Verify Auth Token
          if (!authHeader || !authHeader.startsWith("ApplePass")) {
              console.warn(`[ApplePass] Unauthorized update request for ${serialNumber}`);
              return res.status(401).json({ error: "Unauthorized" });
          }

          // serialNumber is the wallet address in our case
          const walletAddress = serialNumber;
          
          // 1. Fetch User Data based on Wallet Address
          const userRepo = AppDataSource.getRepository(User);
          const users = await userRepo.find({ relations: ['wallets', 'devices'] });
          const user = users.find(u => u.wallets?.some(w => w.address.toLowerCase() === walletAddress.toLowerCase()));

          if (!user) {
              console.warn(`[ApplePass] No user found for wallet: ${walletAddress}`);
              return res.sendStatus(401);
          }

          console.log(`[ApplePass] Found user ${user.id} for wallet ${walletAddress}`);

          // 2. Aggregate Assets
          let totalBalanceUsd = 0;
          const assets: Record<string, { amount: number, value: number }> = {};
          
          assets['ETH'] = { amount: 0, value: 0 };
          assets['BTC'] = { amount: 0, value: 0 }; 
          assets['USDT'] = { amount: 0, value: 0 };
          assets['SOL'] = { amount: 0, value: 0 };
          assets['usdz'] = { amount: 25.00, value: 25.00 };

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
              console.error("[ApplePass] Failed to fetch prices:", e);
          }

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
                                  
                                  console.log(`[ApplePass] Found ${formattedBalance} ${token.symbol} on chain ${chain.chainId}`);
                              }
                          } catch (err) {
                              // Ignore token fetch errors (might be not deployed on testnet or RPC issue)
                          }
                      }));
                  }

              } catch (e) { 
                  console.error(`[ApplePass] Failed to scan chain ${chain.name}:`, e);
              }
          }));

          console.log(`[ApplePass] Calculated Total Balance: ${totalBalanceUsd}`);

           // Mock Data is DISABLED. 
           // If balance is 0, it stays 0.

          // 3. Generate Pass
          const deviceId = user.devices?.find(d => d.isActive)?.deviceLibraryId || "Unknown";

          // FIX: Use HOST header for webServiceURL to ensure it points to the BACKEND
          const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
          const host = req.get('host');
          const serverUrl = `${protocol}://${host}`;

          const userData = {
            address: walletAddress,
            balance: totalBalanceUsd.toFixed(2),
            deviceId: deviceId,
            assets: assets,
            smartContract: "0x4337...Vault",
            securityDelay: "Active: 48h Window",
            authToken: authHeader.replace("ApplePass ", ""),
            origin: serverUrl 
          };

          const passBuffer = await PassService.generatePass(userData);
          console.log(`[ApplePass] Generated new pass buffer. Size: ${passBuffer.length}`);

          // 4. Send Response
          res.set('Content-Type', 'application/vnd.apple.pkpass');
          res.set('Content-Disposition', `attachment; filename=xvault.pkpass`);
          res.set('Last-Modified', new Date().toUTCString());
          
          // Disable caching to ensure update
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.set('Pragma', 'no-cache');
          res.set('Expires', '0');

          res.send(passBuffer);
          console.log(`[ApplePass] Response sent successfully.`);

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
