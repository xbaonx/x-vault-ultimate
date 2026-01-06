import crypto from 'crypto';
import { config } from '../config';

export function computeApplePassAuthToken(serialNumber: string): string {
  const secret = String(config.security.applePassAuthSecret || '').trim();
  if (!secret) {
    if (config.nodeEnv === 'production') {
      throw new Error('APPLE_PASS_AUTH_SECRET missing');
    }
    return '3325692850392023594';
  }

  return crypto
    .createHmac('sha256', secret)
    .update(String(serialNumber || '').toLowerCase())
    .digest('hex');
}
