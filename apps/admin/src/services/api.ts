const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api';

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

    if (!res.ok) {
      throw new Error('Failed to fetch dashboard stats');
    }
    return res.json();
  },

  getUsers: async (adminKey: string): Promise<UserData[]> => {
    const res = await fetch(`${API_URL}/admin/users`, {
      headers: buildHeaders(adminKey),
    });

    if (!res.ok) {
      throw new Error('Failed to fetch users');
    }
    return res.json();
  },

  getTransactions: async (adminKey: string): Promise<TransactionData[]> => {
    const res = await fetch(`${API_URL}/admin/transactions`, {
      headers: buildHeaders(adminKey),
    });

    if (!res.ok) {
      throw new Error('Failed to fetch transactions');
    }
    return res.json();
  },

  getAppleConfig: async (adminKey: string): Promise<AppleConfigStatus> => {
    const res = await fetch(`${API_URL}/admin/apple/config`, {
      headers: buildHeaders(adminKey),
    });

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
