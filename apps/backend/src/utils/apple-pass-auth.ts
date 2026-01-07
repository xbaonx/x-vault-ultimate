import crypto from 'crypto';
import { config } from '../config';

function getApplePassAuthSecrets(): string[] {
  const primary = String(config.security.applePassAuthSecret || '').trim();

  // Allow secret rotation without breaking installed passes.
  // Format: comma-separated secrets, newest first or oldest first - either is fine.
  const extraRaw = String(
    process.env.APPLE_PASS_AUTH_SECRETS || process.env.APPLE_PASS_AUTH_SECRET_PREVIOUS || ''
  ).trim();

  const extras = extraRaw
    ? extraRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return [primary, ...extras].filter(Boolean);
}

function computeApplePassAuthTokenWithSecret(serialNumber: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(String(serialNumber || '').toLowerCase())
    .digest('hex');
}

export function computeApplePassAuthToken(serialNumber: string): string {
  const secrets = getApplePassAuthSecrets();
  const secret = secrets[0] || '';
  if (!secret) {
    if (config.nodeEnv === 'production') {
      throw new Error('APPLE_PASS_AUTH_SECRET missing');
    }
    return '3325692850392023594';
  }

  return computeApplePassAuthTokenWithSecret(serialNumber, secret);
}

export function verifyApplePassAuthToken(params: {
  serialNumber: string;
  receivedToken: string;
}): boolean {
  const received = String(params.receivedToken || '').trim();
  if (!received) return false;

  const secrets = getApplePassAuthSecrets();
  if (!secrets.length) {
    // In dev mode without secret, accept the legacy constant token only.
    return config.nodeEnv !== 'production' && received === '3325692850392023594';
  }

  for (const secret of secrets) {
    const expected = computeApplePassAuthTokenWithSecret(params.serialNumber, secret);
    try {
      const a = Buffer.from(received, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {
      // ignore and continue
    }
  }
  return false;
}
