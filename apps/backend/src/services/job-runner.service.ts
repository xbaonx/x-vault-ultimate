import { DelayedTxExecutorService } from './delayed-tx-executor.service';
import { DepositWatcherService } from './deposit-watcher.service';

export class JobRunnerService {
  private static started = false;

  static start() {
    if (this.started) return;
    this.started = true;

    const run = async () => {
      try {
        await DelayedTxExecutorService.runOnce();
      } catch (e) {
        console.warn('[JobRunner] delayed executor error:', e);
      }

      try {
        await DepositWatcherService.runOnce();
      } catch (e) {
        console.warn('[JobRunner] deposit watcher error:', e);
      }
    };

    void run();

    setInterval(() => {
      void run();
    }, 30_000);
  }
}
