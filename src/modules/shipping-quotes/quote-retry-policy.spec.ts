import { describe, expect, it } from 'vitest';
import {
  retryInputBlock,
  type RetryConfiguration,
} from './quote-retry-policy.js';
import type { QuoteInput, SenderSnapshot } from './quote.schemas.js';

const address = {
  name: 'Global Resources Direct',
  street: '123 Example Street',
  city: 'Seattle',
  division: 'WA',
  postalCode: '98101',
  country: 'US' as const,
  contactName: 'Shipping Contact',
  phone: '2065550123',
};

const provider: RetryConfiguration = {
  code: 'amazon',
  enabled: true,
  executionMode: 'api',
  usedInternationally: false,
};

function fixture(): { input: QuoteInput; sender: SenderSnapshot } {
  return {
    input: {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      shipDate: '2099-10-22',
      destination: { ...address, division: 'NY', postalCode: '10001' },
      providers: [
        {
          code: 'amazon',
          sender: { mode: 'explicit', address },
          options: { signature: 'none', insurance: null },
        },
      ],
      packageGroups: [
        {
          quantity: 100,
          units: 'imperial',
          length: '10',
          width: '8',
          height: '6',
          weight: '5',
          customsItems: [],
        },
      ],
    },
    sender: {
      code: 'amazon',
      mode: 'explicit',
      retrievedAt: null,
      address: { ...address },
    },
  };
}

describe('quote retry policy', () => {
  it('accepts the current Amazon API package boundary', () => {
    const { input, sender } = fixture();

    expect(retryInputBlock(input, sender, provider)).toBeNull();
  });

  it('blocks historical Amazon attempts above the current package limit', () => {
    const { input, sender } = fixture();
    input.packageGroups[0]!.quantity = 101;

    expect(retryInputBlock(input, sender, provider)).toBe('input_invalid');
  });

  it('blocks historical Amazon attempts above the current address limits', () => {
    const { input, sender } = fixture();
    sender.address.contactName = 'C'.repeat(51);

    expect(retryInputBlock(input, sender, provider)).toBe('input_invalid');
  });
});
