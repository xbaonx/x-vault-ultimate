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

  // VALID 60x60 PNG (Black Circle with White $ sign) - Fail-safe Icon
  private static readonly SAFE_ICON_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAYAAAA6/nqHAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAPKADAAQAAAABAAAAPAAAAAAy051DAAAACXBIWXMAAAsTAAALEwEAmpwYAAACxUlEQRoBe9baTUsDQRQ9E0ExlZUqKFgq+P//oFqrShG0GJJPcydMCi67M3dCzOQwJ5fkzZs3Z2Z3JpOJ/WExsAgsBhaBRWCtWnr7+Pj4eP/8/Hz/8vLy/vX19f39/f39w8PD+6enp/ePj4/vH5+fn98/Pz+/f3l5ef/6+vr+4eHh/dPT0/vHx8f3T09P75+fn9+/vLy8f319ff/w8PD+6enp/ePj4/vH5+fn98/Pz+/f39/fPzw8vH96enr/+Pj4/vH5+fn98/Pz+/f39/cP//4W+PLy8n4y39/fPzw8PLx/enp6//j4+P7x+fn5/fPz8/v39/f3Dw8P75+ent4/Pj6+f3x+fn7//Pz8/v39/f3Dw8P7p6en94+Pj+8fn5+f3z8/P79/f39///D/t8D39/f3Dw8P75+ent4/Pj6+f3x+fn7//Pz8/v39/f3Dw8P7p6en94+Pj+8fn5+f3z8/P79/f398/PDy8f3p6ev/4+Pj+8fn5+f3z8/P79/f39w8PD++fnp7ePz4+vn98fn5+//z8/P79/f39w8PD+6enp/ePj4/vH5+fn98/Pz+/f39/f//w8PD+6enp/ePj4/vH5+fn98/Pz+/f39/fPzw8vH96enr/+Pj4/vH5+fn98/Pz+/f39/cPDw/vn56e3j8+Pr5/fH5+fv/8/Pz+/f39/cPDw/unp6f3j4+P7x+fn5/fPz8/v39/f3//8PDw/unp6f3j4+P7x+fn5/fPz8/v39/f3z88PLx/enp6//j4+P7x+fn5/fPz8/v39/f3Dw8P75+ent4/Pj6+f3x+fn7//Pz8/v39/f3Dw8P7p6en94+Pj+8fn5+f3z8/P79/f39///D/t8B/Abv9/wGLwCJwM/EH7b1aW9qO928AAAAASUVORK5CYII=";

  // Generate Mock Certificates for Development/Testing
  private static async createMockCertificates(teamId: string, passTypeId: string, orgName: string): Promise<{ key: string, cert: string }> {
      console.log(`[PassService] Generating self-signed mock certificates for Team ID: ${teamId}, PassType: ${passTypeId}...`);
      return new Promise((resolve, reject) => {
          forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (err, keypair) => {
              if (err) return reject(err);
              
              const cert = forge.pki.createCertificate();
              cert.publicKey = keypair.publicKey;
              cert.serialNumber = '01';
              cert.validity.notBefore = new Date();
              cert.validity.notAfter = new Date();
              cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
              
              const attrs = [{
                  name: 'commonName',
                  value: passTypeId // Match Pass Type ID (Critical for validation)
              }, {
                  name: 'countryName',
                  value: 'US'
              }, {
                  shortName: 'ST',
                  value: 'Virginia'
              }, {
                  name: 'localityName',
                  value: 'Blacksburg'
              }, {
                  name: 'organizationName',
                  value: orgName // Match Pass Organization
              }, {
                  shortName: 'OU',
                  value: teamId // Match Team ID
              }];
              
              cert.setSubject(attrs);
              cert.setIssuer(attrs);
              cert.sign(keypair.privateKey, forge.md.sha256.create());

              resolve({
                  key: forge.pki.privateKeyToPem(keypair.privateKey),
                  cert: forge.pki.certificateToPem(cert)
              });
          });
      });
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
      apiUrl?: string;
  }) {
    try {
      const modelPath = path.resolve(__dirname, '../../assets/pass.model');
      const hasModel = fs.existsSync(modelPath);

      if (!hasModel) {
        console.error(`[PassService] Model directory not found at: ${modelPath}`);
        throw new Error(`Pass model directory missing at ${modelPath}`);
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
      
      let wwdrPem = "";
      let signerCertPem = "";
      let signerKeyPem = "";
      let useMockCerts = false;

      if (!hasCerts) {
        console.warn("[PassService] Apple Certificates missing. Generating MOCK SELF-SIGNED certificates. Pass will NOT be verifiable on real iOS devices but will download.");
        try {
            const mock = await PassService.createMockCertificates(teamId, passTypeIdentifier, "Zaur.at Smart Vault");
            wwdrPem = mock.cert; // Use same cert for WWDR in mock mode
            signerCertPem = mock.cert;
            signerKeyPem = mock.key;
            useMockCerts = true;
        } catch (err) {
            console.error("[PassService] Failed to generate mock certs:", err);
            throw new Error("Certificates missing and mock generation failed.");
        }
      } else {
        console.log(`[PassService] Generating pass with TeamID: ${teamId}, PassType: ${passTypeIdentifier}`);
        wwdrPem = PassService.formatPem(wwdrRaw!);
        signerCertPem = PassService.formatPem(signerCertRaw!);
        signerKeyPem = PassService.formatPem(signerKeyRaw!);

        // DIAGNOSTIC: Inspect Certificate Details
        try {
            const signerCert = forge.pki.certificateFromPem(signerCertPem);
            const wwdrCert = forge.pki.certificateFromPem(wwdrPem);
            
            console.log("[PassService] --- Certificate Diagnostics ---");
            console.log(`[PassService] Signer Cert Subject: ${JSON.stringify(signerCert.subject.attributes.map(a => ({ name: a.name, value: a.value })))}`);
            console.log(`[PassService] Signer Cert Issuer: ${JSON.stringify(signerCert.issuer.attributes.map(a => ({ name: a.name, value: a.value })))}`);
            console.log(`[PassService] Signer Cert Valid: ${signerCert.validity.notBefore} to ${signerCert.validity.notAfter}`);
            
            console.log(`[PassService] WWDR Cert Subject: ${JSON.stringify(wwdrCert.subject.attributes.map(a => ({ name: a.name, value: a.value })))}`);
            console.log(`[PassService] WWDR Cert Issuer: ${JSON.stringify(wwdrCert.issuer.attributes.map(a => ({ name: a.name, value: a.value })))}`);
            
            // Check for Team ID Match
            const certTeamId = signerCert.subject.getField('OU')?.value;
            if (certTeamId && certTeamId !== teamId) {
                console.error(`[PassService] CRITICAL MISMATCH: Certificate Team ID (${certTeamId}) does not match Config Team ID (${teamId})`);
            } else if (!certTeamId) {
                 console.warn(`[PassService] Warning: Could not extract Team ID (OU) from certificate subject.`);
            }

            // Check Expiry
            const now = new Date();
            if (now > signerCert.validity.notAfter) {
                console.error(`[PassService] CRITICAL: Signer Certificate is EXPIRED (Expired: ${signerCert.validity.notAfter})`);
                throw new Error("Signer Certificate Expired");
            }
            if (now > wwdrCert.validity.notAfter) {
                console.error(`[PassService] CRITICAL: WWDR Certificate is EXPIRED (Expired: ${wwdrCert.validity.notAfter})`);
                throw new Error("WWDR Certificate Expired");
            }

            console.log("[PassService] -----------------------------");
        } catch (diagErr) {
            console.error("[PassService] Failed to parse certificates for diagnostics:", diagErr);
            // Don't block flow if just diagnostics fail, but log heavily
        }
      }

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

      // FALLBACK: Ensure strip.png exists for storeCard style
      if (!modelBuffers['strip.png'] && modelBuffers['logo.png']) {
          console.log("[PassService] strip.png missing for storeCard. Creating from logo.png.");
          modelBuffers['strip.png'] = Buffer.from(modelBuffers['logo.png']);
      }
      if (!modelBuffers['strip@2x.png'] && modelBuffers['logo@2x.png']) {
          modelBuffers['strip@2x.png'] = Buffer.from(modelBuffers['logo@2x.png']);
      }

      // FALLBACK: Ensure icon.png exists and is valid (Critical for Pass)
      // 1. If missing, try logo.png
      if (!modelBuffers['icon.png'] && modelBuffers['logo.png']) {
           console.log("[PassService] icon.png missing. Creating from logo.png.");
           modelBuffers['icon.png'] = Buffer.from(modelBuffers['logo.png']);
      }
      
      // 2. Check size. If dangerously small (< 200 bytes) or still missing, use SAFE FALLBACK.
      if (!modelBuffers['icon.png'] || modelBuffers['icon.png'].length < 200) {
          console.warn(`[PassService] icon.png is missing or invalid size (${modelBuffers['icon.png']?.length || 0} bytes). Using SAFE_ICON_BASE64.`);
          const safeIcon = Buffer.from(PassService.SAFE_ICON_BASE64, 'base64');
          modelBuffers['icon.png'] = safeIcon;
          // Ensure @2x exists too
          if (!modelBuffers['icon@2x.png'] || modelBuffers['icon@2x.png'].length < 200) {
              modelBuffers['icon@2x.png'] = safeIcon;
          }
      }

      // 3. Fallback for @2x from logo@2x if we didn't force-set it
      if (!modelBuffers['icon@2x.png'] && modelBuffers['logo@2x.png']) {
           modelBuffers['icon@2x.png'] = Buffer.from(modelBuffers['logo@2x.png']);
      }

      // FALLBACK: Ensure thumbnail.png exists for GENERIC style
      if (!modelBuffers['thumbnail.png'] && modelBuffers['logo.png']) {
          modelBuffers['thumbnail.png'] = Buffer.from(modelBuffers['logo.png']);
      }
      if (!modelBuffers['thumbnail@2x.png'] && modelBuffers['logo@2x.png']) {
          modelBuffers['thumbnail@2x.png'] = Buffer.from(modelBuffers['logo@2x.png']);
      }

      // MANUALLY PATCH PASS.JSON
      try {
          const passJsonStr = modelBuffers['pass.json'].toString('utf8');
          const passJson = JSON.parse(passJsonStr);
          
          passJson.teamIdentifier = teamId;
          passJson.passTypeIdentifier = passTypeIdentifier;
          passJson.serialNumber = String(userData.address);
          passJson.description = "Zaur.at Smart Vault";
          
          // Ensure a style is defined (Default to Generic if missing)
          if (!passJson.storeCard && !passJson.generic && !passJson.eventTicket && !passJson.coupon && !passJson.boardingPass) {
              passJson.generic = {
                  primaryFields: [],
                  secondaryFields: [],
                  auxiliaryFields: [],
                  backFields: []
              };
          }

          // SECURITY & PUSH UPDATE LOGIC
          passJson.sharingProhibited = true;
          
          // Apple requires HTTPS for webServiceURL
          // PREFER dynamic apiUrl (from request Host) over static config to ensure it hits the BACKEND, not Frontend.
          const origin = userData.apiUrl || config.security.origin || '';
          
          // Re-enabled webServiceURL for updates
          if (origin.startsWith('https')) {
              passJson.webServiceURL = `${origin}/api/apple`;
              passJson.authenticationToken = userData.authToken || '3325692850392023594';
              console.log(`[PassService] Set webServiceURL to: ${passJson.webServiceURL}`);
          } else {
              console.warn(`[PassService] Origin (${origin}) is not HTTPS. Skipping webServiceURL for pass.`);
          }
          // console.warn("[PassService] DEBUG: webServiceURL DISABLED for download testing.");
          
          // DEBUG: Log final pass structure
          console.log("[PassService] --- Final Pass Structure ---");
          console.log(`[PassService] Style: ${passJson.storeCard ? 'storeCard' : (passJson.generic ? 'generic' : 'unknown')}`);
          
          const bufferDetails = Object.keys(modelBuffers).map(k => `${k}: ${modelBuffers[k].length} bytes`);
          console.log(`[PassService] Buffers: ${bufferDetails.join(', ')}`);
          
          // Check for 0-byte assets
          for (const key of Object.keys(modelBuffers)) {
              if (modelBuffers[key].length === 0) {
                  console.error(`[PassService] CRITICAL: Asset ${key} is 0 bytes!`);
                  throw new Error(`Asset ${key} is empty (0 bytes)`);
              }
          }

          console.log(`[PassService] Semantics: ${JSON.stringify(passJson.semantics ? 'Present' : 'Missing')}`);
          console.log("[PassService] ----------------------------");

          // SEMANTICS
          passJson.semantics = {
              primaryAccountNumber: userData.address,
              totalValue: {
                  amount: userData.balance,
                  currencyCode: "USD"
              },
              balance: {
                  amount: userData.balance,
                  currencyCode: "USD"
              },
              accountOwner: userData.ownerName || "Vault Owner"
          };
          
          // No Barcode for Store Card Style
          passJson.barcodes = [];
          if (passJson.barcode) delete passJson.barcode; // Remove legacy singular barcode if present
          
          // DEBUG STRATEGY: 
          // 1. Remove invalid 'suppressStrip' key (it causes validation errors on storeCard).
          // 2. Only remove strip images if they are suspiciously small (placeholders).
          //    Now that the user has updated assets, we should try to include them.
          if (passJson.storeCard) {
              if (passJson.suppressStrip) delete passJson.suppressStrip;
              
              // Validate strip.png size
              const stripSize = modelBuffers['strip.png']?.length || 0;
              const strip2xSize = modelBuffers['strip@2x.png']?.length || 0;

              if (stripSize < 200 && strip2xSize < 200) {
                   // Remove the strip images if they are still just small placeholders
                   delete modelBuffers['strip.png'];
                   delete modelBuffers['strip@2x.png'];
                   console.log(`[PassService] DEBUG: Removed small strip images (1x: ${stripSize}b, 2x: ${strip2xSize}b) to prevent validation error.`);
              } else {
                   console.log(`[PassService] DEBUG: Keeping strip images (1x: ${stripSize}b, 2x: ${strip2xSize}b).`);
              }
          }

          modelBuffers['pass.json'] = Buffer.from(JSON.stringify(passJson));
      } catch (e) {
          console.error("[PassService] Failed to patch pass.json buffer:", e);
          throw new Error("Failed to patch pass.json: " + e);
      }

      // FINAL ASSET VALIDATION
      if (!modelBuffers['icon.png'] && !modelBuffers['icon@2x.png']) {
          console.error("[PassService] CRITICAL: icon.png is missing! Pass will be rejected by Apple.");
          throw new Error("Pass generation failed: Missing mandatory icon.png");
      }

      try {
          // Prepare certificates
          const certificates = {
            wwdr: wwdrPem,
            signerCert: signerCertPem,
            signerKey: signerKeyPem,
            signerKeyPassphrase: useMockCerts ? undefined : config.apple.certificates.signerKeyPassphrase,
          };

          // QR CODE DATA - REMOVED for "Credit Card" style
          const props = {
            serialNumber: String(userData.address),
            description: 'Zaur.at Smart Vault',
            teamIdentifier: teamId,
            passTypeIdentifier: passTypeIdentifier,
            backgroundColor: 'rgb(20, 20, 20)', // Deep Obsidian Black
            labelColor: 'rgb(160, 160, 160)',   // Metallic Silver
            foregroundColor: 'rgb(255, 255, 255)',
            logoText: 'X-VAULT',
            sharingProhibited: true,
            webServiceURL: `${config.security.origin}/api/apple`,
            authenticationToken: userData.authToken || '3325692850392023594',
            appLaunchURL: `${config.security.origin}/wallet`,
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

             // 0.5. QUICK ACTIONS (Simulating App Functions)
             // Native '123' view buttons are reserved for Banks/Apple Pay.
             // We place these at the top of the Back view for 1-tap access.
             pass.backFields.push({
                 key: 'quick_actions',
                 label: 'QUICK ACTIONS',
                 value: 'Send • Receive • Swap',
                 attributedValue: `<a href="${config.security.origin}/wallet/send">Send</a> &nbsp;|&nbsp; <a href="${config.security.origin}/wallet/receive">Receive</a> &nbsp;|&nbsp; <a href="${config.security.origin}/wallet/swap">Swap</a>`
             });

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
          // Do NOT return a text buffer here. Throw so the controller returns 500.
          // Returning a text buffer with pkpass mime type causes "Download Failed" in Safari.
          throw new Error("PKPass instantiation failed: " + (pkError.message || pkError));
      }
    } catch (error: any) {
      console.error('[PassService] Error generating pass:', error);
      if (error.message) console.error('[PassService] Error Details:', error.message);
      if (error.stack) console.error('[PassService] Stack Trace:', error.stack);
      throw error;
    }
  }
}
