import type {
  ProviderConfiguration,
  QuoteInput,
  SenderSnapshot,
} from './quote.schemas.js';

export function unishippersBrowserInputFailure(
  input: QuoteInput,
  sender: SenderSnapshot,
): 'sender_company_too_long' | 'contact_details_required' | null {
  if (sender.address.name.length > 35) return 'sender_company_too_long';

  const needsContact = (address: SenderSnapshot['address']) =>
    !address.contactName?.trim() || !address.phone?.trim();
  if (
    needsContact(input.destination) ||
    (sender.mode === 'explicit' && needsContact(sender.address))
  )
    return 'contact_details_required';

  return null;
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
