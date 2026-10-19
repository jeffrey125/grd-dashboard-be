import { describe, expect, it } from 'vitest';
import { delay } from './ups.async.js';

describe('native UPS delay', () => {
  it('resolves and preserves the original cancellation reason', async () => {
    await expect(
      delay(1, new AbortController().signal),
    ).resolves.toBeUndefined();
    const controller = new AbortController();
    const reason = new Error('session closed');
    const waiting = delay(60_000, controller.signal);
    const rejected = expect(waiting).rejects.toBe(reason);

    controller.abort(reason);

    await rejected;
    await expect(delay(1, controller.signal)).rejects.toBe(reason);
  });
});
