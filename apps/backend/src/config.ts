import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
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
  }
};
