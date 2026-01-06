import { AppDataSource } from '../data-source';
import { Transaction } from '../entities/Transaction';
import { config } from '../config';

function getExplorerTxUrl(chainId: number, txHash: string): string {
  const hash = String(txHash || '').trim();
  if (!hash) return '';

  switch (Number(chainId)) {
    case 8453:
      return `https://basescan.org/tx/${hash}`;
    case 137:
      return `https://polygonscan.com/tx/${hash}`;
    case 42161:
      return `https://arbiscan.io/tx/${hash}`;
    case 10:
      return `https://optimistic.etherscan.io/tx/${hash}`;
    case 1:
      return `https://etherscan.io/tx/${hash}`;
    default:
      return '';
  }
}

async function fetchUserOpReceipt(bundlerUrl: string, userOpHash: string): Promise<any | null> {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getUserOperationReceipt',
    params: [userOpHash],
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 4000);
  const resp = await fetch(bundlerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).finally(() => clearTimeout(id));

  const json = await resp.json();
  if (json?.error) {
    throw new Error(json.error?.message || 'Bundler receipt error');
  }

  return json?.result || null;
}

export class AaReceiptPollerService {
  static async runOnce(): Promise<void> {
    if (!AppDataSource.isInitialized) return;

    const txRepo = AppDataSource.getRepository(Transaction);

    const pending = await txRepo.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
      take: 50,
    });

    if (!pending.length) return;

    for (const tx of pending) {
      try {
        if (tx.txHash) continue;

        const txData = tx.txData || {};
        if (txData.type !== 'aa') continue;

        const chainId = Number(txData.chainId || config.blockchain.chainId);
        const bundlerUrl = config.blockchain.aa.bundlerUrl(chainId);
        if (!bundlerUrl) continue;

        const receipt = await fetchUserOpReceipt(bundlerUrl, tx.userOpHash);
        if (!receipt) {
          continue;
        }

        const receiptTxHash = receipt?.receipt?.transactionHash || receipt?.transactionHash || '';
        if (receiptTxHash) {
          tx.txHash = receiptTxHash;
          tx.explorerUrl = getExplorerTxUrl(chainId, receiptTxHash) || tx.explorerUrl;
        }

        const statusRaw = receipt?.receipt?.status;
        if (statusRaw === '0x0' || statusRaw === 0 || statusRaw === false) {
          tx.status = 'failed';
        } else {
          tx.status = 'success';
        }

        await txRepo.save(tx);
      } catch (e) {
        // ignore transient receipt errors
      }
    }
  }
}
