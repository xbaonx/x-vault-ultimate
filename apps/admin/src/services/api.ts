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

function buildHeaders(adminKey?: string) {
  const headers: Record<string, string> = {};
  if (adminKey) headers['x-admin-key'] = adminKey;
  return headers;
}

export const adminApi = {
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
