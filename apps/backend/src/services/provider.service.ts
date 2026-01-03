import { ethers } from 'ethers';
import { config } from '../config';

function redactRpcUrl(url: string): string {
  if (!url) return url;
  return url.replace(/\/v2\/[a-zA-Z0-9_-]+/g, '/v2/***');
}

export class ProviderService {
  private static providers: Record<number, ethers.JsonRpcProvider> = {};

  /**
   * Get a singleton provider instance for a specific chain.
   * Initializes it if it doesn't exist.
   */
  static getProvider(chainId: number): ethers.JsonRpcProvider {
    if (this.providers[chainId]) {
      return this.providers[chainId];
    }

    const chainConfig = Object.values(config.blockchain.chains).find(c => c.chainId === chainId);
    
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    console.log(`[ProviderService] Using RPC for chainId=${chainConfig.chainId} (${chainConfig.name}): ${redactRpcUrl(chainConfig.rpcUrl)}`);

    // Initialize with staticNetwork: true to avoid "failed to detect network" errors
    // and skip the initial eth_chainId call overhead.
    const provider = new ethers.JsonRpcProvider(
      chainConfig.rpcUrl, 
      chainConfig.chainId, 
      { staticNetwork: true }
    );

    this.providers[chainId] = provider;
    return provider;
  }

  /**
   * Pre-warm connections for all configured chains
   */
  static initialize() {
    console.log('[ProviderService] Initializing blockchain providers...');
    Object.values(config.blockchain.chains).forEach(chain => {
      try {
        this.getProvider(chain.chainId);
      } catch (e) {
        console.warn(`[ProviderService] Failed to initialize provider for ${chain.name}:`, e);
      }
    });
  }
}
