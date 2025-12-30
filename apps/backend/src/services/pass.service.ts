import { PKPass } from 'passkit-generator';
import path from 'path';
import fs from 'fs';
import os from 'os';
import * as forge from 'node-forge';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { AppleConfig } from '../entities/AppleConfig';

export class PassService {
  // Helper to resolve cert from string content or file path
  private static resolveCert(value?: string): string | undefined {
    if (!value) return undefined;
    
    // 1. If it looks like PEM content already, return it
    if (value.includes('-----BEGIN')) {
        return value;
    }

    // 2. If it looks like a file path, try to read it
    if (value.length < 256 && !value.includes('\n')) {
        const absolutePath = path.resolve(value);
        if (fs.existsSync(absolutePath)) {
            try {
                return fs.readFileSync(absolutePath, 'utf8');
            } catch (e) {
                console.warn(`[PassService] Failed to read cert file at ${absolutePath}`, e);
            }
        } else {
             // File doesn't exist - treat as undefined so we know it's missing
             return undefined;
        }
    }
    
    // 3. Fallback: return value (might be garbage, but let caller decide)
    return value;
  }

  // Helper to ensure PEM has correct newlines (Forge is strict about this)
  private static formatPem(pem: string): string {
    if (!pem) return "";
    let formatted = pem.trim();
    
    // Helper to fix specific header/footer
    const fixHeader = (header: string) => {
        if (formatted.includes(header) && !formatted.includes(header + "\n")) {
            formatted = formatted.replace(header, header + "\n");
        }
    };
    const fixFooter = (footer: string) => {
        if (formatted.includes(footer) && !formatted.includes("\n" + footer)) {
            formatted = formatted.replace(footer, "\n" + footer);
        }
    };

    fixHeader("-----BEGIN CERTIFICATE-----");
    fixFooter("-----END CERTIFICATE-----");
    
    fixHeader("-----BEGIN PRIVATE KEY-----");
    fixFooter("-----END PRIVATE KEY-----");

    fixHeader("-----BEGIN RSA PRIVATE KEY-----");
    fixFooter("-----END RSA PRIVATE KEY-----");

    return formatted;
  }

