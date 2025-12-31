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

  static async generatePass(userData: { 
      address: string; 
      balance: string;
      deviceId?: string;
      assets?: Record<string, { amount: number, value: number }>;
      smartContract?: string;
      securityDelay?: string;
      authToken?: string;
      ownerName?: string;
  }) {
    try {
      const modelPath = path.resolve(__dirname, '../../assets/pass.model');
      const hasModel = fs.existsSync(modelPath);

      if (!hasModel) {
        // ... (existing error handling)
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

      // ... (existing validation logic)

      const hasCerts = !!(wwdrRaw && signerCertRaw && signerKeyRaw && teamId && passTypeIdentifier);
      
      if (!hasCerts) {
        console.warn("Apple Certificates or Config incomplete. Returning mock pass buffer.");
        return Buffer.from("Mock PKPass File Content") as any;
      }

      console.log(`[PassService] Generating pass with TeamID: ${teamId}, PassType: ${passTypeIdentifier}`);
      
      const wwdrPem = PassService.formatPem(wwdrRaw!);
      const signerCertPem = PassService.formatPem(signerCertRaw!);
      const signerKeyPem = PassService.formatPem(signerKeyRaw!);

      // ... (existing PEM validation)

      // Load model files manually since PKPass constructor expects buffers object or template structure
      const modelBuffers: { [key: string]: Buffer } = {};
      try {
        if (fs.statSync(modelPath).isDirectory()) {
          const files = fs.readdirSync(modelPath);
          for (const file of files) {
            // Skip hidden files like .DS_Store
            if (file.startsWith('.')) continue;

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

      // MANUALLY PATCH PASS.JSON
      try {
          const passJsonStr = modelBuffers['pass.json'].toString('utf8');
          const passJson = JSON.parse(passJsonStr);
          
          passJson.teamIdentifier = teamId;
          passJson.passTypeIdentifier = passTypeIdentifier;
          passJson.serialNumber = userData.address; // Ensure serial number matches
          passJson.description = "Zaur.at Smart Vault";
          
          // STYLE CHANGE: GENERIC -> STORE CARD
          // To match the "Credit Card" aesthetic (Visa Signature style), we switch to 'storeCard'.
          // This allows for a strip image and better field placement for this look.
          if (passJson.generic) {
              passJson.storeCard = passJson.generic;
              delete passJson.generic;
          } else if (!passJson.storeCard) {
              passJson.storeCard = {
                  primaryFields: [],
                  secondaryFields: [],
                  auxiliaryFields: [],
                  backFields: []
              };
          }

          // SECURITY & PUSH UPDATE LOGIC
          passJson.sharingProhibited = true; // Prevent sharing via AirDrop/iMessage
          passJson.webServiceURL = `${config.security.origin}/api/apple`;
          passJson.authenticationToken = userData.authToken || '3325692850392023594'; // Token for APNs updates
          
          // QR CODE: REMOVED for "Credit Card" style
          // We intentionally do not inject barcodes here.

          modelBuffers['pass.json'] = Buffer.from(JSON.stringify(passJson));
      } catch (e) {
          console.error("[PassService] Failed to patch pass.json buffer:", e);
      }

      try {
          // Prepare certificates
          const certificates = {
            wwdr: wwdrPem,
            signerCert: signerCertPem,
            signerKey: signerKeyPem,
            signerKeyPassphrase: config.apple.certificates.signerKeyPassphrase,
          };

          // QR CODE DATA
          // User requested "Credit Card" style (Clean Front).
          // We REMOVE the barcode from the front to match the "Visa Signature" aesthetic.
          // The address is still available in the Back Fields.
          
          // Prepare props - DESIGN SPEC UPDATE
          // Background: Deep Obsidian Black
          // Text: White/Silver
          // Label: Metallic Silver (Gray)
          const props = {
            serialNumber: userData.address,
            description: 'Zaur.at Smart Vault',
            teamIdentifier: teamId,
            passTypeIdentifier: passTypeIdentifier,
            backgroundColor: 'rgb(20, 20, 20)', // Deep Obsidian Black
            labelColor: 'rgb(160, 160, 160)',   // Metallic Silver
            foregroundColor: 'rgb(255, 255, 255)',
            logoText: 'X-VAULT', // Simulates the Bank Brand Top-Right
            sharingProhibited: true,
            webServiceURL: `${config.security.origin}/api/apple`,
            authenticationToken: userData.authToken || '3325692850392023594',
            // barcodes: [], // No barcode for "Credit Card" look
            // barcode: undefined
          };

          // Instantiate PKPass
          const pass = new PKPass(modelBuffers as any, certificates as any, props as any);

          // Helper for formatting currency
          const formatCurrency = (val: number | string) => {
              const num = typeof val === 'string' ? parseFloat(val) : val;
              return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
          };

          // --- FRONT OF CARD (Primary View) ---
          
          // Header: Top Right Branding (Simulating "ACB" logo position)
          if (pass.headerFields) {
              pass.headerFields.push({
                  key: 'header_brand',
                  label: 'VAULT TIER',
                  value: 'ULTIMATE', 
                  textAlignment: 'PKTextAlignmentRight'
              });
          }

          // Primary: REMOVED to clear the center for the background image
          
          // Secondary: Vault Balance (Subtle Middle Row)
          if (pass.secondaryFields) {
             pass.secondaryFields.push({
                key: 'balance',
                label: 'VAULT BALANCE',
                value: parseFloat(userData.balance), 
                currencyCode: 'USD',
                textAlignment: 'PKTextAlignmentLeft'
             });
          }

          // Auxiliary: Bottom Row (Credit Card Style)
          if (pass.auxiliaryFields) {
             // 1. Owner Name (Far Left)
             if (userData.ownerName) {
                 pass.auxiliaryFields.push({
                    key: 'owner_name',
                    label: 'CARDHOLDER',
                    value: userData.ownerName.toUpperCase(),
                    textAlignment: 'PKTextAlignmentLeft'
                 });
             }

             // 2. Masked Number ".... 2863" (Left)
             pass.auxiliaryFields.push({
                key: 'account_number',
                label: 'VAULT NUMBER',
                value: `•••• ${userData.address.slice(-4)}`,
                textAlignment: 'PKTextAlignmentLeft'
             });
             
             // 3. Tier Branding "Visa Signature" (Right)
             pass.auxiliaryFields.push({
                key: 'card_tier',
                label: 'TIER',
                value: 'Signature',
                textAlignment: 'PKTextAlignmentRight'
             });
          }

          // --- BACK OF CARD (Details View) ---
          
          if (pass.backFields) {
             // 0. Owner Name (Requested Feature)
             if (userData.ownerName) {
                 pass.backFields.push({
                     key: 'owner_name_back',
                     label: 'NAME',
                     value: userData.ownerName,
                 });
             }

             // 1. Asset Breakdown
             pass.backFields.push({
                 key: 'assets_header',
                 label: 'MARKET ASSETS',
                 value: 'Portfolio Breakdown',
             });

             if (userData.assets) {
                 if (userData.assets['BTC'] && userData.assets['BTC'].amount > 0) {
                     pass.backFields.push({
                         key: 'asset_btc',
                         label: 'Bitcoin (BTC)',
                         value: `${userData.assets['BTC'].amount.toFixed(4)} BTC (~${formatCurrency(userData.assets['BTC'].value)})`,
                     });
                 }
                 if (userData.assets['ETH'] && userData.assets['ETH'].amount > 0) {
                     pass.backFields.push({
                         key: 'asset_eth',
                         label: 'Ethereum (ETH)',
                         value: `${userData.assets['ETH'].amount.toFixed(2)} ETH (~${formatCurrency(userData.assets['ETH'].value)})`,
                     });
                 }
                 if (userData.assets['USDT'] && userData.assets['USDT'].amount > 0) {
                     pass.backFields.push({
                         key: 'asset_usdt',
                         label: 'Tether (USDT)',
                         value: `${userData.assets['USDT'].amount.toFixed(2)} USDT`,
                     });
                 }
                 if (userData.assets['SOL'] && userData.assets['SOL'].amount > 0) {
                     pass.backFields.push({
                         key: 'asset_sol',
                         label: 'Solana (SOL)',
                         value: `${userData.assets['SOL'].amount.toFixed(2)} SOL (~${formatCurrency(userData.assets['SOL'].value)})`,
                     });
                 }
                 
                 // Internal Utility
                 if (userData.assets['usdz']) {
                     pass.backFields.push({
                         key: 'asset_usdz',
                         label: 'INTERNAL UTILITY',
                         value: `${userData.assets['usdz'].amount.toFixed(2)} usdz Credit`,
                     });
                 }
             }

             // 2. Device Identity
             pass.backFields.push({
                 key: 'device_info',
                 label: 'DEVICE IDENTITY',
                 value: userData.deviceId ? `ID: ${userData.deviceId.slice(0, 8)}...${userData.deviceId.slice(-4)}` : 'Unknown Device',
             });

             pass.backFields.push({
                 key: 'smart_contract',
                 label: 'VAULT SMART CONTRACT',
                 value: userData.smartContract || 'Pending Deployment',
             });

             // 3. Security Status
             pass.backFields.push({
                 key: 'security_delay',
                 label: 'SECURITY DELAY',
                 value: userData.securityDelay || 'Standard Protection',
             });

             // 4. Quick Actions (Emergency)
             pass.backFields.push({
                 key: 'emergency_freeze',
                 label: 'EMERGENCY ACTION',
                 value: 'https://zaur.at/freeze', // Detectable as link by iOS
                 attributedValue: '<a href="https://zaur.at/freeze">Freeze Vault</a>'
             });
             
             pass.backFields.push({
                 key: 'support_id',
                 label: 'SUPPORT ID',
                 value: userData.deviceId ? `VIP-${userData.deviceId.slice(0,6).toUpperCase()}` : 'VIP-GUEST',
             });
             
             // Timestamp
             pass.backFields.push({
                 key: 'last_updated',
                 label: 'LAST UPDATED',
                 value: new Date().toLocaleString(),
                 dateStyle: 'PKDateStyleMedium',
                 timeStyle: 'PKDateStyleShort',
             });
          }
          
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
