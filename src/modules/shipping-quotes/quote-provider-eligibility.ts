import type { ProviderConfiguration, QuoteInput } from './quote.schemas.js';

const businessDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function unishippersQuickQuoteDateSupported(
  input: QuoteInput,
  now = new Date(),
): boolean {
  return input.shipDate === businessDate.format(now);
}

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
  return (
    !international &&
    !requestedOptions &&
    (configuration.code !== 'unishippers' ||
      unishippersQuickQuoteDateSupported(input))
  );
}
