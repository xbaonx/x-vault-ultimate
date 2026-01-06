import jwt from 'jsonwebtoken';
import { config } from '../config';

export type DeviceJwtPayload = {
  sub: string; // userId
  deviceId: string;
};

const DEFAULT_EXPIRES_IN = '30d';

export function signDeviceJwt(payload: DeviceJwtPayload): string {
  const secret = String(config.security.jwtSecret || '').trim();
  if (!secret) {
    if (config.nodeEnv === 'production') {
      throw new Error('JWT_SECRET missing');
    }
    return '';
  }

  return jwt.sign(payload, secret, {
    expiresIn: DEFAULT_EXPIRES_IN,
  });
}

export function verifyDeviceJwt(token: string): DeviceJwtPayload {
  const secret = String(config.security.jwtSecret || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET missing');
  }

  const decoded = jwt.verify(token, secret);
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Invalid token');
  }

  const sub = (decoded as any).sub;
  const deviceId = (decoded as any).deviceId;
  if (!sub || !deviceId) {
    throw new Error('Invalid token payload');
  }

  return { sub: String(sub), deviceId: String(deviceId) };
}
