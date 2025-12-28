import axios from 'axios';

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

  // WebAuthn Step 2: Verify Response
  verifyRegistration: async (tempUserId: string, attResp: any): Promise<{ verified: boolean; sessionId: string; deviceLibraryId: string; walletAddress: string }> => {
    const response = await api.post('/device/register/verify', {
      tempUserId,
      response: attResp,
    });
    return response.data;
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
  getPortfolio: async (userId: string) => {
    const response = await api.get(`/wallet/portfolio/${userId}`);
    return response.data;
  },
  
  getAddress: async (userId: string) => {
    const response = await api.get(`/wallet/address/${userId}`);
    return response.data;
  }
};
