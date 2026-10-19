import type { ProviderConfiguration, QuoteInput } from './quote.schemas.js';

type QueueConfiguration = Pick<
  ProviderConfiguration,
  'code' | 'executionMode' | 'usedInternationally'
>;

export function canQueueProvider(
  input: QuoteInput,
  configuration: QueueConfiguration,
): boolean {
  const selected = input.providers.find(
    (provider) => provider.code === configuration.code,
  );
  if (!selected) return false;

  const international = input.destination.country !== 'US';
  if (
    international &&
    (!configuration.usedInternationally ||
      configuration.executionMode !== 'browser' ||
      input.international?.totalValue.currency !== 'USD')
  )
    return false;

  const requestedOptions =
    selected.options.signature !== 'none' ||
    selected.options.insurance !== null;
  const insuranceSupported =
    selected.options.insurance === null ||
    selected.options.insurance.currency === 'USD';

  return (
    !requestedOptions ||
    (configuration.code === 'unishippers' &&
      configuration.executionMode === 'browser' &&
      insuranceSupported)
  );
}
