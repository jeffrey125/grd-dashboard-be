import { z } from 'zod';

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
const country = z.string().regex(/^[A-Z]{2}$/);
export const providerCode = z.enum(['amazon', 'unishippers']);
export const addressSchema = z.strictObject({
  name: text,
  street: text,
  street2: z.string().max(200).optional(),
  city: text,
  division: z.string().max(100),
  postalCode: text,
  country,
  contactName: z.string().max(100).optional(),
  phone: z
    .string()
    .max(30)
    .refine(
      (value) =>
        value === '' ||
        (/^\+?[\d ().-]+$/.test(value) &&
          /^\d{10,15}$/.test(value.replace(/\D/g, ''))),
    )
    .optional(),
});
const senderSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('explicit'),
    address: addressSchema.extend({ country: z.literal('US') }),
  }),
  z.strictObject({ mode: z.literal('account_default'), refreshId: z.uuidv4() }),
]);
const itemSchema = z.strictObject({
  description: text,
  quantity: z.number().int().positive().max(10000),
  unitValue: decimal,
  currency: z.string().regex(/^[A-Z]{3}$/),
  countryOfManufacture: country,
  weight: decimal,
  hsCode: z
    .string()
    .regex(/^(?:\d{6,10})?$/)
    .optional(),
});
export const createQuoteSchema = z
  .strictObject({
    idempotencyKey: z.uuidv4(),
    shipDate: z.iso.date(),
    destination: addressSchema,
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
                currency: z.string().regex(/^[A-Z]{3}$/),
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
    if (value.destination.country !== 'US')
      value.packageGroups.forEach((group, index) => {
        if (!group.customsItems.length)
          ctx.addIssue({
            code: 'custom',
            path: ['packageGroups', index, 'customsItems'],
            message: 'International packages require per-box customs items',
          });
      });
  });
export type QuoteInput = z.infer<typeof createQuoteSchema>;
export type Address = z.infer<typeof addressSchema>;
export type ProviderCode = z.infer<typeof providerCode>;
export type ProviderConfiguration = {
  code: ProviderCode;
  name: string;
  enabled: boolean;
  executionMode: 'request' | 'browser';
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
  executionMode: 'request' | 'browser' | null;
  startedAt: string | null;
  completedAt: string | null;
  recoveryCount: number;
  outcome: string | null;
  reasonCode: string | null;
  simulated: boolean;
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
    optionCoverage: string;
    dutyStatus: string;
    taxStatus: string;
    clearanceStatus: string;
    charges: QuoteCharge[];
    groupContributions: QuoteGroupContribution[];
  }>;
};
