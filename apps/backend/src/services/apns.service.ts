import * as http2 from 'http2';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

export class ApnsService {
  private static getConfig() {
    const privateKey = process.env.APNS_PRIVATE_KEY;
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const topic = process.env.APNS_TOPIC;

    return { privateKey, keyId, teamId, topic };
  }

  static isEnabled(): boolean {
    const { privateKey, keyId, teamId, topic } = this.getConfig();
    return !!(privateKey && keyId && teamId && topic);
  }

  private static getJwt(): string {
    const { privateKey, keyId, teamId } = this.getConfig();

    if (!privateKey || !keyId || !teamId) {
      throw new Error('APNs config missing (APNS_PRIVATE_KEY/APNS_KEY_ID/APNS_TEAM_ID)');
    }

    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iss: teamId, iat: now },
      privateKey,
      { algorithm: 'ES256', header: { alg: 'ES256', kid: keyId } }
    );
  }

  static async pushPassUpdate(pushToken: string): Promise<{ ok: boolean; status?: number; body?: string }> {
    const { topic } = this.getConfig();

    if (!this.isEnabled() || !topic) {
      console.log('[APNs] Disabled (missing APNS env). Skipping push update.');
      return { ok: false, body: 'disabled' };
    }

    const client = http2.connect('https://api.push.apple.com:443');

    return new Promise((resolve) => {
      const reqId = randomUUID();
      const headers: http2.OutgoingHttpHeaders = {
        ':method': 'POST',
        ':path': `/3/device/${pushToken}`,
        'apns-topic': topic,
        'apns-push-type': 'background',
        'apns-id': reqId,
        'authorization': `bearer ${this.getJwt()}`
      };

      const req = client.request(headers);

      let respBody = '';
      let status: number | undefined;

      req.setEncoding('utf8');
      req.on('response', (headers) => {
        status = Number(headers[':status']);
      });

      req.on('data', (chunk) => {
        respBody += chunk;
      });

      req.on('end', () => {
        client.close();
        resolve({ ok: status === 200, status, body: respBody || undefined });
      });

      req.on('error', (err) => {
        client.close();
        console.warn('[APNs] Push error:', err);
        resolve({ ok: false, body: String(err) });
      });

      req.end(JSON.stringify({ aps: { 'content-available': 1 } }));
    });
  }
}
