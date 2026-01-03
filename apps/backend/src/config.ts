import dotenv from 'dotenv';
dotenv.config();

 const DEFAULT_ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

 function getEnvByChainId(baseKey: string, chainId: number): string | undefined {
   const chainKey = `${baseKey}_${chainId}`;
   const v1 = process.env[chainKey];
   if (v1 && v1.length > 0) return v1.trim();
   const v0 = process.env[baseKey];
   if (v0 && v0.length > 0) return v0.trim();
   return undefined;
 }

 function getAlchemyBundlerUrl(chainId: number): string | undefined {
   const apiKey = (process.env.ALCHEMY_API_KEY || '').trim();
   if (!apiKey) return undefined;

   // Alchemy bundler methods (eth_sendUserOperation, etc.) are exposed via the chain RPC endpoints.
   const hostByChainId: Record<number, string> = {
     1: 'eth-mainnet.g.alchemy.com',
     10: 'opt-mainnet.g.alchemy.com',
     137: 'polygon-mainnet.g.alchemy.com',
     42161: 'arb-mainnet.g.alchemy.com',
     8453: 'base-mainnet.g.alchemy.com',
   };

   const host = hostByChainId[chainId];
   if (!host) return undefined;
   return `https://${host}/v2/${apiKey}`;
 }

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
    entryPointAddress: process.env.ENTRY_POINT_ADDRESS || DEFAULT_ENTRY_POINT_ADDRESS,
    paymaster: {
      address: process.env.PAYMASTER_ADDRESS || '',
      signingKey: process.env.PAYMASTER_SIGNING_KEY || '', // Private key for signing gas sponsorship
    },
    factoryAddress: process.env.FACTORY_ADDRESS || '',
    aa: {
      bundlerUrl: (chainId: number) => getEnvByChainId('BUNDLER_URL', chainId) || getAlchemyBundlerUrl(chainId) || '',
      entryPointAddress: (chainId: number) => getEnvByChainId('ENTRY_POINT_ADDRESS', chainId) || DEFAULT_ENTRY_POINT_ADDRESS,
      factoryAddress: (chainId: number) => getEnvByChainId('FACTORY_ADDRESS', chainId) || '',
      paymasterAddress: (chainId: number) => getEnvByChainId('PAYMASTER_ADDRESS', chainId) || '',
      paymasterSigningKey: (chainId: number) => getEnvByChainId('PAYMASTER_SIGNING_KEY', chainId) || '',
      treasuryAddress: (chainId: number) => getEnvByChainId('TREASURY_ADDRESS', chainId) || '',
    },
    // Multi-chain Configuration
    chains: {
        base: {
            rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
            chainId: 8453,
            symbol: 'ETH',
            name: 'Base'
        },
        polygon: {
            rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-bor.publicnode.com',
            chainId: 137,
            symbol: 'MATIC', // Now POL, but let's keep MATIC/POL symbol flexible
            name: 'Polygon'
        },
        arbitrum: {
            rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com',
            chainId: 42161,
            symbol: 'ETH',
            name: 'Arbitrum'
        },
        optimism: {
            rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://optimism-rpc.publicnode.com',
            chainId: 10,
            symbol: 'ETH',
            name: 'Optimism'
        },
        ethereum: {
            rpcUrl: process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
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
