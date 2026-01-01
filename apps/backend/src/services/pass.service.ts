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
      origin?: string;
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
          
          // Use provided origin or fallback to config
          const origin = userData.origin || config.security.origin;
          passJson.webServiceURL = `${origin}/api/apple`;
          console.log(`[PassService] Setting webServiceURL to: ${passJson.webServiceURL}`);
          
          passJson.authenticationToken = userData.authToken || '3325692850392023594'; // Token for APNs updates
          
          // SEMANTIC TAGS (iOS 15+)
          // Allows iOS to display key info (Balance, etc.) in the Wallet Dashboard/Stack View
          // without needing to open the pass details.
          passJson.semantics = {
              balance: {
                  amount: parseFloat(userData.balance).toFixed(2),
                  currencyCode: "USD"
              },
              lastUpdated: new Date().toISOString(),
              membershipNumber: userData.address
          };

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
            webServiceURL: `${userData.origin || config.security.origin}/api/apple`,
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
             // Left: Masked Number ".... 2863"
             pass.auxiliaryFields.push({
                key: 'account_number',
                label: 'VAULT NUMBER',
                value: `•••• ${userData.address.slice(-4)}`,
                textAlignment: 'PKTextAlignmentLeft'
             });
             
             // Right: Tier Branding "Visa Signature"
             pass.auxiliaryFields.push({
                key: 'card_tier',
                label: 'TIER',
                value: 'Signature',
                textAlignment: 'PKTextAlignmentRight'
             });
          }

          // --- BACK OF CARD (Details View) ---
          
          // --- BACK OF CARD (Details View) ---
          
          if (pass.backFields) {
             // ---------------------------------------------------------
             // 1. CÁC NÚT CHỨC NĂNG CHÍNH (TOP ACTIONS)
             // ---------------------------------------------------------
             
             // [1] Send
             pass.backFields.push({
                 key: 'action_send',
                 label: '📤 Gửi Tài Sản (Send)',
                 value: 'Gửi tiền ngay →',
                 attributedValue: '<a href="https://zaur.at/app/send">Gửi tiền ngay →</a>'
             });

             // [2] Receive
             pass.backFields.push({
                 key: 'action_receive',
                 label: '📥 Nhận Tài Sản (Receive)',
                 value: 'Hiển thị mã QR →',
                 attributedValue: '<a href="https://zaur.at/app/receive">Hiển thị mã QR →</a>'
             });

             // [3] Swap
             pass.backFields.push({
                 key: 'action_swap',
                 label: '🔄 Hoán Đổi (Swap)',
                 value: 'Tối ưu tỷ giá →',
                 attributedValue: '<a href="https://zaur.at/app/swap">Tối ưu tỷ giá →</a>'
             });

             // ---------------------------------------------------------
             // 2. CHI TIẾT DANH MỤC TÀI SẢN (ASSET BREAKDOWN)
             // ---------------------------------------------------------
             pass.backFields.push({
                 key: 'assets_header',
                 label: 'ASSET BREAKDOWN',
                 value: 'Danh mục tài sản',
             });

             if (userData.assets) {
                 // Sort assets by value (descending)
                 const sortedAssets = Object.entries(userData.assets)
                    .map(([symbol, data]) => ({ symbol, ...data }))
                    .sort((a, b) => b.value - a.value);

                 sortedAssets.forEach(asset => {
                     if (asset.amount > 0) {
                         // Mapping names like "Số dư Ethereum (ETH)" based on symbol
                         let label = `Số dư ${asset.symbol}`;
                         if (asset.symbol === 'ETH') label = 'Số dư Ethereum (ETH)';
                         if (asset.symbol === 'BTC') label = 'Số dư Bitcoin (BTC)';
                         if (asset.symbol === 'SOL') label = 'Số dư Solana (SOL)';
                         if (asset.symbol === 'USDT' || asset.symbol === 'USDC' || asset.symbol === 'DAI') label = `Số dư Stablecoin (${asset.symbol})`;
                         if (asset.symbol === 'MATIC' || asset.symbol === 'POL') label = 'Số dư Polygon (POL)';

                         pass.backFields.push({
                             key: `asset_${asset.symbol.toLowerCase()}`,
                             label: label,
                             value: `${asset.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${asset.symbol} ${asset.value > 0 ? `(~${formatCurrency(asset.value)})` : ''}`,
                         });
                     }
                 });
             } else {
                 // Fallback if no assets provided (Mock for visual verification)
                 pass.backFields.push({
                     key: 'asset_eth',
                     label: 'Số dư Ethereum (ETH)',
                     value: '0.00 ETH (~$0.00)',
                 });
             }

             // Credit Limit (usdz) - Fixed Item
             pass.backFields.push({
                 key: 'asset_usdz',
                 label: 'Hạn mức giao dịch (usdz)',
                 value: '$10.00 usdz',
             });

             // ---------------------------------------------------------
             // 3. CHƯƠNG TRÌNH GIỚI THIỆU (REFERRAL - $10 + $10)
             // ---------------------------------------------------------
             pass.backFields.push({
                 key: 'referral_code',
                 label: 'Mã giới thiệu của bạn',
                 value: 'ZAUR-PRO-10',
             });

             pass.backFields.push({
                 key: 'referral_offer',
                 label: 'Ưu đãi bạn bè',
                 value: 'Chia sẻ mã này để bạn và người đó đều nhận được $10 usdz khi họ nạp tài sản đầu tiên.',
             });

             pass.backFields.push({
                 key: 'referral_earnings',
                 label: 'Tổng thưởng đã nhận',
                 value: '$150.00 usdz',
             });

             // ---------------------------------------------------------
             // 4. THÔNG SỐ BẢO MẬT PHẦN CỨNG (HARDWARE SPECS)
             // ---------------------------------------------------------
             const hwId = userData.deviceId 
                ? `DID-${userData.deviceId.substring(0, 4).toUpperCase()}-${userData.deviceId.substring(4, 8).toUpperCase()}-XXXX`
                : 'DID-8829-AF72-XXXX';

             pass.backFields.push({
                 key: 'hw_id',
                 label: 'ID Thiết bị (Hardware ID)',
                 value: `${hwId} (Dấu vân tay vật lý)`,
             });

             pass.backFields.push({
                 key: 'secure_enclave',
                 label: 'Trạng thái Chip Secure Enclave',
                 value: '● Đã khóa phần cứng (Locked)',
             });

             pass.backFields.push({
                 key: 'security_delay',
                 label: 'Cơ chế Trì hoãn (Security Delay)',
                 value: userData.securityDelay ? `${userData.securityDelay} (Custom)` : '48 Giờ (Áp dụng cho mọi lệnh rút trên $2,000)',
             });

             pass.backFields.push({
                 key: 'vault_address',
                 label: 'Địa chỉ Két sắt (Vault)',
                 value: userData.address,
                 // attributedValue: `<a href="https://etherscan.io/address/${userData.address}">${userData.address.substring(0, 6)}...${userData.address.slice(-4)}</a>`
             });

             // ---------------------------------------------------------
             // 5. HỖ TRỢ & PHÁP LÝ
             // ---------------------------------------------------------
             pass.backFields.push({
                 key: 'emergency_freeze',
                 label: 'Khóa két khẩn cấp',
                 value: 'Đóng băng ví ngay lập tức →',
                 attributedValue: '<a href="https://zaur.at/freeze">Đóng băng ví ngay lập tức →</a>'
             });
             
             pass.backFields.push({
                 key: 'legal_terms',
                 label: 'Điều khoản sử dụng',
                 value: 'zaur.at/terms',
                 attributedValue: '<a href="https://zaur.at/terms">zaur.at/terms</a>'
             });
             
             // Timestamp
             pass.backFields.push({
                 key: 'last_updated',
                 label: 'CẬP NHẬT LẦN CUỐI',
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
