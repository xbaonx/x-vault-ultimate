import { DelayedTxExecutorService } from './delayed-tx-executor.service';
import { DepositWatcherService } from './deposit-watcher.service';
import { config } from '../config';

export class JobRunnerService {
  private static started = false;

  static start() {
    if (this.started) return;
    this.started = true;

    const delayedIntervalMs = 30_000;

    const depositEnabled = String(process.env.DEPOSIT_WATCHER_ENABLED ?? 'true').toLowerCase() !== 'false';
    const depositIntervalOverride = Number(process.env.DEPOSIT_WATCHER_INTERVAL_MS || '');
    const webhookConfigured = String(config.alchemy.webhookSigningKey || '').trim().length > 0;
    const defaultDepositIntervalMs = webhookConfigured ? 15 * 60_000 : 30_000;
    const depositIntervalMs = Number.isFinite(depositIntervalOverride) && depositIntervalOverride > 0
      ? depositIntervalOverride
      : defaultDepositIntervalMs;

    const runDelayed = async () => {
      try {
        await DelayedTxExecutorService.runOnce();
      } catch (e) {
        console.warn('[JobRunner] delayed executor error:', e);
      }
    };

    const runDeposit = async () => {
      if (!depositEnabled) return;
      try {
        await DepositWatcherService.runOnce();
      } catch (e) {
        console.warn('[JobRunner] deposit watcher error:', e);
      }
    };

    void runDelayed();
    void runDeposit();

    setInterval(() => {
      void runDelayed();
    }, delayedIntervalMs);

    if (depositEnabled) {
      setInterval(() => {
        void runDeposit();
      }, depositIntervalMs);
    }
  }
}
