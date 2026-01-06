import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { AppDataSource } from '../data-source';
import { config } from '../config';
import { ProviderService } from '../services/provider.service';
import { deriveAaAddressFromCredentialPublicKey } from '../utils/aa-address';
import { AaAddressMapService } from '../services/aa-address-map.service';
import { TokenDiscoveryService } from '../services/token-discovery.service';
import { User } from '../entities/User';
import { Wallet } from '../entities/Wallet';
import { Device } from '../entities/Device';
import { Transaction } from '../entities/Transaction';
import { WalletSnapshot } from '../entities/WalletSnapshot';

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

let portfolioPriceCache: { updatedAt: number; prices: Record<string, number> } | null = null;

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

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
        { address: '0x94b008aa00579c1307b0ef2c499a98a359659fc9', symbol: 'USDT', decimals: 6 },
        { address: '0x0b2C639c533813f4Aa9D7837CAf992c96bdB5a5f', symbol: 'USDC', decimals: 6 }
    ]
};

export class WalletController {
  static async getAddress(req: Request, res: Response) {
    try {
      // Authenticated by Gatekeeper
      const user = (req as any).user as User;
      const device = (req as any).device as Device;
      
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const chainIdRaw = (req.query as any)?.chainId;
      const chainId = Number(chainIdRaw || config.blockchain.chainId);
      const chainIdProvided = chainIdRaw !== undefined && chainIdRaw !== null && String(chainIdRaw).trim().length > 0;
      
      const walletRepo = AppDataSource.getRepository(Wallet);
      // Get the requested wallet ID from query, or default to active/main
      const walletId = req.query.walletId as string;
      
      let wallet: Wallet | null = null;
      if (walletId) {
          wallet = await walletRepo.findOne({ where: { id: walletId, user: { id: user.id } } });
      } else {
          wallet = await walletRepo.findOne({ where: { user: { id: user.id }, isActive: true } });
      }

      const legacyEoaAddress = wallet?.address || '0x0000000000000000000000000000000000000000';

      // If caller specifies chainId, keep legacy response shape (single address)
      if (chainIdProvided) {
        if (device?.credentialPublicKey && wallet) {
          try {
            const aaAddress = await deriveAaAddressFromCredentialPublicKey({
              credentialPublicKey: Buffer.from(device.credentialPublicKey),
              chainId,
              salt: wallet.aaSalt ?? 0,
            });

            res.status(200).json({ address: aaAddress, walletId: wallet.id, chainId });
            return;
          } catch {
            // fall back
          }
        }

        res.status(200).json({ address: legacyEoaAddress, walletId: wallet?.id, chainId });
        return;
      }

      // Otherwise, return all chain AA addresses to avoid ambiguity (UI can pick)
      const defaultChainId = Number(config.blockchain.chainId);
      const chains = Object.values(config.blockchain.chains);
      const aaAddresses: Record<number, string> = {};
      if (device?.credentialPublicKey && wallet) {
        await Promise.all(chains.map(async (c) => {
          try {
            const aa = await deriveAaAddressFromCredentialPublicKey({
              credentialPublicKey: Buffer.from(device.credentialPublicKey),
              chainId: c.chainId,
              salt: wallet.aaSalt ?? 0,
              timeoutMs: 1500,
            });
            if (aa && String(aa).startsWith('0x')) {
              aaAddresses[c.chainId] = String(aa);
            }
          } catch {
          }
        }));
      }

      const address = aaAddresses[defaultChainId] || legacyEoaAddress;
      res.status(200).json({ address, walletId: wallet?.id, chainId: defaultChainId, defaultChainId, aaAddresses, legacyEoaAddress });
    } catch (error) {
      console.error('Error in getAddress:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async listWallets(req: Request, res: Response) {
    try {
        const user = (req as any).user as User;
        const device = (req as any).device as Device;
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const walletRepo = AppDataSource.getRepository(Wallet);
        const wallets = await walletRepo.find({ 
            where: { user: { id: user.id } },
            order: { createdAt: 'ASC' }
        });

        const repairRaw = String((req.query as any)?.repair ?? '').trim().toLowerCase();
        const repair = repairRaw === '1' || repairRaw === 'true' || repairRaw === 'yes';
        if (repair && wallets.length > 1) {
          const used = new Set<number>();
          let nextSalt = 0;
          let changed = false;
          for (const w of wallets) {
            const current = typeof (w as any).aaSalt === 'number' ? (w as any).aaSalt : 0;
            if (used.has(current)) {
              while (used.has(nextSalt)) nextSalt++;
              (w as any).aaSalt = nextSalt;
              used.add(nextSalt);
              nextSalt++;
              changed = true;
            } else {
              used.add(current);
              if (current >= nextSalt) nextSalt = current + 1;
              (w as any).aaSalt = current;
            }
          }

          if (changed) {
            await walletRepo.save(wallets);
          }
        }

        const defaultChainId = Number(config.blockchain.chainId);
        const chains = Object.values(config.blockchain.chains);
        const withAa = await Promise.all(wallets.map(async (w) => {
          const aaAddresses: Record<number, string> = {};
          if (device?.credentialPublicKey) {
            await Promise.all(chains.map(async (c) => {
              try {
                const aa = await deriveAaAddressFromCredentialPublicKey({
                  credentialPublicKey: Buffer.from(device.credentialPublicKey),
                  chainId: c.chainId,
                  salt: (w as any).aaSalt ?? 0,
                  timeoutMs: 1500,
                });
                if (aa && String(aa).startsWith('0x')) {
                  aaAddresses[c.chainId] = String(aa);
                }
              } catch {
              }
            }));
          }

          const aaAddress = aaAddresses[defaultChainId] || null;
          return { ...w, aaAddress, aaAddresses };
        }));

        res.status(200).json(withAa);
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
          
          const existing = await walletRepo.find({ where: { user: { id: user.id } }, order: { createdAt: 'ASC' } });
          const used = new Set<number>(existing.map(w => (w as any).aaSalt ?? 0));
          let aaSalt = 0;
          while (used.has(aaSalt)) aaSalt++;

          const newWallet = walletRepo.create({
              user,
              name: name || `Wallet ${new Date().toLocaleDateString()}`,
              salt: 'random',
              address: ethers.ZeroAddress,
              aaSalt,
              isActive: existing.length === 0
          });

          await walletRepo.save(newWallet);
          res.status(201).json({
              id: newWallet.id,
              address: newWallet.address,
              name: newWallet.name,
              aaSalt: newWallet.aaSalt,
              salt: newWallet.salt,
              isActive: newWallet.isActive,
              createdAt: newWallet.createdAt,
              updatedAt: newWallet.updatedAt,
          });
      } catch (error) {
          console.error('Error in createWallet:', error);
          res.status(500).json({ error: 'Internal server error' });
      }
  }

  static async getPortfolio(req: Request, res: Response) {
    try {
      const user = (req as any).user as User;
      const device = (req as any).device as Device;

      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const walletId = req.query.walletId as string;
      const refreshRaw = String((req.query as any)?.refresh ?? '').trim().toLowerCase();
      const refresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'yes';
      const walletRepo = AppDataSource.getRepository(Wallet);
      
      let wallet: Wallet | null = null;
      if (walletId) {
          wallet = await walletRepo.findOne({ where: { id: walletId, user: { id: user.id } } });
      } else {
          wallet = await walletRepo.findOne({ where: { user: { id: user.id }, isActive: true } });
      }

      const address = wallet?.address;

      const baseSerialChainId = Number(config.blockchain.chainId);
      let baseSerialNumber: string | null = null;
      if (device?.credentialPublicKey) {
        try {
          baseSerialNumber = await deriveAaAddressFromCredentialPublicKey({
            credentialPublicKey: Buffer.from(device.credentialPublicKey),
            chainId: baseSerialChainId,
            salt: wallet?.aaSalt ?? 0,
            timeoutMs: 1500,
          });
        } catch {
          baseSerialNumber = null;
        }
      }

      // Cache-first: if we already have a snapshot, return it unless caller explicitly requests refresh.
      if (baseSerialNumber && AppDataSource.isInitialized && !refresh) {
        try {
          const snapshotRepo = AppDataSource.getRepository(WalletSnapshot);
          const snapshot = await snapshotRepo.findOne({ where: { serialNumber: baseSerialNumber } });
          if (snapshot?.portfolio && typeof snapshot.portfolio === 'object') {
            const txRepo = AppDataSource.getRepository(Transaction);
            const dbTransactions = await txRepo.find({
              where: { userId: user.id },
              order: { createdAt: 'DESC' },
              take: 20,
            });

            const history = dbTransactions.map((tx) => ({
              id: tx.id,
              type: 'send',
              amount: parseFloat(tx.value || '0').toString(),
              token: tx.asset || 'ETH',
              date: tx.createdAt,
              status: tx.status,
              hash: tx.txHash || tx.userOpHash,
              txHash: tx.txHash || null,
              explorerUrl: tx.explorerUrl || null,
              network: tx.network
            }));

            return res.status(200).json({
              totalBalanceUsd: snapshot.totalBalanceUsd || 0,
              assets: Array.isArray(snapshot.portfolio.assets) ? snapshot.portfolio.assets : [],
              history,
              updatedAt: snapshot.updatedAt,
            });
          }
        } catch {
          // ignore cache errors and fall through
        }
      }
      
      // If legacy address is missing and we also can't derive AA, return empty portfolio
      if ((!address || !address.startsWith('0x')) && !device?.credentialPublicKey) {
         res.status(200).json({
            totalBalanceUsd: 0.00,
            assets: [],
            history: []
         });
         return;
      }

      // Fetch Real Prices
      const prices: Record<string, number> = { ETH: 3000, MATIC: 1.0, POL: 1.0, DAI: 1.0, USDT: 1.0, USDC: 1.0 };
      let ethPrice = 3000;
      let maticPrice = 1.0;
      
      try {
          const now = Date.now();
          if (portfolioPriceCache && now - portfolioPriceCache.updatedAt < 60_000) {
              Object.assign(prices, portfolioPriceCache.prices);
              ethPrice = prices.ETH;
              maticPrice = prices.MATIC;
              prices.POL = prices.MATIC;
          } else {
              const symbols = ['ETH', 'MATIC'];
              const requests = symbols.map(sym =>
                  fetchJsonWithTimeout(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`, 1500)
                    .catch(() => null)
              );

              const results = await Promise.all(requests);

              results.forEach((data, index) => {
                  if (data && data.data && data.data.amount) {
                      const price = parseFloat(data.data.amount);
                      prices[symbols[index]] = price;
                      if (symbols[index] === 'ETH') ethPrice = price;
                      if (symbols[index] === 'MATIC') maticPrice = price;
                  }
              });

              prices.POL = prices.MATIC;

              portfolioPriceCache = { updatedAt: now, prices: { ...prices } };
          }
      } catch (e) {
          console.warn("Failed to fetch prices, using fallbacks");
      }

      // Define chains to scan
      const chains = Object.values(config.blockchain.chains);
      const assets: any[] = [];
      let totalBalanceUsd = 0;

      // Scan all chains in parallel
      await Promise.all(chains.map(async (chain) => {
          try {
              let scanAddress: string | null = null;

              // IMPORTANT: If device has passkey, portfolio should scan AA address (not legacy EOA).
              if (device?.credentialPublicKey) {
                // Prefer cached mapping (serialNumber -> chain AA address) to avoid RPC derive timeouts
                if (baseSerialNumber) {
                  try {
                    const mapped = await AaAddressMapService.findAaAddressBySerialNumber({
                      chainId: chain.chainId,
                      serialNumber: baseSerialNumber,
                    });
                    if (mapped && mapped.startsWith('0x')) {
                      scanAddress = mapped;
                    }
                  } catch {
                  }
                }

                // If no mapping found, derive and then cache it
                if (!scanAddress) {
                  try {
                    scanAddress = await deriveAaAddressFromCredentialPublicKey({
                      credentialPublicKey: Buffer.from(device.credentialPublicKey),
                      chainId: chain.chainId,
                      salt: wallet?.aaSalt ?? 0,
                      timeoutMs: 2000,
                    });

                    if (baseSerialNumber && scanAddress && scanAddress.startsWith('0x')) {
                      try {
                        await AaAddressMapService.upsert({
                          chainId: chain.chainId,
                          aaAddress: scanAddress,
                          serialNumber: baseSerialNumber,
                          deviceId: device.deviceLibraryId,
                        });
                      } catch {
                      }
                    }
                  } catch {
                    scanAddress = null;
                  }
                }
              }

              // Fallback to legacy EOA address only when AA is not available.
              if (!scanAddress) {
                scanAddress = address || null;
              }

              if (!scanAddress || !scanAddress.startsWith('0x')) {
                return;
              }

              // Use singleton provider
              const provider = ProviderService.getProvider(chain.chainId);
              
              // 1. Native Balance
              // Set a short timeout for RPC calls to avoid hanging
              try {
                  const balanceWei = await Promise.race([
                      provider.getBalance(scanAddress),
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
                          valueUsd: valueUsd,
                          decimals: 18,
                          chainId: chain.chainId,
                          isNative: true
                      });
                  }
              } catch (e) {
                   // Native balance fetch failed (timeout or error), continue to tokens
              }

              // 2. ERC-20 Token Balances
              let discovered: Array<{ symbol: string; name: string; amount: number; value: number; contractAddress: string; decimals: number }> = [];
              try {
                discovered = await TokenDiscoveryService.getErc20Assets({
                  chainId: chain.chainId,
                  address: scanAddress,
                  timeoutMs: 2500,
                  maxTokens: 40,
                  prices,
                });
              } catch {
                discovered = [];
              }

              if (discovered.length) {
                for (const t of discovered) {
                  const sym = String(t.symbol || '').toUpperCase();
                  if (!sym || sym === 'USDZ') continue;

                  const valueUsd = Number(Number(t.value || 0).toFixed(2));
                  totalBalanceUsd += valueUsd;
                  assets.push({
                    symbol: sym,
                    balance: t.amount,
                    network: chain.name.toLowerCase(),
                    valueUsd,
                    tokenAddress: t.contractAddress,
                    decimals: t.decimals,
                    chainId: chain.chainId,
                    isNative: false,
                    name: t.name,
                  });
                }
              } else {
                // Fallback to curated list for non-Alchemy RPCs
                const tokens = TOKEN_MAP[chain.chainId];
                if (tokens) {
                  await Promise.all(tokens.map(async (token) => {
                    try {
                      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
                      // Add timeout for token calls too
                      const tokenBalanceWei = await Promise.race([
                        contract.balanceOf(scanAddress),
                        new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('Token RPC Timeout')), 3000))
                      ]) as bigint;

                      if (tokenBalanceWei > 0n) {
                        const formattedBalance = parseFloat(ethers.formatUnits(tokenBalanceWei, token.decimals));
                        const price = prices[token.symbol] || 0;
                        const value = formattedBalance * price;

                        totalBalanceUsd += value;
                        assets.push({
                          symbol: token.symbol,
                          balance: formattedBalance,
                          network: chain.name.toLowerCase(),
                          valueUsd: value,
                          tokenAddress: token.address,
                          decimals: token.decimals,
                          chainId: chain.chainId,
                          isNative: false
                        });
                      }
                    } catch (err) {
                      // Ignore token fetch errors
                    }
                  }));
                }
              }

          } catch (err) {
              console.warn(`Failed to fetch balance for ${chain.name}:`, err);
          }
      }));

      // Sort assets by value (descending)
      assets.sort((a, b) => b.valueUsd - a.valueUsd);

      // Fetch Transaction History (Local DB)
      const txRepo = AppDataSource.getRepository(Transaction);
      const dbTransactions = await txRepo.find({
          where: { userId: user.id },
          order: { createdAt: 'DESC' },
          take: 20
      });

      const history = dbTransactions.map((tx: Transaction) => ({
          id: tx.id,
          type: 'send', // Mostly sends for now
          amount: parseFloat(tx.value || '0').toString(),
          token: tx.asset || 'ETH',
          date: tx.createdAt,
          status: tx.status,
          hash: tx.txHash || tx.userOpHash,
          txHash: tx.txHash || null,
          explorerUrl: tx.explorerUrl || null,
          network: tx.network
      }));

      // Construct Portfolio
      const portfolio = {
        totalBalanceUsd,
        assets,
        history
      };

      // Persist snapshot for fast subsequent loads.
      if (baseSerialNumber && AppDataSource.isInitialized) {
        try {
          const snapshotRepo = AppDataSource.getRepository(WalletSnapshot);
          const existing = await snapshotRepo.findOne({ where: { serialNumber: baseSerialNumber } });

          // Aggregate assets into a per-symbol map for Apple pass usage.
          const assetsMap: Record<string, { amount: number; value: number; name?: string }> = {};
          for (const a of assets) {
            const sym = String(a?.symbol || '').toLowerCase();
            if (!sym) continue;
            if (!assetsMap[sym]) assetsMap[sym] = { amount: 0, value: 0, name: a?.name };
            assetsMap[sym].amount += Number(a?.balance || 0);
            assetsMap[sym].value += Number(a?.valueUsd || 0);
            if (!assetsMap[sym].name && a?.name) assetsMap[sym].name = a.name;
          }

          const snap = existing || snapshotRepo.create({ serialNumber: baseSerialNumber, totalBalanceUsd: 0, assets: null, portfolio: null });
          snap.totalBalanceUsd = Number(Number(totalBalanceUsd || 0).toFixed(2));
          snap.assets = assetsMap as any;
          snap.portfolio = { totalBalanceUsd: snap.totalBalanceUsd, assets } as any;
          await snapshotRepo.save(snap);
        } catch {
        }
      }

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
}
