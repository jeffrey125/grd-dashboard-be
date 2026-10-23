import { z } from 'zod';
import {
  providerInputRequirements,
  providerPhysicalPackageCountSupported,
} from './provider-input-requirements.js';
import { QuoteDecimal } from './quote-decimal.js';
import {
  countryCodeSchema,
  currencyCodeSchema,
  isPossibleAddressPhone,
} from './quote-standards.js';
import type { ExecutionMode } from './provider-execution-mode.js';

const text = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0);
const decimal = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0);
const dimension = z.union([z.literal(''), decimal]);
export const providerCode = z.enum(['amazon', 'unishippers']);

type DimensionInput = {
  length: string;
  width: string;
  height: string;
};

type ProviderSelection = {
  providers: Array<{ code: z.infer<typeof providerCode> }>;
  packageGroups: DimensionInput[];
};

export function hasCompletePackageDimensions(group: DimensionInput): boolean {
  return [group.length, group.width, group.height].every(
    (dimension) => dimension !== '',
  );
}

export function packageDimensionsSupportedForProvider(
  input: ProviderSelection,
  code: z.infer<typeof providerCode>,
): boolean {
  if (input.packageGroups.every(hasCompletePackageDimensions)) return true;

  return (
    code === 'unishippers' &&
    input.providers.length === 1 &&
    input.providers[0]?.code === 'unishippers'
  );
}

export const addressSchema = z
  .strictObject({
    name: text,
    street: text,
    street2: z.string().max(200).optional(),
    city: text,
    division: z.string().max(100),
    postalCode: text,
    country: countryCodeSchema,
    contactName: z.string().max(100).optional(),
    phone: z.string().max(30).optional(),
  })
  .superRefine((address, ctx) => {
    if (
      address.phone !== undefined &&
      !isPossibleAddressPhone(address.phone, address.country)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Enter a possible phone number for the address country',
      });
  });
const senderSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('explicit'),
    address: addressSchema.safeExtend({ country: z.literal('US') }),
  }),
  z.strictObject({ mode: z.literal('account_default'), refreshId: z.uuidv4() }),
]);
const itemSchema = z.strictObject({
  description: text,
  quantity: z.number().int().positive().max(10000),
  unitValue: decimal,
  currency: currencyCodeSchema,
  countryOfManufacture: countryCodeSchema,
  weight: decimal,
  hsCode: z
    .string()
    .regex(/^(?:\d{6,10})?$/)
    .optional(),
});
const internationalSchema = z.strictObject({
  contentsDescription: text,
  customsMode: z.enum(['summary', 'detailed']),
  totalValue: z.strictObject({
    amount: decimal,
    currency: currencyCodeSchema,
  }),
});
export const createQuoteSchema = z
  .strictObject({
    idempotencyKey: z.uuidv4(),
    shipDate: z.iso.date(),
    destination: addressSchema,
    international: internationalSchema.optional(),
    providers: z
      .array(
        z.strictObject({
          code: providerCode,
          sender: senderSchema,
          options: z.strictObject({
            signature: z.enum(['none', 'signature', 'adult_signature']),
            insurance: z
              .strictObject({
                amount: decimal,
                currency: currencyCodeSchema,
              })
              .nullable(),
          }),
        }),
      )
      .min(1)
      .max(2),
    packageGroups: z
      .array(
        z.strictObject({
          quantity: z.number().int().positive().max(10000),
          units: z.enum(['imperial', 'metric']),
          length: dimension,
          width: dimension,
          height: dimension,
          weight: decimal,
          customsItems: z.array(itemSchema).max(100),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.providers.map((p) => p.code)).size !==
      value.providers.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'Select each provider once',
      });
    value.packageGroups.forEach((group, index) => {
      const dimensions = [group.length, group.width, group.height];
      const populated = dimensions.filter((dimension) => dimension !== '');
      if (populated.length !== 0 && populated.length !== dimensions.length)
        ctx.addIssue({
          code: 'custom',
          path: ['packageGroups', index],
          message: 'Enter all dimensions or leave all three blank',
        });
    });
    const isInternational = value.destination.country !== 'US';
    if (isInternational && !value.international)
      ctx.addIssue({
        code: 'custom',
        path: ['international'],
        message: 'International shipments require customs details',
      });
    if (!isInternational && value.international)
      ctx.addIssue({
        code: 'custom',
        path: ['international'],
        message: 'Customs details are only valid for international shipments',
      });

    if (!isInternational || !value.international) return;
    const international = value.international;
    const detailed = international.customsMode === 'detailed';
    let total = new QuoteDecimal(0);
    value.packageGroups.forEach((group, groupIndex) => {
      if (detailed && !group.customsItems.length)
        ctx.addIssue({
          code: 'custom',
          path: ['packageGroups', groupIndex, 'customsItems'],
          message:
            'Detailed customs require per-box items for every package group',
        });
      if (!detailed && group.customsItems.length)
        ctx.addIssue({
          code: 'custom',
          path: ['packageGroups', groupIndex, 'customsItems'],
          message: 'Summary customs cannot include detailed items',
        });
      for (const [itemIndex, item] of group.customsItems.entries()) {
        if (item.currency !== international.totalValue.currency)
          ctx.addIssue({
            code: 'custom',
            path: [
              'packageGroups',
              groupIndex,
              'customsItems',
              itemIndex,
              'currency',
            ],
            message: 'All customs values must use the shipment currency',
          });
        total = total.add(
          new QuoteDecimal(item.unitValue)
            .times(item.quantity)
            .times(group.quantity),
        );
      }
    });
    if (detailed && !total.equals(international.totalValue.amount))
      ctx.addIssue({
        code: 'custom',
        path: ['international', 'totalValue', 'amount'],
        message:
          'Total customs value must equal item quantity × unit value × box quantity',
      });
  });

