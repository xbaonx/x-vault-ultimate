"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PassService = void 0;
const passkit_generator_1 = require("passkit-generator");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
const data_source_1 = require("../data-source");
const AppleConfig_1 = require("../entities/AppleConfig");
class PassService {
    static async generatePass(userData) {
        try {
            const modelPath = path_1.default.resolve(__dirname, '../../assets/pass.model');
            const hasModel = fs_1.default.existsSync(modelPath);
            if (!hasModel) {
                console.warn('Apple pass model not found. Returning mock pass buffer.');
                return Buffer.from('Mock PKPass File Content');
            }
            let dbConfig = null;
            if (data_source_1.AppDataSource.isInitialized) {
                const repo = data_source_1.AppDataSource.getRepository(AppleConfig_1.AppleConfig);
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
            const hasCertsFromFs = fs_1.default.existsSync(path_1.default.resolve(config_1.config.apple.certificates.signerCert));
            const hasCerts = hasCertsFromDb || hasCertsFromFs;
            if (!hasCerts) {
                console.warn("Apple Certificates not found. Returning mock pass buffer.");
                // Return a dummy buffer for demo purposes
                return Buffer.from("Mock PKPass File Content");
            }
            const pass = new passkit_generator_1.PKPass({
                model: modelPath, // Directory containing pass.json, icon.png, etc.
                certificates: {
                    wwdr: hasCertsFromDb ? Buffer.from(wwdrFromDb, 'utf8') : fs_1.default.readFileSync(path_1.default.resolve(config_1.config.apple.certificates.wwdr)),
                    signerCert: hasCertsFromDb ? Buffer.from(signerCertFromDb, 'utf8') : fs_1.default.readFileSync(path_1.default.resolve(config_1.config.apple.certificates.signerCert)),
                    signerKey: hasCertsFromDb ? Buffer.from(signerKeyFromDb, 'utf8') : fs_1.default.readFileSync(path_1.default.resolve(config_1.config.apple.certificates.signerKey)),
                    signerKeyPassphrase: (hasCertsFromDb ? signerKeyPassphraseFromDb : config_1.config.apple.certificates.signerKeyPassphrase) || '',
                },
            }, {
                serialNumber: userData.address,
                description: 'X-Vault Web3 Account',
            });
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
            pass.barcodes = [
                {
                    format: 'PKBarcodeFormatQR',
                    message: `ethereum:${userData.address}`,
                    messageEncoding: 'iso-8859-1',
                },
            ];
            return pass.getAsBuffer();
        }
        catch (error) {
            console.error('Error generating pass:', error);
            throw error;
        }
    }
}
exports.PassService = PassService;
