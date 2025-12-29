import { PKPass } from 'passkit-generator';
import path from 'path';
import fs from 'fs';
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
      const teamIdFromDb = dbConfig?.teamId;
      const passTypeIdentifierFromDb = dbConfig?.passTypeIdentifier;

      // In a real environment, we would load real certificates
      // For this MVP/Demo, we will mock the pass generation if certs are missing
      // or try to generate if they exist.
      
      const hasCertsFromDb = !!(wwdrFromDb && signerCertFromDb && signerKeyFromDb && teamIdFromDb && passTypeIdentifierFromDb);
      
      if (!hasCertsFromDb) {
        console.warn("Apple Certificates or Config not found in DB. Returning mock pass buffer.");
        // Return a dummy buffer for demo purposes
        return Buffer.from("Mock PKPass File Content") as any;
      }

      const pass = new PKPass(
        {
          model: modelPath as any, // Directory containing pass.json, icon.png, etc.
          certificates: {
            wwdr: Buffer.from(wwdrFromDb!, 'utf8'),
            signerCert: Buffer.from(signerCertFromDb!, 'utf8'),
            signerKey: Buffer.from(signerKeyFromDb!, 'utf8'),
            signerKeyPassphrase: signerKeyPassphraseFromDb || '',
          } as any,
        },
        {
          serialNumber: userData.address,
          description: 'Zaur Web3 Account',
          teamIdentifier: teamIdFromDb,
          passTypeIdentifier: passTypeIdentifierFromDb,
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
