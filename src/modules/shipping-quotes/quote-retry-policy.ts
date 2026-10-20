import {
  canQueueProvider,
  unishippersBrowserInputFailure,
} from './quote-provider-eligibility.js';
import {
  addressSchema,
  createQuoteSchema,
  type ProviderConfiguration,
  type QuoteInput,
  type SenderSnapshot,
} from './quote.schemas.js';

export type RetryConfiguration = Pick<
  ProviderConfiguration,
  'code' | 'enabled' | 'executionMode' | 'usedInternationally'
>;

export function retryInputBlock(
  input: QuoteInput,
  sender: SenderSnapshot,
  provider: RetryConfiguration,
  now = new Date(),
): string | null {
  if (!provider.enabled) return 'provider_disabled';

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (input.shipDate < today) return 'ship_date_passed';
  if (
    !createQuoteSchema.safeParse(input).success ||
    !addressSchema.safeParse(sender.address).success
  )
    return 'input_invalid';
  if (!canQueueProvider(input, provider)) return 'input_invalid';
  if (
    input.packageGroups.some((group) => group.length === '') &&
    (provider.code !== 'unishippers' || provider.executionMode !== 'request')
  )
    return 'input_invalid';
  if (
    provider.code === 'unishippers' &&
    provider.executionMode === 'browser' &&
    unishippersBrowserInputFailure(input, sender)
  )
    return 'input_invalid';

  return null;
}
