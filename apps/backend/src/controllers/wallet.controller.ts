import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { User } from '../entities/User';
import { Wallet } from '../entities/Wallet';
import { Device } from '../entities/Device';
import { Transaction } from '../entities/Transaction';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

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
          
          // Generate REAL random wallet for signing capability
          const randomWallet = ethers.Wallet.createRandom();

          const newWallet = walletRepo.create({
              user,
              name: name || `Wallet ${new Date().toLocaleDateString()}`,
              salt: 'random',
              address: randomWallet.address,
              privateKey: randomWallet.privateKey,
              isActive: false 
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
      const prices: Record<string, number> = { ETH: 3000, MATIC: 1.0, DAI: 1.0, USDT: 1.0, USDC: 1.0 };
      let ethPrice = 3000;
      let maticPrice = 1.0;
      
      try {
          const symbols = ['ETH', 'MATIC', 'DAI', 'USDT', 'USDC'];
          const requests = symbols.map(sym => fetch(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`).then(r => r.json()).catch(() => null));
          
          const results = await Promise.all(requests);
          
          results.forEach((data, index) => {
              if (data && data.data && data.data.amount) {
                  const price = parseFloat(data.data.amount);
                  prices[symbols[index]] = price;
                  if (symbols[index] === 'ETH') ethPrice = price;
                  if (symbols[index] === 'MATIC') maticPrice = price;
              }
          });
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
              const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
              
              // 1. Native Balance
              // Set a short timeout for RPC calls to avoid hanging
              try {
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
              const tokens = TOKEN_MAP[chain.chainId];
              if (tokens) {
                  await Promise.all(tokens.map(async (token) => {
                      try {
                          const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
                          // Add timeout for token calls too
                          const tokenBalanceWei = await Promise.race([
                              contract.balanceOf(address),
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
            credential: {
                id: device.credentialID,
                publicKey: new Uint8Array(device.credentialPublicKey),
                counter: Number(device.counter || 0),
            },
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

          // Fetch Wallet with Private Key (explicitly selected as it is select: false by default)
          const walletRepo = AppDataSource.getRepository(Wallet);
          const walletEntity = await walletRepo.createQueryBuilder("wallet")
              .where("wallet.userId = :userId", { userId: user.id })
              .andWhere("wallet.isActive = :isActive", { isActive: true })
              .addSelect("wallet.privateKey")
              .getOne();

          if (!walletEntity || !walletEntity.privateKey) {
              res.status(400).json({ error: 'Wallet not found or not initialized for signing' });
              return;
          }

          // Determine Chain/Provider
          const chainId = transaction.chainId || config.blockchain.chainId;
          const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === Number(chainId)) || config.blockchain.chains.base;
          
          if (!chainConfig) {
              res.status(400).json({ error: 'Unsupported chain ID' });
              return;
          }

          const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
          const signer = new ethers.Wallet(walletEntity.privateKey, provider);

          // Prepare Transaction
          const txRequest = {
              to: transaction.to,
              value: transaction.value ? BigInt(transaction.value) : 0n,
              data: transaction.data || '0x',
              chainId: chainConfig.chainId
          };

          console.log(`[Wallet] Submitting transaction to ${chainConfig.name} (${chainConfig.rpcUrl})...`, txRequest);

          try {
              // Estimate Gas first to check for errors early
              const estimatedGas = await provider.estimateGas(txRequest);
              console.log(`[Wallet] Estimated Gas: ${estimatedGas}`);
              
              // Send Transaction
              const txResponse = await signer.sendTransaction(txRequest);
              
              console.log(`[Wallet] Transaction Submitted! Hash: ${txResponse.hash}`);

              // Save Transaction Record
              const txRepo = AppDataSource.getRepository(Transaction);
              const newTx = txRepo.create({
                  userOpHash: txResponse.hash, // Using txHash as unique ID for EOA
                  network: chainConfig.name,
                  status: 'submitted',
                  value: transaction.value ? transaction.value.toString() : '0',
                  asset: chainConfig.symbol,
                  user: user,
                  userId: user.id
              });
              await txRepo.save(newTx);
              
              res.status(200).json({ 
                  success: true, 
                  txHash: txResponse.hash,
                  explorerUrl: getExplorerUrl(chainConfig.chainId, txResponse.hash)
              });
          } catch (txError: any) {
              console.error(`[Wallet] Transaction Submission Failed:`, txError);
              
              let errorMessage = 'Transaction failed';
              if (txError.code === 'INSUFFICIENT_FUNDS') {
                  errorMessage = 'Insufficient ETH/MATIC for gas fees.';
              } else if (txError.message.includes('insufficient funds')) {
                   errorMessage = 'Insufficient funds for gas + value.';
              } else if (txError.code === 'NETWORK_ERROR') {
                  errorMessage = 'Blockchain network error. Please try again later.';
              } else if (txError.info && txError.info.error) {
                  // Ethers often wraps the actual RPC error in info.error
                  errorMessage = txError.info.error.message || errorMessage;
              }

              res.status(400).json({ 
                  error: errorMessage,
                  details: txError.message
              });
          }
      } else {
          res.status(401).json({ error: 'Signature verification failed' });
      }

    } catch (error: any) {
      console.error('Error in sendTransaction:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
}

function getExplorerUrl(chainId: number, hash: string): string {
    switch (chainId) {
        case 8453: return `https://basescan.org/tx/${hash}`;
        case 137: return `https://polygonscan.com/tx/${hash}`;
        case 42161: return `https://arbiscan.io/tx/${hash}`;
        case 10: return `https://optimistic.etherscan.io/tx/${hash}`;
        case 1: return `https://etherscan.io/tx/${hash}`;
        default: return ``;
    }
}
