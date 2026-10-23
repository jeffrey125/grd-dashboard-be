import { providerWeightPolicy } from './provider-weight-policy.js';
import { canQueueProvider } from './quote-provider-eligibility.js';
import {
  providerAddressMeetsInputRequirements,
  providerPhysicalPackageCountSupported,
} from './provider-input-requirements.js';
import {
  addressSchema,
  createQuoteSchema,
  packageDimensionsSupportedForProvider,
  type ProviderConfiguration,
  type QuoteInput,
  type SenderSnapshot,
} from './quote.schemas.js';

export type RetryConfiguration = Pick<
  ProviderConfiguration,
  | 'code'
  | 'enabled'
  | 'executionMode'
  | 'usedInternationally'
  | 'maxPackageWeightLb'
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
  if (
    providerWeightPolicy(input, provider).exceededPackageGroupPositions.length
  )
    return 'weight_limit_exceeded';
  if (!canQueueProvider(input, provider)) return 'input_invalid';
  if (!packageDimensionsSupportedForProvider(input, provider.code))
    return 'input_invalid';
  if (
    !providerAddressMeetsInputRequirements(
      sender.address,
      provider.code,
      'sender',
    ) ||
    !providerAddressMeetsInputRequirements(
      input.destination,
      provider.code,
      'destination',
    ) ||
    !providerPhysicalPackageCountSupported(
      input.packageGroups.map((group) => group.quantity),
      provider.code,
    )
  )
    return 'input_invalid';

  return null;
}
