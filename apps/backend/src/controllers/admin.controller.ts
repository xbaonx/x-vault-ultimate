import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { AppleConfig } from "../entities/AppleConfig";
import { User } from "../entities/User";
import { Device } from "../entities/Device";
import { Transaction } from "../entities/Transaction";
import { Wallet } from "../entities/Wallet";
import { PollingSession } from "../entities/PollingSession";
import { PassRegistration } from "../entities/PassRegistration";
import { ChainCursor } from "../entities/ChainCursor";
import { DepositEvent } from "../entities/DepositEvent";
import * as forge from "node-forge";
import { ILike, In } from "typeorm";

import { PassService } from "../services/pass.service";

export class AdminController {
  static async testGeneratePass(req: Request, res: Response) {
    try {
        console.log("[Admin] Generating test pass...");
        // Use dummy data
        const dummyData = {
            address: "0x1234567890123456789012345678901234567890",
            balance: "100.00"
        };
        
        const passBuffer = await PassService.generatePass(dummyData);
        
        // Check if it's the mock buffer (simple length check or content check)
        // PassService returns "Mock PKPass File Content" if certs missing
        if (passBuffer.length < 100 && passBuffer.toString().includes("Mock")) {
             return res.status(400).json({ error: "System is using Mock Pass. Certificates might be missing or invalid in DB." });
        }

        res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
        res.setHeader('Content-Disposition', 'attachment; filename=test.pkpass');
        res.send(passBuffer);
    } catch (error: any) {
        console.error("Error generating test pass:", error);
        res.status(500).json({ error: error.message || "Failed to generate pass" });
    }
  }

