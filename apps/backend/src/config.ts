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

 function normalizePrivateKey(k: string | undefined): string {
   const key = (k || '').trim();
   if (!key) return '';
   if (/^[0-9a-fA-F]{64}$/.test(key)) return `0x${key}`;
   return key;
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

function getAlchemyRpcUrl(chainId: number): string | undefined {
  const apiKey = (process.env.ALCHEMY_API_KEY || '').trim();
  if (!apiKey) return undefined;

  // RPC support can be broader than Alchemy's ERC-4337 bundler support.
  const hostByChainId: Record<number, string> = {
    1: 'eth-mainnet.g.alchemy.com',
    10: 'opt-mainnet.g.alchemy.com',
    137: 'polygon-mainnet.g.alchemy.com',
    42161: 'arb-mainnet.g.alchemy.com',
    8453: 'base-mainnet.g.alchemy.com',
    56: 'bnb-mainnet.g.alchemy.com',
    43114: 'avax-mainnet.g.alchemy.com',
    59144: 'linea-mainnet.g.alchemy.com',
  };

  const host = hostByChainId[chainId];
  if (!host) return undefined;
  return `https://${host}/v2/${apiKey}`;
}

function isDefaultPublicRpc(url?: string): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  return (
    normalized.includes('publicnode.com') ||
    normalized.includes('mainnet.base.org') ||
    normalized.includes('polygon-bor.publicnode.com') ||
    normalized.includes('optimism-rpc.publicnode.com') ||
    normalized.includes('ethereum-rpc.publicnode.com') ||
    normalized.includes('arbitrum-one-rpc.publicnode.com') ||
    normalized.includes('bsc-dataseed.binance.org') ||
    normalized.includes('api.avax.network') ||
    normalized.includes('rpc.linea.build')
  );
}

function getPreferredRpcUrl(chainId: number, envUrl: string | undefined, defaultUrl: string): string {
  const trimmed = (envUrl || '').trim();
  if (trimmed && !isDefaultPublicRpc(trimmed)) {
    return trimmed;
  }

  return getAlchemyRpcUrl(chainId) || (trimmed || defaultUrl);
}

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  alchemy: {
    webhookSigningKey: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY || '',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'xvault',
  },
  blockchain: {
    chainId: parseInt(process.env.CHAIN_ID || '8453'),
    rpcUrl: getPreferredRpcUrl(parseInt(process.env.CHAIN_ID || '8453'), process.env.RPC_URL, 'https://mainnet.base.org'),
    bundlerUrl: process.env.BUNDLER_URL || 'https://api.stackup.sh/v1/node/your-api-key',
    entryPointAddress: process.env.ENTRY_POINT_ADDRESS || DEFAULT_ENTRY_POINT_ADDRESS,
    paymaster: {
      address: process.env.PAYMASTER_ADDRESS || '',
      signingKey: normalizePrivateKey(process.env.PAYMASTER_SIGNING_KEY), // Private key for signing gas sponsorship
    },
    factoryAddress: process.env.FACTORY_ADDRESS || '',
    aa: {
      bundlerUrl: (chainId: number) => getEnvByChainId('BUNDLER_URL', chainId) || getAlchemyBundlerUrl(chainId) || '',
      entryPointAddress: (chainId: number) => getEnvByChainId('ENTRY_POINT_ADDRESS', chainId) || DEFAULT_ENTRY_POINT_ADDRESS,
      factoryAddress: (chainId: number) => getEnvByChainId('FACTORY_ADDRESS', chainId) || (process.env.FACTORY_ADDRESS || '').trim(),
      accountImplementationAddress: (chainId: number) => getEnvByChainId('ACCOUNT_IMPLEMENTATION', chainId) || '',
      paymasterAddress: (chainId: number) => getEnvByChainId('PAYMASTER_ADDRESS', chainId) || '',
      paymasterSigningKey: (chainId: number) => normalizePrivateKey(getEnvByChainId('PAYMASTER_SIGNING_KEY', chainId)),
      treasuryAddress: (chainId: number) => getEnvByChainId('TREASURY_ADDRESS', chainId) || '',
    },
    // Multi-chain Configuration
    chains: {
        base: {
            rpcUrl: getPreferredRpcUrl(8453, process.env.BASE_RPC_URL, 'https://mainnet.base.org'),
            chainId: 8453,
            symbol: 'ETH',
            name: 'Base'
        },
        polygon: {
            rpcUrl: getPreferredRpcUrl(137, process.env.POLYGON_RPC_URL, 'https://polygon-bor.publicnode.com'),
            chainId: 137,
            symbol: 'POL', // Display symbol; pricing may still use MATIC ticker
            name: 'Polygon'
        },
        arbitrum: {
            rpcUrl: getPreferredRpcUrl(42161, process.env.ARBITRUM_RPC_URL, 'https://arbitrum-one-rpc.publicnode.com'),
            chainId: 42161,
            symbol: 'ETH',
            name: 'Arbitrum'
        },
        optimism: {
            rpcUrl: getPreferredRpcUrl(10, process.env.OPTIMISM_RPC_URL, 'https://optimism-rpc.publicnode.com'),
            chainId: 10,
            symbol: 'ETH',
            name: 'Optimism'
        },
        ethereum: {
            rpcUrl: getPreferredRpcUrl(1, process.env.ETH_RPC_URL, 'https://ethereum-rpc.publicnode.com'),
            chainId: 1,
            symbol: 'ETH',
            name: 'Ethereum'
        },
        bsc: {
            rpcUrl: getPreferredRpcUrl(56, process.env.BSC_RPC_URL, 'https://bsc-dataseed.binance.org'),
            chainId: 56,
            symbol: 'BNB',
            name: 'BSC'
        },
        avalanche: {
            rpcUrl: getPreferredRpcUrl(43114, process.env.AVALANCHE_RPC_URL, 'https://api.avax.network/ext/bc/C/rpc'),
            chainId: 43114,
            symbol: 'AVAX',
            name: 'Avalanche'
        },
        linea: {
            rpcUrl: getPreferredRpcUrl(59144, process.env.LINEA_RPC_URL, 'https://rpc.linea.build'),
            chainId: 59144,
            symbol: 'ETH',
            name: 'Linea'
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
    adminKey: process.env.ADMIN_KEY || '',
    rpId: process.env.RP_ID || 'zaur.at',
    rpName: process.env.RP_NAME || 'Zaur Wallet',
    origin: process.env.ORIGIN || 'https://zaur.at',
    jwtSecret: process.env.JWT_SECRET || '',
    applePassAuthSecret: process.env.APPLE_PASS_AUTH_SECRET || '',
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  }
};