  static async generatePass(userData: { address: string; balance: string }) {
    try {
      const modelPath = path.resolve(__dirname, '../../assets/pass.model');
      const hasModel = fs.existsSync(modelPath);

      if (!hasModel) {
        console.error(`[PassService] Apple pass model not found at: ${modelPath}`);
        try {
            const parentDir = path.resolve(__dirname, '../../');
            console.log(`[PassService] Contents of ${parentDir}:`, fs.readdirSync(parentDir));
             const assetsDir = path.resolve(__dirname, '../../assets');
             if (fs.existsSync(assetsDir)) {
                 console.log(`[PassService] Contents of ${assetsDir}:`, fs.readdirSync(assetsDir));
             } else {
                 console.log(`[PassService] Assets dir does not exist at ${assetsDir}`);
             }
        } catch (e) { console.log("[PassService] Failed to list dir contents", e); }
        
        return Buffer.from('Mock PKPass File Content') as any;
      }

      let dbConfig: AppleConfig | null = null;
      if (AppDataSource.isInitialized) {
        const repo = AppDataSource.getRepository(AppleConfig);
        dbConfig = await repo.findOne({ where: { name: 'default' } });
      }

      // Load from DB or Fallback to Config/Env
      const wwdrRaw = dbConfig?.wwdrPem || PassService.resolveCert(config.apple.certificates.wwdr);
      const signerCertRaw = dbConfig?.signerCertPem || PassService.resolveCert(config.apple.certificates.signerCert);
      const signerKeyRaw = dbConfig?.signerKeyPem || PassService.resolveCert(config.apple.certificates.signerKey);
      
      const teamId = dbConfig?.teamId || config.apple.teamId;
      const passTypeIdentifier = dbConfig?.passTypeIdentifier || config.apple.passTypeIdentifier;

      // Debug log for missing items
      if (!wwdrRaw) console.warn("[PassService] Missing WWDR Certificate (DB & Config)");
      if (!signerCertRaw) console.warn("[PassService] Missing Signer Certificate (DB & Config)");
      if (!signerKeyRaw) console.warn("[PassService] Missing Signer Private Key (DB & Config)");
      if (!teamId) console.warn("[PassService] Missing Team ID (DB & Config)");
      if (!passTypeIdentifier) console.warn("[PassService] Missing Pass Type ID (DB & Config)");

      const hasCerts = !!(wwdrRaw && signerCertRaw && signerKeyRaw && teamId && passTypeIdentifier);
      
      if (!hasCerts) {
        console.warn("Apple Certificates or Config incomplete. Returning mock pass buffer.");
        return Buffer.from("Mock PKPass File Content") as any;
      }

      console.log(`[PassService] Generating pass with TeamID: ${teamId}, PassType: ${passTypeIdentifier}`);
      
      const wwdrPem = PassService.formatPem(wwdrRaw!);
      const signerCertPem = PassService.formatPem(signerCertRaw!);
      const signerKeyPem = PassService.formatPem(signerKeyRaw!);

      // Validate PEM headers
      if (!wwdrPem.includes("BEGIN CERTIFICATE")) throw new Error("Invalid WWDR Certificate content.");
      if (!signerCertPem.includes("BEGIN CERTIFICATE")) throw new Error("Invalid Signer Certificate content.");
      
      // Normalize Certs using Forge
      let cleanWwdr: string;
      let cleanSignerCert: string;
      let cleanSignerKey: string;

      try {
          const cert = forge.pki.certificateFromPem(wwdrPem);
          cleanWwdr = forge.pki.certificateToPem(cert);
      } catch (e) {
          console.error("WWDR Parse Error:", e);
          throw new Error("Failed to parse WWDR Certificate. Invalid format.");
      }

      try {
          const cert = forge.pki.certificateFromPem(signerCertPem);
          cleanSignerCert = forge.pki.certificateToPem(cert);
      } catch (e) {
          console.error("Signer Cert Parse Error:", e);
          throw new Error("Failed to parse Signer Certificate. Invalid format.");
      }

      try {
          const key = forge.pki.privateKeyFromPem(signerKeyPem);
          cleanSignerKey = forge.pki.privateKeyToPem(key);
      } catch (e) {
           console.error("Signer Key Parse Error:", e);
           throw new Error("Failed to parse Private Key. Invalid format.");
      }
      
      console.log(`[PassService] Certs normalized. WWDR length: ${cleanWwdr.length}, SignerCert length: ${cleanSignerCert.length}, SignerKey length: ${cleanSignerKey.length}`);
      
      // Load model files manually since PKPass constructor expects buffers object or template structure
      const modelBuffers: { [key: string]: Buffer } = {};
      try {
        if (fs.statSync(modelPath).isDirectory()) {
          const files = fs.readdirSync(modelPath);
          for (const file of files) {
            const filePath = path.join(modelPath, file);
            if (fs.statSync(filePath).isFile()) {
              modelBuffers[file] = fs.readFileSync(filePath);
            }
          }
        }
      } catch (e) {
        console.warn("[PassService] Failed to read model directory:", e);
      }

      // Validate pass.json presence in buffers
      if (!modelBuffers['pass.json']) {
          console.error("[PassService] pass.json missing from model buffers!");
          throw new Error("pass.json missing from model directory");
      }

      try {
          // Instantiate PKPass with Buffer content for certificates (not file paths)
          const pass = new PKPass(modelBuffers as any, {
            serialNumber: userData.address,
            description: 'Zaur Web3 Account',
            teamIdentifier: teamId,
            passTypeIdentifier: passTypeIdentifier,
            certificates: {
              wwdr: Buffer.from(cleanWwdr, 'utf8'),
              signerCert: Buffer.from(cleanSignerCert, 'utf8'),
              signerKey: Buffer.from(cleanSignerKey, 'utf8'),
            }
          } as any);

          // Add dynamic data
          if (pass.primaryFields) {
             pass.primaryFields.push({
                key: 'balance',
                label: 'TOTAL BALANCE',
                value: userData.balance,
                currencyCode: 'USD',
             });
          } else {
             console.warn("[PassService] pass.primaryFields is undefined. pass.json might be invalid.");
          }

          if (pass.secondaryFields) {
             pass.secondaryFields.push({
                key: 'address',
                label: 'WALLET ADDRESS',
                value: `${userData.address.slice(0, 6)}...${userData.address.slice(-4)}`,
             });
          }

          if (pass.auxiliaryFields) {
             pass.auxiliaryFields.push({
                key: 'status',
                label: 'STATUS',
                value: 'Active',
             });
          }
          
          // QR Code for receiving address
          (pass as any).barcodes = [
            {
              format: 'PKBarcodeFormatQR',
              message: `ethereum:${userData.address}`,
              messageEncoding: 'iso-8859-1',
            },
          ];

          const buffer = await pass.getAsBuffer();
          return buffer;

      } catch (pkError: any) {
          console.error("[PassService] PKPass instantiation failed:", pkError);
          console.warn("[PassService] Falling back to MOCK pass due to certificate error.");
          return Buffer.from("Mock PKPass File Content: Certificate validation failed.") as any;
      }
    } catch (error: any) {
      console.error('[PassService] Error generating pass:', error);
      if (error.message) console.error('[PassService] Error Details:', error.message);
      if (error.stack) console.error('[PassService] Stack Trace:', error.stack);
      throw error;
    }
  }
}