export const submitQuoteSchema = createQuoteSchema.superRefine((value, ctx) => {
  if (value.destination.country !== 'US')
    ctx.addIssue({
      code: 'custom',
      path: ['destination', 'country'],
      message: 'V1 supports US destinations only',
    });
  if (
    value.international ||
    value.packageGroups.some((group) => group.customsItems.length)
  )
    ctx.addIssue({
      code: 'custom',
      path: ['international'],
      message: 'Customs details are unavailable in US-only v1',
    });

  const firstSender = value.providers[0]?.sender;
  value.providers.forEach((provider, index) => {
    if (provider.sender.mode === 'account_default')
      ctx.addIssue({
        code: 'custom',
        path: ['providers', index, 'sender'],
        message: 'Enter an explicit sender for every provider',
      });
    if (provider.sender.mode === 'explicit') {
      if (
        firstSender?.mode === 'explicit' &&
        Object.keys(addressSchema.shape).some((key) => {
          const field = key as keyof Address;
          return (
            (provider.sender.mode === 'explicit'
              ? (provider.sender.address[field] ?? '')
              : '') !== (firstSender.address[field] ?? '')
          );
        })
      )
        ctx.addIssue({
          code: 'custom',
          path: ['providers', index, 'sender'],
          message: 'All providers must use the same sender address',
        });

      const requirements = providerInputRequirements(provider.code);
      for (const target of ['sender', 'destination'] as const) {
        const address =
          target === 'sender' ? provider.sender.address : value.destination;
        const path =
          target === 'sender'
            ? ['providers', index, 'sender', 'address']
            : ['destination'];
        if (address.name.length > requirements[target].maxNameLength)
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'name'],
            message: `${provider.code} requires ${requirements[target].maxNameLength} characters or fewer`,
          });
        for (const field of ['street', 'street2'] as const)
          if (
            (address[field]?.length ?? 0) > requirements[target].maxStreetLength
          )
            ctx.addIssue({
              code: 'custom',
              path: [...path, field],
              message: `${provider.code} requires ${requirements[target].maxStreetLength} characters or fewer`,
            });
        if (
          (address.contactName?.length ?? 0) >
          requirements[target].maxContactNameLength
        )
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'contactName'],
            message: `${provider.code} requires ${requirements[target].maxContactNameLength} characters or fewer`,
          });
        for (const field of requirements[target].requiredFields)
          if (!address[field]?.trim())
            ctx.addIssue({
              code: 'custom',
              path: [...path, field],
              message: `Required by ${provider.code}`,
            });
      }
    }
  });
  value.packageGroups.forEach((group, index) => {
    if (
      !hasCompletePackageDimensions(group) &&
      !packageDimensionsSupportedForProvider(value, 'unishippers')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['packageGroups', index],
        message:
          'Dimensions may be blank only for a myUnishippers-only comparison',
      });
  });
  if (
    value.providers.some((provider) => provider.code === 'amazon') &&
    !providerPhysicalPackageCountSupported(
      value.packageGroups.map((group) => group.quantity),
      'amazon',
    )
  )
    ctx.addIssue({
      code: 'custom',
      path: ['packageGroups'],
      message: 'Amazon supports at most 100 physical packages per comparison',
    });
});
export type QuoteInput = z.infer<typeof createQuoteSchema>;
export type Address = z.infer<typeof addressSchema>;
export type ProviderCode = z.infer<typeof providerCode>;
export type ProviderConfiguration = {
  maxPackageWeightLb?: string;
  code: ProviderCode;
  name: string;
  enabled: boolean;
  executionMode: ExecutionMode;
  usedInternationally: boolean;
  internationalAvailable: boolean;
  supportsSignature: boolean;
  supportsInsurance: boolean;
};
export type SenderSnapshot = {
  code: ProviderCode;
  address: Address;
  retrievedAt: string | null;
  mode: 'explicit' | 'account_default';
};

