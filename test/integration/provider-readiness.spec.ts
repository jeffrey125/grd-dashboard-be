import { describe, expect, it, vi } from 'vitest';
import {
  AmazonShippingAdapter,
  type AmazonApiSession,
} from '@modules/shipping-quotes/amazon-quote.adapter.js';

describe('Amazon readiness boundary', () => {
  it('verifies sandbox credentials without requesting a rate', async () => {
    const authenticate = vi.fn(async () => undefined);
    const session: AmazonApiSession = {
      authenticate,
      getRates: vi.fn(),
    };
    const adapter = new AmazonShippingAdapter({
      session,
    });

    await adapter.readiness('api');

    expect(authenticate).toHaveBeenCalledOnce();
    expect(session.getRates).not.toHaveBeenCalled();
  });
});
