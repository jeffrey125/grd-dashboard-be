import type { ProviderCode } from './quote.schemas.js';

type AddressRequirements = {
  requiredFields: Array<'contactName' | 'phone' | 'division'>;
  maxNameLength: number;
};

// Keep discovery and submission validation on the same provider requirements.
export function providerInputRequirements(code: ProviderCode): {
  sender: AddressRequirements;
  destination: AddressRequirements;
} {
  return {
    sender: {
      requiredFields: [],
      maxNameLength: code === 'unishippers' ? 35 : 200,
    },
    destination: { requiredFields: [], maxNameLength: 200 },
  };
}
