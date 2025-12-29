const normalizeApiUrl = (url: string | undefined) => {
  if (!url) return 'http://localhost:3000';
  if (url.startsWith('http')) return url;
  if (url.includes('localhost')) return `http://${url}`;
  if (!url.includes('.')) return `https://${url}.onrender.com`;
  return `https://${url}`;
};

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL) + '/api';

console.log('[AdminAPI] Initialization:', {
  envViteApiUrl: import.meta.env.VITE_API_URL,
  finalApiUrl: API_URL,
  windowLocation: window.location.origin
});

if (window.location.hostname !== 'localhost' && API_URL.includes('localhost')) {
  console.error('[AdminAPI] CRITICAL WARNING: Running on production domain but connecting to localhost API. VITE_API_URL is likely missing from build configuration.');
}

export type AppleConfigStatus = {
  configured: boolean;
  teamId: string | null;
  passTypeIdentifier: string | null;
  hasWwdr: boolean;
  hasSignerCert: boolean;
  hasSignerKey: boolean;
  hasSignerKeyPassphrase: boolean;
  updatedAt?: string;
};

export type DashboardStats = {
  stats: {
    totalUsers: number;
    totalVolume: number;
    activeSessions: number;
    gasSponsored: string;
  };
  recentUsers: {
    id: string;
    address: string;
    status: string;
    joined: string;
  }[];
  userGrowthData: { name: string; users: number }[];
  transactionVolumeData: { name: string; volume: number }[];
};

export type UserData = {
  id: string;
  address: string;
  createdAt: string;
  updatedAt: string;
  isFrozen?: boolean;
};

export type TransactionData = {
  id: string;
  userOpHash: string;
  network: string;
  status: string;
  userAddress: string;
  createdAt: string;
};

function buildHeaders(adminKey?: string) {
  const headers: Record<string, string> = {};
  if (adminKey) headers['x-admin-key'] = adminKey;
  return headers;
}

export const adminApi = {
  getDashboardStats: async (adminKey: string): Promise<DashboardStats> => {
    const res = await fetch(`${API_URL}/admin/dashboard`, {
      headers: buildHeaders(adminKey),
    });

    if (res.status === 401) {
      throw new Error('Invalid Admin Key. Please check your key.');
    }

    if (!res.ok) {
      throw new Error('Failed to fetch dashboard stats');
    }
    return res.json();
  },

  getUsers: async (adminKey: string): Promise<UserData[]> => {
    const res = await fetch(`${API_URL}/admin/users`, {
      headers: buildHeaders(adminKey),
    });

    if (res.status === 401) {
      throw new Error('Invalid Admin Key. Please check your key.');
    }

    if (!res.ok) {
      throw new Error('Failed to fetch users');
    }
    return res.json();
  },

  getTransactions: async (adminKey: string): Promise<TransactionData[]> => {
    const res = await fetch(`${API_URL}/admin/transactions`, {
      headers: buildHeaders(adminKey),
    });

    if (res.status === 401) {
      throw new Error('Invalid Admin Key. Please check your key.');
    }

    if (!res.ok) {
      throw new Error('Failed to fetch transactions');
    }
    return res.json();
  },

  getAppleConfig: async (adminKey: string): Promise<AppleConfigStatus> => {
    const res = await fetch(`${API_URL}/admin/apple/config`, {
      headers: buildHeaders(adminKey),
    });

    if (res.status === 401) {
      throw new Error('Invalid Admin Key. Please check your key.');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Request failed');
    }

    return res.json();
  },

  uploadAppleCerts: async (params: {
    adminKey: string;
    teamId?: string;
    passTypeIdentifier?: string;
    signerKeyPassphrase?: string;
    wwdr?: File | null;
    signerP12?: File | null;
  }) => {
    const form = new FormData();
    if (params.teamId) form.append('teamId', params.teamId);
    if (params.passTypeIdentifier) form.append('passTypeIdentifier', params.passTypeIdentifier);
    // Allow empty string to be sent to clear/set empty password
    if (params.signerKeyPassphrase !== undefined) form.append('signerKeyPassphrase', params.signerKeyPassphrase);

    if (params.wwdr) form.append('wwdr', params.wwdr);
    if (params.signerP12) form.append('signerP12', params.signerP12);

    const res = await fetch(`${API_URL}/admin/apple/certs`, {
      method: 'POST',
      headers: buildHeaders(params.adminKey),
      body: form,
    });

    if (!res.ok) {
      let errorMessage = 'Upload failed';
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        // If not JSON, try text
        const text = await res.text();
        if (text) errorMessage = text;
      }
      throw new Error(errorMessage);
    }

    return res.json();
  },

  freezeUser: async (adminKey: string, userId: string): Promise<void> => {
    const res = await fetch(`${API_URL}/admin/users/${userId}/freeze`, {
      method: 'POST',
      headers: buildHeaders(adminKey),
    });

    if (res.status === 401) {
      throw new Error('Invalid Admin Key. Please check your key.');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to freeze user');
    }
  },

  unfreezeUser: async (adminKey: string, userId: string): Promise<void> => {
    const res = await fetch(`${API_URL}/admin/users/${userId}/unfreeze`, {
      method: 'POST',
      headers: buildHeaders(adminKey),
    });

    if (res.status === 401) {
      throw new Error('Invalid Admin Key. Please check your key.');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to unfreeze user');
    }
  },
};
