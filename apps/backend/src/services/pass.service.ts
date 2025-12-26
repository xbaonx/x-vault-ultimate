import { PKPass } from 'passkit-generator';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { AppDataSource } from '../data-source';
import { AppleConfig } from '../entities/AppleConfig';

export class PassService {
  static async generatePass(userData: { address: string; balance: string }) {
    try {
      const modelPath = path.resolve(__dirname, '../../assets/pass.model');
      const hasModel = fs.existsSync(modelPath);

      if (!hasModel) {
        console.warn('Apple pass model not found. Returning mock pass buffer.');
        return Buffer.from('Mock PKPass File Content') as any;
      }

      let dbConfig: AppleConfig | null = null;
      if (AppDataSource.isInitialized) {
        const repo = AppDataSource.getRepository(AppleConfig);
        dbConfig = await repo.findOne({ where: { name: 'default' } });
      }

      const wwdrFromDb = dbConfig?.wwdrPem;
      const signerCertFromDb = dbConfig?.signerCertPem;
      const signerKeyFromDb = dbConfig?.signerKeyPem;
      const signerKeyPassphraseFromDb = dbConfig?.signerKeyPassphrase;

      // In a real environment, we would load real certificates
      // For this MVP/Demo, we will mock the pass generation if certs are missing
      // or try to generate if they exist.
      
      // Check if certs exist (mock check)
      const hasCertsFromDb = !!(wwdrFromDb && signerCertFromDb && signerKeyFromDb);
      const hasCertsFromFs = fs.existsSync(path.resolve(config.apple.certificates.signerCert));
      const hasCerts = hasCertsFromDb || hasCertsFromFs;
      
      if (!hasCerts) {
        console.warn("Apple Certificates not found. Returning mock pass buffer.");
        // Return a dummy buffer for demo purposes
        return Buffer.from("Mock PKPass File Content") as any;
      }

      const pass = new PKPass(
        {
          model: modelPath as any, // Directory containing pass.json, icon.png, etc.
          certificates: {
            wwdr: hasCertsFromDb ? Buffer.from(wwdrFromDb!, 'utf8') : fs.readFileSync(path.resolve(config.apple.certificates.wwdr)),
            signerCert: hasCertsFromDb ? Buffer.from(signerCertFromDb!, 'utf8') : fs.readFileSync(path.resolve(config.apple.certificates.signerCert)),
            signerKey: hasCertsFromDb ? Buffer.from(signerKeyFromDb!, 'utf8') : fs.readFileSync(path.resolve(config.apple.certificates.signerKey)),
            signerKeyPassphrase: (hasCertsFromDb ? signerKeyPassphraseFromDb : config.apple.certificates.signerKeyPassphrase) || '',
          } as any,
        },
        {
          serialNumber: userData.address,
          description: 'X-Vault Web3 Account',
        } as any
      );

      // Add dynamic data
      pass.primaryFields.push({
        key: 'balance',
        label: 'TOTAL BALANCE',
        value: userData.balance,
        currencyCode: 'USD',
      });

      pass.secondaryFields.push({
        key: 'address',
        label: 'WALLET ADDRESS',
        value: `${userData.address.slice(0, 6)}...${userData.address.slice(-4)}`,
      });

      pass.auxiliaryFields.push({
        key: 'status',
        label: 'STATUS',
        value: 'Active',
      });
      
      // QR Code for receiving address
      (pass as any).barcodes = [
        {
          format: 'PKBarcodeFormatQR',
          message: `ethereum:${userData.address}`,
          messageEncoding: 'iso-8859-1',
        },
      ];

      return pass.getAsBuffer();
    } catch (error) {
      console.error('Error generating pass:', error);
      throw error;
    }
  }
}
