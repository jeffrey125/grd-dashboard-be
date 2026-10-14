import Bottleneck from 'bottleneck';
import { setTimeout } from 'node:timers/promises';

/** Worker-lifetime pacing survives sessions and manual refreshes. */
export class CarrierRequestLimiter {
  private readonly queue = new Bottleneck({ maxConcurrent: 1 });
  private lastSent = 0;
  private rpm: number | null = null;

  run<T>(
    rpm: number | null,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.queue.schedule(async () => {
      signal.throwIfAborted();

      const spacing = rpm === null ? 0 : Math.ceil(60_000 / rpm);
      const wait =
        this.lastSent + (rpm !== this.rpm ? 60_000 : spacing) - Date.now();

      if (wait > 0) await setTimeout(wait, undefined, { signal });

      signal.throwIfAborted();
      this.rpm = rpm;
      this.lastSent = Date.now();

      return work();
    });
  }

  async close() {
    await this.queue.stop({ dropWaitingJobs: true });
  }
}
