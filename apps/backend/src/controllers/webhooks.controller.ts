import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { AppDataSource } from '../data-source';
import { DepositEvent } from '../entities/DepositEvent';
import { PassUpdateService } from '../services/pass-update.service';
import { AaAddressMapService } from '../services/aa-address-map.service';
import { config } from '../config';

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, 'hex');
    const bBuf = Buffer.from(b, 'hex');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function verifyAlchemySignature(params: { rawBody: string; signature: string; signingKey: string }): boolean {
  const hmac = crypto.createHmac('sha256', params.signingKey);
  hmac.update(params.rawBody, 'utf8');
  const digest = hmac.digest('hex');
  return timingSafeEqualHex(params.signature, digest);
}

function mapAlchemyNetworkToChainId(network: string): number | null {
  const n = String(network || '').toUpperCase();
  if (n === 'ETH_MAINNET') return 1;
  if (n === 'MATIC_MAINNET' || n === 'POLYGON_MAINNET') return 137;
  if (n === 'ARB_MAINNET' || n === 'ARBITRUM_MAINNET') return 42161;
  if (n === 'OPT_MAINNET' || n === 'OPTIMISM_MAINNET') return 10;
  if (n === 'BASE_MAINNET') return 8453;

  if (n.includes('ARB')) return 42161;
  if (n.includes('OPT')) return 10;
  if (n.includes('POLYGON') || n.includes('MATIC')) return 137;
  if (n.includes('BASE')) return 8453;
  if (n.includes('ETH')) return 1;

  return null;
}

export class WebhooksController {
  static async alchemy(req: Request, res: Response) {
    try {
      if (!AppDataSource.isInitialized) {
        res.status(503).json({ error: 'DB not initialized' });
        return;
      }

      const signingKeys = String(config.alchemy?.webhookSigningKey || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      if (!signingKeys.length) {
        res.status(500).json({ error: 'ALCHEMY_WEBHOOK_SIGNING_KEY not configured' });
        return;
      }

      const signature = String(req.header('X-Alchemy-Signature') || '');
      const rawBody = String((req as any).rawBody || '');

      if (!signature || !rawBody) {
        res.status(400).json({ error: 'Missing signature or raw body' });
        return;
      }

      const ok = signingKeys.some(signingKey => verifyAlchemySignature({ rawBody, signature, signingKey }));
      if (!ok) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const body = req.body as any;
      if (!body || body.type !== 'ADDRESS_ACTIVITY' || !body.event) {
        res.status(200).json({ ok: true });
        return;
      }

      const chainId = mapAlchemyNetworkToChainId(body.event.network);
      if (!chainId) {
        res.status(200).json({ ok: true });
        return;
      }

      const activity: any[] = Array.isArray(body.event.activity) ? body.event.activity : [];
      if (!activity.length) {
        res.status(200).json({ ok: true });
        return;
      }

      const depositRepo = AppDataSource.getRepository(DepositEvent);

      for (const a of activity) {
        const toAddress = String(a?.toAddress || '').toLowerCase();
        if (!toAddress.startsWith('0x')) continue;

        const serialNumber = await AaAddressMapService.findSerialNumberByAddress({ chainId, aaAddress: toAddress });
        if (!serialNumber) continue;

        const log = a?.log;
        const txHash = String(log?.transactionHash || a?.hash || '').toLowerCase();
        const logIndexHex = String(log?.logIndex || '0x0');
        const tokenAddress = String(a?.rawContract?.address || log?.address || '').toLowerCase();
        const rawValueHex = String(a?.rawContract?.rawValue || log?.data || '0x0');

        if (!txHash.startsWith('0x') || !tokenAddress.startsWith('0x')) continue;

        let logIndex = 0;
        try {
          logIndex = Number(BigInt(logIndexHex));
        } catch {
          logIndex = 0;
        }

        const id = `${chainId}:${txHash}:${logIndex}`;

        const exists = await depositRepo.findOne({ where: { id } });
        if (exists) continue;

        let amount = '0';
        try {
          amount = BigInt(rawValueHex).toString();
        } catch {
          amount = '0';
        }

        const dep = depositRepo.create({
          id,
          chainId,
          txHash,
          logIndex,
          walletAddress: toAddress,
          tokenAddress,
          amount,
        });

        await depositRepo.save(dep);
        await PassUpdateService.notifyPassUpdateBySerialNumber(serialNumber);
      }

      res.status(200).json({ ok: true });
    } catch (e) {
      console.warn('[Webhooks] alchemy error:', e);
      res.status(200).json({ ok: true });
    }
  }
}
