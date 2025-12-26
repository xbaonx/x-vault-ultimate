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
class PassService {
    static async generatePass(userData) {
        try {
            // In a real environment, we would load real certificates
            // For this MVP/Demo, we will mock the pass generation if certs are missing
            // or try to generate if they exist.
            // Check if certs exist (mock check)
            const hasCerts = fs_1.default.existsSync(path_1.default.resolve(config_1.config.apple.certificates.signerCert));
            if (!hasCerts) {
                console.warn("Apple Certificates not found. Returning mock pass buffer.");
                // Return a dummy buffer for demo purposes
                return Buffer.from("Mock PKPass File Content");
            }
            const pass = new passkit_generator_1.PKPass({
                model: path_1.default.resolve(__dirname, '../../assets/pass.model'), // Directory containing pass.json, icon.png, etc.
                certificates: {
                    wwdr: fs_1.default.readFileSync(path_1.default.resolve(config_1.config.apple.certificates.wwdr)),
                    signerCert: fs_1.default.readFileSync(path_1.default.resolve(config_1.config.apple.certificates.signerCert)),
                    signerKey: fs_1.default.readFileSync(path_1.default.resolve(config_1.config.apple.certificates.signerKey)),
                    signerKeyPassphrase: config_1.config.apple.certificates.signerKeyPassphrase,
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
