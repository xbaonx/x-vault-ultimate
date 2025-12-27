const ENV_API_URL = import.meta.env.VITE_API_URL;
const FALLBACK_URL = 'http://localhost:3000';
const API_URL = (ENV_API_URL || FALLBACK_URL) + '/api';

console.log('[AdminAPI] Initialization:', {
  envViteApiUrl: ENV_API_URL,
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
    signerCert?: File | null;
    signerKey?: File | null;
  }) => {
    const form = new FormData();
    if (params.teamId) form.append('teamId', params.teamId);
    if (params.passTypeIdentifier) form.append('passTypeIdentifier', params.passTypeIdentifier);
    if (params.signerKeyPassphrase) form.append('signerKeyPassphrase', params.signerKeyPassphrase);

    if (params.wwdr) form.append('wwdr', params.wwdr);
    if (params.signerCert) form.append('signerCert', params.signerCert);
    if (params.signerKey) form.append('signerKey', params.signerKey);

    const res = await fetch(`${API_URL}/admin/apple/certs`, {
      method: 'POST',
      headers: buildHeaders(params.adminKey),
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Upload failed');
    }

    return res.json();
  },
};
