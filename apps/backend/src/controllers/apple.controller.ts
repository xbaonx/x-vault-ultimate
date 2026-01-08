import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { PassRegistration } from "../entities/PassRegistration";
import { Device } from "../entities/Device";
import { User } from "../entities/User";
import { Wallet } from "../entities/Wallet";
import { WalletSnapshot } from "../entities/WalletSnapshot";
import { PassService } from "../services/pass.service";
import { ethers } from "ethers";
import { config } from "../config";
import { PassUpdateService } from '../services/pass-update.service';
import { deriveAaAddressFromCredentialPublicKey } from '../utils/aa-address';
import { AaAddressMapService } from '../services/aa-address-map.service';
import { DepositWatcherService } from '../services/deposit-watcher.service';
import { TokenDiscoveryService } from '../services/token-discovery.service';
import { ProviderService } from '../services/provider.service';
import { TokenPriceService } from '../services/token-price.service';
import { computeApplePassAuthToken, verifyApplePassAuthToken } from '../utils/apple-pass-auth';

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
        { address: '0x94b008aa00579c1307b0ef2c499a98a359659fc9', symbol: 'USDT', decimals: 6 },
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
        if (!authHeader || !authHeader.startsWith("ApplePass ")) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const receivedToken = authHeader.replace("ApplePass ", "").trim();
        const ok = verifyApplePassAuthToken({ serialNumber, receivedToken });
        if (!ok) {
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

          if (!authHeader || !authHeader.startsWith("ApplePass ")) {
              return res.status(401).json({ error: "Unauthorized" });
          }

          const receivedToken = authHeader.replace("ApplePass ", "").trim();
          const ok = verifyApplePassAuthToken({ serialNumber, receivedToken });
          if (!ok) {
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
          const passesUpdatedSinceRaw = req.query.passesUpdatedSince as string | undefined;
          const authHeader = req.headers.authorization;

          if (!authHeader || !authHeader.startsWith("ApplePass ")) {
              return res.status(401).json({ error: "Unauthorized" });
          }

          const receivedToken = authHeader.replace("ApplePass ", "").trim();

          // For simplicity, we just return all serial numbers associated with this device
          // In a real optimized system, we would check update timestamps.
          const repo = AppDataSource.getRepository(PassRegistration);
          const registrations = await repo.find({
              where: { deviceLibraryIdentifier, passTypeIdentifier }
          });

          if (registrations.length === 0) {
              return res.sendStatus(204); // No content
          }

          const ok = registrations.some((r) => {
            return verifyApplePassAuthToken({ serialNumber: r.serialNumber, receivedToken });
          });
          if (!ok) {
            return res.status(401).json({ error: "Unauthorized" });
          }

          const serialNumbers = registrations.map(r => r.serialNumber);

          if (!passesUpdatedSinceRaw) {
            res.status(200).json({
              lastUpdated: new Date().toISOString(),
              serialNumbers,
            });
            return;
          }

          const since = new Date(passesUpdatedSinceRaw);
          const sinceTime = Number.isFinite(since.getTime()) ? since.getTime() : 0;

          const snapshotRepo = AppDataSource.getRepository(WalletSnapshot);
          const snapshots = await snapshotRepo
            .createQueryBuilder('s')
            .where('LOWER(s.serialNumber) IN (:...serials)', { serials: serialNumbers.map(s => s.toLowerCase()) })
            .getMany();

          const snapshotBySerial = new Map(snapshots.map(s => [s.serialNumber.toLowerCase(), s] as const));
          const updatedSerials = serialNumbers.filter((sn) => {
            const snap = snapshotBySerial.get(sn.toLowerCase());
            if (!snap) return true;
            return snap.updatedAt.getTime() > sinceTime;
          });

          if (!updatedSerials.length) {
            res.sendStatus(204);
            return;
          }

          const newestTag = updatedSerials
            .map(sn => snapshotBySerial.get(sn.toLowerCase())?.updatedAt.getTime() || Date.now())
            .reduce((a, b) => Math.max(a, b), 0);

          res.status(200).json({
            lastUpdated: new Date(newestTag).toISOString(),
            serialNumbers: updatedSerials,
          });
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
          if (!authHeader || !authHeader.startsWith("ApplePass ")) {
              console.warn(`[ApplePass] Unauthorized update request for ${serialNumber}`);
              return res.status(401).json({ error: "Unauthorized" });
          }

          const receivedToken = authHeader.replace("ApplePass ", "").trim();
          const ok = verifyApplePassAuthToken({ serialNumber, receivedToken });
          if (!ok) {
              console.warn(`[ApplePass] Unauthorized update request for ${serialNumber}: token mismatch`);
              return res.status(401).json({ error: "Unauthorized" });
          }

          // serialNumber is the AA address (Base chain) in our model
          const serialAddress = serialNumber;

          const deviceRepo = AppDataSource.getRepository(Device);

          const baseSerialChainId = Number(config.blockchain.chainId);

          let matchedDevice: Device | null = null;

          // Resolve the internal Device using AaAddressMap (serialNumber -> internal Device.deviceLibraryId).
          // Apple deviceLibraryIdentifier is NOT the same as our Device.deviceLibraryId.
          try {
            const mappedDeviceLibraryId = await AaAddressMapService.findDeviceIdByAddress({
              chainId: baseSerialChainId,
              aaAddress: serialAddress,
            });

            if (mappedDeviceLibraryId) {
              matchedDevice = await deviceRepo.findOne({
                where: { deviceLibraryId: mappedDeviceLibraryId, isActive: true },
                relations: ['user'],
              });
            }
          } catch {
          }

          if (!matchedDevice || !matchedDevice.user) {
            console.warn(`[ApplePass] No device/user found for serial: ${serialAddress}`);
            return res.sendStatus(404);
          }

          const user = matchedDevice.user;
          console.log(`[ApplePass] Found user ${user.id} for serial ${serialAddress}`);

          const walletRepo = AppDataSource.getRepository(Wallet);
          const wallets = await walletRepo.find({ where: { user: { id: user.id } }, order: { createdAt: 'ASC' } });

          let walletSalt = 0;
          let walletIdForPass: string | undefined = undefined;
          try {
            for (const w of wallets) {
              const derivedSerial = await deriveAaAddressFromCredentialPublicKey({
                credentialPublicKey: Buffer.from(matchedDevice.credentialPublicKey),
                chainId: baseSerialChainId,
                salt: (w as any).aaSalt ?? 0,
                timeoutMs: 2000,
              });
              if (String(derivedSerial).toLowerCase() === String(serialAddress).toLowerCase()) {
                walletSalt = Number((w as any).aaSalt ?? 0);
                walletIdForPass = w.id;
                break;
              }
            }
          } catch {
          }

          const snapshotRepo = AppDataSource.getRepository(WalletSnapshot);
          const existingSnapshot = await snapshotRepo.findOne({
            where: { serialNumber: serialAddress },
          });

          let snapshotRef = existingSnapshot;

          const refreshCooldownMs = 600_000;
          const now = Date.now();
          const shouldRefresh =
            !existingSnapshot ||
            now - new Date(existingSnapshot.updatedAt).getTime() > refreshCooldownMs;

          const ifModifiedSinceHeader = String(req.headers['if-modified-since'] || '').trim();
          const ifModifiedSinceMs = ifModifiedSinceHeader ? Date.parse(ifModifiedSinceHeader) : NaN;
          const previousUpdatedAtMs = snapshotRef?.updatedAt ? new Date(snapshotRef.updatedAt).getTime() : 0;

          const normalizeAssetsForPassCompare = (
            input: Record<string, { amount: number; value: number; name?: string }> | null | undefined,
          ) => {
            const src = input || {};
            const out: Record<string, { amount: number; value: number; name?: string }> = {};
            for (const [k, v] of Object.entries(src)) {
              const name = v?.name ? String(v.name) : k;
              const amount = k.toLowerCase() === 'usdz'
                ? Number(Number(v?.amount || 0).toFixed(2))
                : Number(Number(v?.amount || 0).toFixed(6));
              const value = Number(Number(v?.value || 0).toFixed(2));
              out[k] = { amount, value, name };
            }
            return out;
          };

          const isSameSnapshotForPassCompare = (
            prev: { assets?: any; totalBalanceUsd?: any } | null | undefined,
            nextAssets: Record<string, { amount: number; value: number; name?: string }>,
            nextTotalBalanceUsd: number,
          ) => {
            if (!prev) return false;

            const prevAssets = normalizeAssetsForPassCompare(prev.assets as any);
            const nextAssetsNorm = normalizeAssetsForPassCompare(nextAssets);

            const prevKeys = Object.keys(prevAssets).sort();
            const nextKeys = Object.keys(nextAssetsNorm).sort();
            if (prevKeys.length !== nextKeys.length) return false;
            for (let i = 0; i < prevKeys.length; i++) {
              if (prevKeys[i] !== nextKeys[i]) return false;
            }

            for (const k of prevKeys) {
              const a = prevAssets[k] || {};
              const b = nextAssetsNorm[k] || {};
              if (String(a.name || k) !== String(b.name || k)) return false;
              if (Number(a.amount || 0) !== Number(b.amount || 0)) return false;
              if (Number(a.value || 0) !== Number(b.value || 0)) return false;
            }

            const prevTotal = Number(Number(prev.totalBalanceUsd || 0).toFixed(2));
            const nextTotal = Number(Number(nextTotalBalanceUsd || 0).toFixed(2));
            if (prevTotal !== nextTotal) return false;

            return true;
          };

          // 2. Aggregate Assets
          let totalBalanceUsd = existingSnapshot?.totalBalanceUsd || 0;
          const assets: Record<string, { amount: number; value: number; name?: string }> = (existingSnapshot?.assets as any) || {};

          const usdzBalance = Math.max(0, user.usdzBalance || 0);
          assets['usdz'] = { amount: Number(usdzBalance.toFixed(2)), value: Number(usdzBalance.toFixed(2)), name: 'usdz' };

          if (shouldRefresh) {
            totalBalanceUsd = 0;
            for (const k of Object.keys(assets)) {
              if (k !== 'usdz') {
                delete assets[k];
              }
            }

            try {
              await Promise.race([
                DepositWatcherService.runOnceForDevice(matchedDevice, false, walletSalt),
                new Promise<void>((resolve) => setTimeout(() => resolve(), 1500)),
              ]);
            } catch {
            }

            const chains = Object.values(config.blockchain.chains || {});

            if (chains.length === 0) {
              chains.push({
                rpcUrl: config.blockchain.rpcUrl,
                symbol: 'ETH',
                name: 'Default',
                chainId: config.blockchain.chainId,
              });
            }

            await Promise.all(chains.map(async (chain) => {
              try {
                const chainAddress = await deriveAaAddressFromCredentialPublicKey({
                  credentialPublicKey: Buffer.from(matchedDevice!.credentialPublicKey),
                  chainId: chain.chainId,
                  salt: walletSalt,
                  timeoutMs: 2000,
                });

                const provider = ProviderService.getProvider(chain.chainId);

                try {
                  const balanceWei = await Promise.race([
                    provider.getBalance(chainAddress),
                    new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 3000)),
                  ]);

                  const nativeBalance = parseFloat(ethers.formatEther(balanceWei));
                  if (nativeBalance > 0) {
                    const price = await TokenPriceService.getUsdPrice({
                      chainId: chain.chainId,
                      address: TokenPriceService.nativeAddressKey(),
                    });
                    const key = chain.symbol;
                    if (!assets[key]) assets[key] = { amount: 0, value: 0, name: key };
                    assets[key].amount += nativeBalance;
                    assets[key].value += nativeBalance * (price || 0);
                    totalBalanceUsd += nativeBalance * (price || 0);
                  }
                } catch {
                }

                // Discover ALL ERC-20 token balances via Alchemy Token API if available.
                const discovered = await TokenDiscoveryService.getErc20Assets({
                  chainId: chain.chainId,
                  address: chainAddress,
                  timeoutMs: 2500,
                  maxTokens: 40,
                });

                if (discovered.length) {
                  const addrList = discovered
                    .map((t: any) => String(t.contractAddress || '').trim().toLowerCase())
                    .filter(Boolean);
                  const pricesByAddr = await TokenPriceService.getUsdPrices({
                    chainId: chain.chainId,
                    addresses: addrList,
                  });
                  for (const t of discovered) {
                    const sym = String(t.symbol || '').toUpperCase();
                    if (!sym || sym === 'USDZ') continue;
                    if (!assets[sym]) assets[sym] = { amount: 0, value: 0, name: t.name || sym };
                    assets[sym].amount += t.amount;
                    const tokenAddr = String((t as any).contractAddress || '').trim().toLowerCase();
                    const price = pricesByAddr[tokenAddr] || 0;
                    const valueUsd = Number((Number(t.amount || 0) * price).toFixed(2));
                    assets[sym].value += valueUsd;
                    totalBalanceUsd += valueUsd;
                  }
                } else {
                  // Fallback to curated TOKEN_MAP for non-Alchemy RPCs.
                  const tokens = TOKEN_MAP[chain.chainId];
                  if (tokens) {
                    await Promise.all(tokens.map(async (token) => {
                      try {
                        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
                        const tokenBalanceWei = await Promise.race([
                          contract.balanceOf(chainAddress),
                          new Promise<bigint>((_, reject) => setTimeout(() => reject(new Error('Token RPC Timeout')), 3000)),
                        ]) as bigint;

                        if (tokenBalanceWei > 0n) {
                          const formattedBalance = parseFloat(ethers.formatUnits(tokenBalanceWei, token.decimals));
                          const tokenAddr = String(token.address || '').trim().toLowerCase();
                          const price = await TokenPriceService.getUsdPrice({ chainId: chain.chainId, address: tokenAddr });
                          const value = formattedBalance * (price || 0);

                          if (!assets[token.symbol]) assets[token.symbol] = { amount: 0, value: 0, name: token.symbol };
                          assets[token.symbol].amount += formattedBalance;
                          assets[token.symbol].value += value;
                          totalBalanceUsd += value;
                        }
                      } catch {
                      }
                    }));
                  }
                }
              } catch {
              }
            }));

            totalBalanceUsd = Object.entries(assets)
              .filter(([symbol]) => symbol !== 'usdz')
              .reduce((sum, [, a]) => sum + (typeof a?.value === 'number' ? a.value : 0), 0);

            if (!isSameSnapshotForPassCompare(existingSnapshot, assets, totalBalanceUsd)) {
              const snapshot = existingSnapshot || snapshotRepo.create({
                serialNumber: serialAddress,
                totalBalanceUsd: 0,
                assets: null,
              });

              snapshot.totalBalanceUsd = Number(Number(totalBalanceUsd).toFixed(2));
              snapshot.assets = normalizeAssetsForPassCompare(assets);

              await snapshotRepo.save(snapshot);
              snapshotRef = snapshot;
            }
          }

          const computedTotalBalanceUsd = Object.entries(assets)
            .filter(([symbol]) => symbol !== 'usdz')
            .reduce((sum, [, a]) => sum + (typeof a?.value === 'number' ? a.value : 0), 0);

          totalBalanceUsd = computedTotalBalanceUsd;

          if (!shouldRefresh) {
            if (!isSameSnapshotForPassCompare(existingSnapshot, assets, totalBalanceUsd)) {
              const snapshot = existingSnapshot || snapshotRepo.create({
                serialNumber: serialAddress,
                totalBalanceUsd: 0,
                assets: null,
              });

              snapshot.totalBalanceUsd = Number(Number(computedTotalBalanceUsd).toFixed(2));
              snapshot.assets = normalizeAssetsForPassCompare(assets);
              await snapshotRepo.save(snapshot);

              snapshotRef = snapshot;
            }
          }

          console.log(`[ApplePass] Calculated Total Balance: ${totalBalanceUsd}`);

          const effectiveUpdatedAtMs = snapshotRef?.updatedAt
            ? new Date(snapshotRef.updatedAt).getTime()
            : Date.now();

          // HTTP-date resolution is seconds, but DB timestamps include milliseconds.
          // Truncate to seconds to prevent false negatives when comparing with If-Modified-Since.
          const effectiveUpdatedAtSecMs = Math.floor(effectiveUpdatedAtMs / 1000) * 1000;
          const previousUpdatedAtSecMs = Math.floor(previousUpdatedAtMs / 1000) * 1000;

          if (snapshotRef && Number.isFinite(ifModifiedSinceMs)) {
            if (effectiveUpdatedAtSecMs <= ifModifiedSinceMs && effectiveUpdatedAtSecMs === previousUpdatedAtSecMs) {
              res.set('Last-Modified', new Date(effectiveUpdatedAtSecMs).toUTCString());
              return res.sendStatus(304);
            }
          }

           // Mock Data is DISABLED. 
           // If balance is 0, it stays 0.

          // 3. Generate Pass
          const deviceId = matchedDevice.deviceLibraryId || "Unknown";

          // FIX: Use HOST header for webServiceURL to ensure it points to the BACKEND
          const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
          const host = req.get('host');
          const inferredUrl = `${protocol}://${host}`;
          const trustedUrl = String(process.env.RENDER_EXTERNAL_URL || config.security.origin || '').trim();
          const serverUrl = config.nodeEnv === 'production' && trustedUrl ? trustedUrl : inferredUrl;

          const userData = {
            address: serialAddress,
            balance: totalBalanceUsd.toFixed(2),
            deviceId: deviceId,
            walletId: walletIdForPass,
            assets: assets,
            smartContract: "0x4337...Vault",
            securityDelay: "Active: 48h Window",
            origin: serverUrl 
          };

          const passBuffer = await PassService.generatePass(userData);
          console.log(`[ApplePass] Generated new pass buffer. Size: ${passBuffer.length}`);

          // 4. Send Response
          res.set('Content-Type', 'application/vnd.apple.pkpass');
          res.set('Content-Disposition', `attachment; filename=xvault.pkpass`);
          res.set('Last-Modified', new Date(effectiveUpdatedAtSecMs).toUTCString());
          
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