export const quoteChargeSchema = z.object({
  description: z.string().min(1),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  scope: z.enum(['package', 'shipment', 'pickup']),
  packageGroupPosition: z.number().int().min(0).nullable(),
});
export type QuoteCharge = z.infer<typeof quoteChargeSchema>;

export const quoteGroupContributionSchema = z.object({
  packageGroupPosition: z.number().int().min(0),
  quantity: z.number().int().positive(),
  subtotal: z.string().regex(/^\d+(?:\.\d+)?$/),
});
export type QuoteGroupContribution = z.infer<
  typeof quoteGroupContributionSchema
>;
export type Comparison = {
  externalId: string;
  status: 'saved' | 'queued' | 'running' | 'completed' | 'failed';
  ratesRun: boolean;
  createdAt: string;
  createdBy: string;
  deletedAt: string | null;
  restoredAt: string | null;
  lastDeletedAt: string | null;
  input: QuoteInput;
  senders: SenderSnapshot[];
  warnings: string[];
  attempts: QuoteAttempt[];
};

export type QuoteAttempt = {
  externalId: string;
  provider: ProviderCode;
  status: Comparison['status'];
  attemptNumber: number;
  createdAt: string;
  sender: SenderSnapshot;
  retryBlockedReason: string | null;
  executionMode: ExecutionMode | null;
  startedAt: string | null;
  completedAt: string | null;
  recoveryCount: number;
  outcome: string | null;
  reasonCode: string | null;
  simulated: boolean;
  weightPolicy?: Record<string, unknown> | null;
  conversionSnapshot: Record<string, unknown>;
  quotes: Array<{
    platform: string;
    carrier: string;
    service: string;
    transportationTotal: string;
    currency: string;
    estimateMethod: 'native' | 'calculated';
    transitDescription: string | null;
    retrievedAt: string;
    expiresAt: string | null;
    staleAt: string | null;
    optionCoverage: string;
    dutyStatus: string;
    taxStatus: string;
    clearanceStatus: string;
    charges: QuoteCharge[];
    groupContributions: QuoteGroupContribution[];
  }>;
};
