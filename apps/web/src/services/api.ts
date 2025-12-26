import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api';

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
  register: async (): Promise<{ sessionId: string }> => {
    const response = await api.post('/device/register');
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
