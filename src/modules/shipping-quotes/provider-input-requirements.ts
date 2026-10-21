import type { ProviderCode } from './quote.schemas.js';

type AddressRequirements = {
  requiredFields: Array<'contactName' | 'phone' | 'division'>;
  maxNameLength: number;
  maxStreetLength: number;
  maxContactNameLength: number;
};

type ProviderAddress = {
  name: string;
  street: string;
  street2?: string;
  contactName?: string;
  phone?: string;
  division: string;
};

// Keep discovery and submission validation on the same provider requirements.
export function providerInputRequirements(code: ProviderCode): {
  sender: AddressRequirements;
  destination: AddressRequirements;
} {
  return {
    sender: {
      requiredFields: [],
      maxNameLength: code === 'unishippers' ? 35 : 50,
      maxStreetLength: code === 'amazon' ? 60 : 200,
      maxContactNameLength: code === 'amazon' ? 50 : 100,
    },
    destination: {
      requiredFields: [],
      maxNameLength: code === 'amazon' ? 50 : 200,
      maxStreetLength: code === 'amazon' ? 60 : 200,
      maxContactNameLength: code === 'amazon' ? 50 : 100,
    },
  };
}

export function providerAddressMeetsInputRequirements(
  address: ProviderAddress,
  code: ProviderCode,
  target: 'sender' | 'destination',
): boolean {
  const requirements = providerInputRequirements(code)[target];

  return (
    address.name.length <= requirements.maxNameLength &&
    address.street.length <= requirements.maxStreetLength &&
    (address.street2?.length ?? 0) <= requirements.maxStreetLength &&
    (address.contactName?.length ?? 0) <= requirements.maxContactNameLength &&
    requirements.requiredFields.every((field) => address[field]?.trim())
  );
}

export function providerPhysicalPackageCountSupported(
  quantities: number[],
  code: ProviderCode,
): boolean {
  return (
    code !== 'amazon' ||
    quantities.reduce((sum, value) => sum + value, 0) <= 100
  );
}
