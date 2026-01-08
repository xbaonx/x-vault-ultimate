import { AaReceiptPollerService } from './aa-receipt-poller.service';
import { PriceRefreshService } from './price-refresh.service';

export class JobRunnerService {
  private static started = false;

  static start() {
    if (this.started) return;
    this.started = true;

    const run = async () => {
      try {
        await AaReceiptPollerService.runOnce();
      } catch (e) {
        console.warn('[JobRunner] aa receipt poller error:', e);
      }
    };

    const runPrices = async () => {
      try {
        await PriceRefreshService.runOnce();
      } catch (e) {
        console.warn('[JobRunner] price refresh error:', e);
      }
    };

    void run();

    void runPrices();

    setInterval(() => {
      void run();
    }, 30_000);

    setInterval(() => {
      void runPrices();
    }, 60 * 60 * 1000);
  }
}
