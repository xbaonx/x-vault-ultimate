import axios from 'axios';
import { signRequest } from '../lib/passkey';

const normalizeApiUrl = (url: string) => {
  if (!url) return 'http://localhost:3000';
  if (url.startsWith('http')) return url;
  if (url.includes('localhost')) return `http://${url}`;
  // If it has no dot, it's likely a Render service slug, so append .onrender.com
  if (!url.includes('.')) return `https://${url}.onrender.com`;
  return `https://${url}`;
};

const envUrl = import.meta.env.VITE_API_URL;
const API_URL = normalizeApiUrl(envUrl) + '/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 12000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface DeviceSession {
  sessionId: string;
  status: 'pending' | 'completed';
  deviceId?: string;
  passUrl?: string;
}

export const deviceService = {
  // Legacy/Simple registration (Mock)
  register: async (): Promise<{ sessionId: string }> => {
    const response = await api.post('/device/register');
    return response.data;
  },

  // WebAuthn Step 1: Get Options
  getRegistrationOptions: async (userId?: string): Promise<{ options: any; tempUserId: string }> => {
    const response = await api.post('/device/register/options', { userId });
    return response.data;
  },

  // WebAuthn Login Step 1: Get Login Options
  getLoginOptions: async (userId: string): Promise<{ canLogin: boolean; options?: any; message?: string }> => {
      const response = await api.post('/device/login/options', { userId });
      return response.data;
  },

  // WebAuthn Step 2: Verify Response
  verifyRegistration: async (tempUserId: string, attResp: any): Promise<{ verified: boolean; sessionId: string; deviceLibraryId: string; walletAddress: string }> => {
    const response = await api.post('/device/register/verify', {
      tempUserId,
      response: attResp,
    });
    return response.data;
  },

  // WebAuthn Login Step 2: Verify Login
  verifyLogin: async (userId: string, response: any): Promise<{ verified: boolean; deviceLibraryId: string; walletAddress: string }> => {
      const res = await api.post('/device/login/verify', {
          userId,
          response
      });
      return res.data;
  },

  pollStatus: async (sessionId: string): Promise<DeviceSession> => {
    const response = await api.get(`/device/poll/${sessionId}`);
    return response.data;
  },

  verifyDevice: async (deviceId: string): Promise<{ valid: boolean }> => {
    const response = await api.post('/device/verify', {}, {
      headers: {
        'x-device-library-id': deviceId
      }
    });
    return response.data;
  }
};

export const authService = {
  loginWithApple: async (identityToken: string, user?: any) => {
    const response = await api.post('/auth/apple/login', {
      identityToken,
      user
    });
    return response.data; // Returns { userId, email, hasWallet, hasPin }
  }
};

export const securityService = {
  setPin: async (userId: string, pin: string, deviceId: string) => {
    const response = await api.post('/security/pin/set', {
      userId,
      pin
    }, {
      headers: {
        'x-device-library-id': deviceId
      }
    });
    return response.data;
  },
  
  verifyPin: async (userId: string, pin: string, deviceId: string) => {
    const response = await api.post('/security/pin/verify', {
      userId,
      pin
    }, {
      headers: {
        'x-device-library-id': deviceId
      }
    });
    return response.data;
  }
};

export const migrationService = {
  initiateMigration: async (userId: string, deviceId: string) => {
    const response = await api.post('/migration/initiate', { userId }, {
      headers: { 'x-device-library-id': deviceId }
    });
    return response.data;
  },

  checkStatus: async (userId: string, deviceId: string) => {
    const response = await api.get(`/migration/status/${userId}`, {
      headers: { 'x-device-library-id': deviceId }
    });
    return response.data;
  },

  finalizeMigration: async (userId: string, deviceId: string) => {
    const response = await api.post('/migration/finalize', { userId }, {
      headers: { 'x-device-library-id': deviceId }
    });
    return response.data;
  },

  cancelMigration: async (userId: string) => {
    const response = await api.post('/migration/cancel', { userId });
    return response.data;
  }
};

export const walletService = {
  listWallets: async (deviceId: string) => {
    const response = await api.get('/wallet/list', {
      headers: { 'x-device-library-id': deviceId }
    });
    return response.data;
  },

  createWallet: async (name: string, deviceId: string) => {
    const response = await api.post('/wallet/create', { name }, {
      headers: { 'x-device-library-id': deviceId }
    });
    return response.data;
  },

  getPortfolio: async (userId: string, deviceId: string, walletId?: string) => {
    // userId param is legacy/ignored by backend now, but kept for route compatibility
    const url = walletId ? `/wallet/portfolio/${userId}?walletId=${walletId}` : `/wallet/portfolio/${userId}`;
    const response = await api.get(url, {
      headers: { 'x-device-library-id': deviceId }
    });
    return response.data;
  },
  
  getAddress: async (userId: string, deviceId: string, walletId?: string) => {
    const url = walletId ? `/wallet/address/${userId}?walletId=${walletId}` : `/wallet/address/${userId}`;
    const response = await api.get(url, {
      headers: { 'x-device-library-id': deviceId }
    });
    return response.data;
  },

  /**
   * Send a secure transaction with Passkey signing
   */
  sendTransaction: async (_userId: string, transaction: any, deviceId: string, spendingPin?: string) => {
    try {
      // 1. Get AA UserOp + Challenge from Backend
      const optionsRes = await api.post('/aa/userop/options', { transaction, spendingPin }, {
        headers: { 'x-device-library-id': deviceId }
      });
      const options = optionsRes.data;

      // 2. Sign challenge with Passkey (FaceID/TouchID)
      const assertion = await signRequest(options.challenge);

      // 3. Send signed UserOperation to Backend for bundler relay
      const response = await api.post('/aa/userop/send', {
        chainId: options.chainId,
        userOp: options.userOp,
        assertion,
      }, {
        headers: { 'x-device-library-id': deviceId }
      });

      const data = response.data || {};
      const txHash = data.txHash || data.userOpHash;

      return { ...data, txHash, fee: options.fee };
    } catch (error) {
      console.error("Transaction failed:", error);
      throw error;
    }
  },

  cancelTransaction: async (userId: string, transactionId: string, deviceId: string) => {
      const response = await api.post('/wallet/transaction/cancel', {
          userId,
          transactionId
      }, {
          headers: { 'x-device-library-id': deviceId }
      });
      return response.data;
  }
};
