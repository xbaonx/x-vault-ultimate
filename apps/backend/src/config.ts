import dotenv from 'dotenv';
dotenv.config();

export const config = {
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
    // Multi-chain Configuration
    chains: {
        base: {
            rpcUrl: process.env.BASE_RPC_URL || 'https://rpc.ankr.com/base',
            chainId: 8453,
            symbol: 'ETH',
            name: 'Base'
        },
        polygon: {
            rpcUrl: process.env.POLYGON_RPC_URL || 'https://rpc.ankr.com/polygon',
            chainId: 137,
            symbol: 'MATIC', // Now POL, but let's keep MATIC/POL symbol flexible
            name: 'Polygon'
        },
        arbitrum: {
            rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://rpc.ankr.com/arbitrum',
            chainId: 42161,
            symbol: 'ETH',
            name: 'Arbitrum'
        },
        optimism: {
            rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://rpc.ankr.com/optimism',
            chainId: 10,
            symbol: 'ETH',
            name: 'Optimism'
        },
        ethereum: {
            rpcUrl: process.env.ETH_RPC_URL || 'https://rpc.ankr.com/eth',
            chainId: 1,
            symbol: 'ETH',
            name: 'Ethereum'
        }
    }
  },
  apple: {
    clientId: process.env.APPLE_CLIENT_ID || 'com.bnx.zaur.service', // Service ID for SIWA
    teamId: process.env.APPLE_TEAM_ID || '93MNWVKKU9',
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || 'pass.com.bnx.zaur',
    certificates: {
      wwdr: process.env.APPLE_WWDR_CERT || './certs/wwdr.pem',
      signerCert: process.env.APPLE_SIGNER_CERT || './certs/signerCert.pem',
      signerKey: process.env.APPLE_SIGNER_KEY || './certs/signerKey.pem',
      signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASSPHRASE || 'secret',
    }
  },
  security: {
    adminKey: process.env.ADMIN_KEY || 'default-admin-key',
    rpId: process.env.RP_ID || 'zaur.at',
    rpName: process.env.RP_NAME || 'Zaur Wallet',
    origin: process.env.ORIGIN || 'https://zaur.at',
  }
};