  static async getUserDetail(req: Request, res: Response) {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ error: "Database not initialized" });
    }

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    try {
      const userRepo = AppDataSource.getRepository(User);
      const walletRepo = AppDataSource.getRepository(Wallet);
      const deviceRepo = AppDataSource.getRepository(Device);
      const txRepo = AppDataSource.getRepository(Transaction);
      const passRegRepo = AppDataSource.getRepository(PassRegistration);

      const user = await userRepo
        .createQueryBuilder('user')
        .where('user.id = :userId', { userId })
        .addSelect('user.spendingPinHash')
        .getOne();

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const wallets = await walletRepo
        .createQueryBuilder('wallet')
        .where('wallet.userId = :userId', { userId })
        .orderBy('wallet.createdAt', 'ASC')
        .getMany();

      const devices = await deviceRepo.find({
        where: { userId },
        order: { createdAt: "ASC" },
      });

      const deviceLibraryIds = (devices || [])
        .map((d) => d.deviceLibraryId)
        .filter(Boolean);

      const passRegistrations = deviceLibraryIds.length
        ? await passRegRepo.find({
            where: { deviceLibraryIdentifier: In(deviceLibraryIds) },
            order: { createdAt: "DESC" },
          })
        : [];

      const recentTransactions = await txRepo.find({
        where: { userId },
        order: { createdAt: "DESC" },
        take: 20,
      });

      return res.status(200).json({
        user: {
          id: user.id,
          appleUserId: user.appleUserId,
          email: user.email,
          isFrozen: user.isFrozen,
          hasPin: !!user.spendingPinHash,
          spendingLimitUsd: user.dailyLimitUsd,
          usdzBalance: user.usdzBalance,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        wallets: (wallets || []).map((w) => ({
          id: w.id,
          name: w.name,
          address: w.address,
          aaSalt: w.aaSalt,
          salt: w.salt,
          isActive: w.isActive,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        })),
        devices: (devices || []).map((d) => ({
          id: d.id,
          deviceLibraryId: d.deviceLibraryId,
          name: d.name,
          pushTokenLast4: d.pushToken ? d.pushToken.slice(-4) : null,
          isActive: d.isActive,
          credentialID: d.credentialID || null,
          hasCredentialPublicKey: !!d.credentialPublicKey,
          counter: d.counter,
          transports: d.transports || [],
          createdAt: d.createdAt,
          lastActiveAt: d.lastActiveAt,
        })),
        passRegistrations: (passRegistrations || []).map((p) => ({
          id: p.id,
          deviceLibraryIdentifier: p.deviceLibraryIdentifier,
          passTypeIdentifier: p.passTypeIdentifier,
          serialNumber: p.serialNumber,
          pushTokenLast4: p.pushToken ? p.pushToken.slice(-4) : null,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        recentTransactions: (recentTransactions || []).map((t) => ({
          id: t.id,
          userOpHash: t.userOpHash,
          txHash: t.txHash,
          network: t.network,
          status: t.status,
          value: t.value,
          asset: t.asset,
          explorerUrl: t.explorerUrl,
          createdAt: t.createdAt,
        })),
      });
    } catch (error: any) {
      console.error("Error in getUserDetail:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  }

  static async getDashboardStats(req: Request, res: Response) {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ error: "Database not initialized" });
    }

    try {
      const userRepo = AppDataSource.getRepository(User);
      const txRepo = AppDataSource.getRepository(Transaction);

      const totalUsers = await userRepo.count();
      const totalTransactions = await txRepo.count();
      
      const activeSessions = Math.floor(totalUsers * 0.1); 
      const gasSponsored = "0.0 ETH"; 

      // Recent registrations (limit 5)
      const recentUsers = await userRepo.find({
        order: { createdAt: "DESC" },
        take: 5,
        relations: ['wallets'] // Fetch wallets to get address
      });

      const today = new Date();
      const userGrowthData = [];
      const transactionVolumeData = [];

      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

        userGrowthData.push({ name: dayName, users: 0 }); 
        transactionVolumeData.push({ name: dayName, volume: 0 }); 
      }

      res.status(200).json({
        stats: {
          totalUsers,
          totalVolume: totalTransactions,
          activeSessions,
          gasSponsored
        },
        recentUsers: recentUsers.map(u => {
            const mainWallet = u.wallets?.find(w => w.isActive) || u.wallets?.[0];
            return {
              id: u.id,
              address: mainWallet?.address || 'No Wallet',
              status: 'Active',
              joined: u.createdAt
            };
        }),
        userGrowthData, 
        transactionVolumeData
      });
    } catch (error) {
      console.error("Error in getDashboardStats:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getUsers(req: Request, res: Response) {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ error: "Database not initialized" });
    }

    try {
      const { q } = req.query; // Search query
      const userRepo = AppDataSource.getRepository(User);
      
      let whereClause: any = {};
      
      if (q && typeof q === 'string') {
          // Search by ID, Email, or AppleUserID
          whereClause = [
              { id: q },
              { email: ILike(`%${q}%`) },
              { appleUserId: ILike(`%${q}%`) }
          ];
      }

      const users = await userRepo.find({
        where: q ? whereClause : undefined,
        order: { createdAt: "DESC" },
        take: 50,
        relations: ['wallets']
      });

      res.status(200).json(users.map(u => {
        const mainWallet = u.wallets?.find(w => w.isActive) || u.wallets?.[0];
        return {
            id: u.id,
            appleUserId: u.appleUserId,
            email: u.email,
            isFrozen: u.isFrozen,
            address: mainWallet?.address || 'No Wallet',
            createdAt: u.createdAt,
            updatedAt: u.updatedAt
        };
      }));
    } catch (error) {
      console.error("Error in getUsers:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getTransactions(req: Request, res: Response) {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ error: "Database not initialized" });
    }

    try {
      const txRepo = AppDataSource.getRepository(Transaction);
      const transactions = await txRepo.find({
        order: { createdAt: "DESC" },
        relations: ["user", "user.wallets"],
        take: 50
      });

      res.status(200).json(transactions.map(t => {
        const mainWallet = t.user?.wallets?.find(w => w.isActive) || t.user?.wallets?.[0];
        return {
            id: t.id,
            userOpHash: t.userOpHash,
            network: t.network,
            status: t.status,
            userAddress: mainWallet?.address || 'Unknown',
            createdAt: t.createdAt
        };
      }));
    } catch (error) {
      console.error("Error in getTransactions:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getAppleConfig(req: Request, res: Response) {
    try {
      const repo = AppDataSource.getRepository(AppleConfig);
      const row = await repo.findOne({ where: { name: "default" } });

      if (!row) {
        res.status(200).json({
          configured: false,
          teamId: null,
          passTypeIdentifier: null,
          hasWwdr: false,
          hasSignerCert: false,
          hasSignerKey: false,
          hasSignerKeyPassphrase: false,
        });
        return;
      }

      res.status(200).json({
        configured: !!(row.teamId && row.passTypeIdentifier),
        teamId: row.teamId || null,
        passTypeIdentifier: row.passTypeIdentifier || null,
        hasWwdr: !!row.wwdrPem,
        hasSignerCert: !!row.signerCertPem,
        hasSignerKey: !!row.signerKeyPem,
        hasSignerKeyPassphrase: !!row.signerKeyPassphrase,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      console.error("Error in getAppleConfig:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async uploadAppleCerts(req: Request, res: Response) {
    try {
      const repo = AppDataSource.getRepository(AppleConfig);
      const existing = await repo.findOne({ where: { name: "default" } });
      const row = existing || repo.create({ name: "default" });

      const { teamId, passTypeIdentifier, signerKeyPassphrase } = req.body || {};
      if (typeof teamId === "string") row.teamId = teamId;
      if (typeof passTypeIdentifier === "string") row.passTypeIdentifier = passTypeIdentifier;
      if (typeof signerKeyPassphrase === "string") row.signerKeyPassphrase = signerKeyPassphrase;

      const files = req.files as
        | {
            [fieldname: string]: Express.Multer.File[];
          }
        | undefined;

      const wwdrFile = files?.wwdr?.[0];
      const signerP12File = files?.signerP12?.[0];

      // 1. Handle WWDR (Support PEM or DER)
      let wwdrCommonName = "";
      if (wwdrFile) {
        let pem = wwdrFile.buffer.toString("utf8");
        // If it doesn't look like a PEM, assume DER
        if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
             try {
                 const der = wwdrFile.buffer.toString('binary');
                 const asn1 = forge.asn1.fromDer(der);
                 const cert = forge.pki.certificateFromAsn1(asn1);
                 pem = forge.pki.certificateToPem(cert);
                 console.log("[Admin] Converted WWDR from DER to PEM");
             } catch (e) {
                 console.error("[Admin] Failed to convert WWDR DER to PEM", e);
                 return res.status(400).json({ error: "Invalid WWDR file. Could not parse as PEM or DER." });
             }
        }
        
        // Validate WWDR Content
        try {
            const cert = forge.pki.certificateFromPem(pem);
            wwdrCommonName = cert.subject.getField('CN')?.value || "Unknown";
            const notAfter = cert.validity.notAfter;
            const serialNumber = cert.serialNumber;
            
            console.log(`[Admin] Validated WWDR: ${wwdrCommonName}`);
            console.log(`[Admin] WWDR Serial: ${serialNumber}`);
            console.log(`[Admin] WWDR Expiry: ${notAfter.toISOString()}`);
            
            if (!wwdrCommonName.includes("Worldwide Developer Relations")) {
                console.warn("[Admin] Warning: Uploaded certificate does not look like Apple WWDR.");
            }
            
            // Check if certificate is expired
            const now = new Date();
            if (notAfter < now) {
                return res.status(400).json({ 
                    error: `WWDR Certificate has expired on ${notAfter.toISOString()}. Please download WWDR G4 from https://www.apple.com/certificateauthority/` 
                });
            }
            
            // Warn if using G1 (serial starts with 0x0C or 12 in decimal)
            if (serialNumber.toLowerCase().startsWith('0c') || serialNumber === '12') {
                return res.status(400).json({ 
                    error: "WWDR G1 certificate detected (expired Feb 2023). Please download WWDR G4 from https://www.apple.com/certificateauthority/" 
                });
            }
        } catch (e) {
             return res.status(400).json({ error: "Invalid WWDR Certificate content." });
        }

        row.wwdrPem = pem;
      }

      // 2. Handle P12 Upload (Auto-extract Key & Cert)
      let signerCommonName = "";
      if (signerP12File) {
        // Use provided passphrase or empty string if none
        const pass = row.signerKeyPassphrase || "";
        
        try {
            console.log("[Admin] Processing P12 file...");
            const p12Der = signerP12File.buffer.toString('binary');
            const p12Asn1 = forge.asn1.fromDer(p12Der);
            
            let p12;
            try {
                // Try 1: Use provided pass (usually empty string "")
                p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, pass);
            } catch (e1) {
                // Try 2: If pass is empty string, try strict null (some formats need this)
                if (pass === "") {
                    console.log("[Admin] Retrying P12 decryption with null password...");
                    try {
                        p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, null as any);
                    } catch (e2) {
                        throw e1; // Throw original error if both fail
                    }
                } else {
                    throw e1;
                }
            }

            // Get Private Key
            // Note: Apple P12s usually put key in pkcs8ShroudedKeyBag
            const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
            const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
            
            if (keyBag && keyBag.key) {
                row.signerKeyPem = forge.pki.privateKeyToPem(keyBag.key);
                console.log("[Admin] Extracted Private Key from P12");
            } else {
                 console.warn("[Admin] No private key found in P12 ShroudedKeyBag, checking KeyBag...");
                 // Fallback check
                 const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
                 const plainKeyBag = plainKeyBags[forge.pki.oids.keyBag]?.[0];
                 if(plainKeyBag && plainKeyBag.key) {
                    row.signerKeyPem = forge.pki.privateKeyToPem(plainKeyBag.key);
                     console.log("[Admin] Extracted Private Key from P12 KeyBag");
                 }
            }

            // Get Certificate
            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
            const certBag = certBags[forge.pki.oids.certBag]?.[0];
            
            if (certBag && certBag.cert) {
                row.signerCertPem = forge.pki.certificateToPem(certBag.cert);
                signerCommonName = certBag.cert.subject.getField('CN')?.value || "Unknown";
                console.log(`[Admin] Extracted Certificate from P12: ${signerCommonName}`);
            } else {
                 console.warn("[Admin] No certificate found in P12");
            }

        } catch (e: any) {
             console.error("[Admin] Failed to process P12 file:", e);
             const isPasswordError = e.message && (e.message.includes('MAC') || e.message.includes('password') || e.message.includes('PKCS#12'));
             const msg = isPasswordError 
                ? "Incorrect P12 password or invalid file format. Even 'no password' files might need an empty password." 
                : "Failed to process P12 file.";
             
             return res.status(400).json({ error: msg });
        }
      }

      // Final Validation before saving
      if (!row.wwdrPem || !row.wwdrPem.includes("BEGIN CERTIFICATE")) {
          // If we are just updating config strings, this might be okay if certs already exist.
          // But if we are uploading certs, we must check.
          // For now, let's just warn if we are saving potentially incomplete config,
          // OR if the user specifically uploaded a file that turned out invalid.
          if (wwdrFile) {
             return res.status(400).json({ error: "Invalid WWDR Certificate. Must be a valid PEM or DER file." });
          }
      }

      if (signerP12File) {
          if (!row.signerCertPem || !row.signerCertPem.includes("BEGIN CERTIFICATE")) {
               return res.status(400).json({ error: "Invalid P12. Could not extract Signer Certificate." });
          }
          if (!row.signerKeyPem || (!row.signerKeyPem.includes("PRIVATE KEY") && !row.signerKeyPem.includes("RSA PRIVATE KEY"))) {
               return res.status(400).json({ error: "Invalid P12. Could not extract Private Key." });
          }
      }

      const saved = await repo.save(row);

      res.status(200).json({
        ok: true,
        id: saved.id,
        updatedAt: saved.updatedAt,
        hasWwdr: !!saved.wwdrPem,
        hasSignerCert: !!saved.signerCertPem,
        hasSignerKey: !!saved.signerKeyPem,
        wwdrCN: wwdrCommonName || (saved.wwdrPem ? "Existing" : "Missing"),
        signerCN: signerCommonName || (saved.signerCertPem ? "Existing" : "Missing")
      });
    } catch (error: any) {
      console.error("Error in uploadAppleCerts:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  }

  static async freezeUser(req: Request, res: Response) {
    try {
        const { userId } = req.params;
        const userRepo = AppDataSource.getRepository(User);
        const user = await userRepo.findOneBy({ id: userId });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        user.isFrozen = true;
        await userRepo.save(user);

        console.log(`[Admin] User ${userId} frozen.`);
        res.status(200).json({ id: user.id, isFrozen: true });
    } catch (error) {
        console.error("Error in freezeUser:", error);
        res.status(500).json({ error: "Internal server error" });
    }
  }

  static async unfreezeUser(req: Request, res: Response) {
    try {
        const { userId } = req.params;
        const userRepo = AppDataSource.getRepository(User);
        const user = await userRepo.findOneBy({ id: userId });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        // Apply Security Delay check here?
        // For MVP, allow admin to unfreeze immediately or maybe warn.
        
        user.isFrozen = false;
        await userRepo.save(user);

        console.log(`[Admin] User ${userId} unfrozen.`);
        res.status(200).json({ id: user.id, isFrozen: false });
    } catch (error) {
        console.error("Error in unfreezeUser:", error);
        res.status(500).json({ error: "Internal server error" });
    }
  }

  static async updateUserLimit(req: Request, res: Response) {
    try {
        const { userId } = req.params;
        const { limit } = req.body;
        
        if (typeof limit !== 'number' || limit < 0) {
            res.status(400).json({ error: "Invalid limit value" });
            return;
        }

        const userRepo = AppDataSource.getRepository(User);
        const user = await userRepo.findOneBy({ id: userId });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        user.dailyLimitUsd = limit;
        await userRepo.save(user);

        console.log(`[Admin] User ${userId} limit updated to $${limit}.`);
        res.status(200).json({ id: user.id, dailyLimitUsd: user.dailyLimitUsd });
    } catch (error) {
        console.error("Error in updateUserLimit:", error);
        res.status(500).json({ error: "Internal server error" });
    }
  }

  static async forceResetDeviceLock(req: Request, res: Response) {
    try {
        const { userId } = req.params;
        
        const userRepo = AppDataSource.getRepository(User);
        // Load user with devices to deactivate them
        const user = await userRepo.findOne({ 
            where: { id: userId },
            relations: ['devices']
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        // Deactivate all devices for this user
        // This forces them to re-register/re-login which effectively resets access
        if (user.devices && user.devices.length > 0) {
            const deviceRepo = AppDataSource.getRepository(Device);
            for (const device of user.devices) {
                device.isActive = false;
                device.currentChallenge = ""; 
                // We keep the device record for audit but disable it
                await deviceRepo.save(device);
            }
        }

        // Also clear any migration flags if we moved them to User? 
        // Migration fields were removed from User, so nothing else to clear there.

        await userRepo.save(user);

        console.log(`[Admin] FORCE RESET: Deactivated all devices for user ${userId}.`);
        res.status(200).json({ success: true, message: "All devices deactivated. User can link new devices." });
    } catch (error) {
        console.error("Error in forceResetDeviceLock:", error);
        res.status(500).json({ error: "Internal server error" });
    }
  }

  static async deleteUser(req: Request, res: Response) {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ error: "Database not initialized" });
    }

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    try {
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId }, relations: ['devices', 'wallets'] });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const deviceLibraryIds = (user.devices || [])
        .map(d => d.deviceLibraryId)
        .filter(Boolean);
      const walletAddresses = (user.wallets || [])
        .map(w => w.address)
        .filter(Boolean);

      await AppDataSource.transaction(async (manager) => {
        if (deviceLibraryIds.length > 0) {
          await manager.getRepository(PollingSession)
            .createQueryBuilder()
            .delete()
            .where('deviceId IN (:...ids)', { ids: deviceLibraryIds })
            .execute();
          await manager.getRepository(PassRegistration)
            .createQueryBuilder()
            .delete()
            .where('deviceLibraryIdentifier IN (:...ids)', { ids: deviceLibraryIds })
            .execute();
        }

        if (walletAddresses.length > 0) {
          await manager.getRepository(ChainCursor)
            .createQueryBuilder()
            .delete()
            .where('walletAddress IN (:...addrs)', { addrs: walletAddresses })
            .execute();

          await manager.getRepository(DepositEvent)
            .createQueryBuilder()
            .delete()
            .where('walletAddress IN (:...addrs)', { addrs: walletAddresses })
            .execute();
        }

        await manager.getRepository(Transaction).delete({ userId });
        await manager.getRepository(Device).delete({ userId });
        await manager.getRepository(Wallet)
          .createQueryBuilder()
          .delete()
          .where('userId = :userId', { userId })
          .execute();
        await manager.getRepository(User).delete({ id: userId });
      });

      console.log(`[Admin] User ${userId} deleted.`);
      return res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Error in deleteUser:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  }
}
