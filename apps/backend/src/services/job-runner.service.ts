import { AaReceiptPollerService } from './aa-receipt-poller.service';

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

    void run();

    setInterval(() => {
      void run();
    }, 30_000);
  }
}
