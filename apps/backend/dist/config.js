"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL,
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'xvault',
    },
    blockchain: {
        rpcUrl: process.env.RPC_URL || 'https://mainnet.base.org',
        chainId: parseInt(process.env.CHAIN_ID || '8453'),
        bundlerUrl: process.env.BUNDLER_URL || 'https://api.stackup.sh/v1/node/your-api-key',
        paymaster: {
            address: process.env.PAYMASTER_ADDRESS || '',
            signingKey: process.env.PAYMASTER_SIGNING_KEY || '', // Private key for signing gas sponsorship
        },
        factoryAddress: process.env.FACTORY_ADDRESS || '',
    },
    apple: {
        clientId: process.env.APPLE_CLIENT_ID || 'com.xvault.app', // Service ID or Bundle ID
        teamId: process.env.APPLE_TEAM_ID || 'TEAMID1234',
        passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || 'pass.com.xvault.wallet',
        certificates: {
            wwdr: process.env.APPLE_WWDR_CERT || './certs/wwdr.pem',
            signerCert: process.env.APPLE_SIGNER_CERT || './certs/signerCert.pem',
            signerKey: process.env.APPLE_SIGNER_KEY || './certs/signerKey.pem',
            signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASSPHRASE || 'secret',
        }
    },
    security: {
        adminKey: process.env.ADMIN_KEY || 'default-admin-key',
        rpId: process.env.RP_ID || 'localhost',
        rpName: process.env.RP_NAME || 'X-Vault Wallet',
        origin: process.env.ORIGIN || 'http://localhost:5173', // Vite default port
    }
};
