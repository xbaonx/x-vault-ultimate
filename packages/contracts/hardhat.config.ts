import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      chainId: 8453,
      accounts,
    },
    ethereum: {
      url: process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
      chainId: 1,
      accounts,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || 'https://polygon-bor.publicnode.com',
      chainId: 137,
      accounts,
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com',
      chainId: 42161,
      accounts,
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || 'https://optimism-rpc.publicnode.com',
      chainId: 10,
      accounts,
    },
  },
};

export default config;
