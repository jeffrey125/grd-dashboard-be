import { bignumber, unit } from 'mathjs';
import { z } from 'zod';
import { QuoteDecimal } from './quote-decimal.js';
import type { ProviderCode, QuoteInput } from './quote.schemas.js';

export const maxPackageWeightSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0, 'Enter a positive weight in pounds');

export const publishedWeightLimits = {
  amazon: '50',
  unishippers: '150',
} as const;

export type WeightConfiguration = {
  code: ProviderCode;
  maxPackageWeightLb?: string;
};

export function providerWeightLimits(provider: WeightConfiguration) {
  const lb =
    provider.maxPackageWeightLb ?? publishedWeightLimits[provider.code];
  // Convert the limit, without rounding the entered weight at the boundary.
  const kg = unit(bignumber(lb), 'lb').toNumeric('kg').toString();
  return { maxPackageWeightLb: lb, maxPackageWeightKg: kg };
}

export function providerWeightPolicy(
  input: Pick<QuoteInput, 'packageGroups'>,
  provider: WeightConfiguration,
) {
  const limits = providerWeightLimits(provider);
  return {
    ...limits,
    exceededPackageGroupPositions: input.packageGroups.flatMap(
      (group, position) =>
        new QuoteDecimal(group.weight).gt(
          group.units === 'metric'
            ? limits.maxPackageWeightKg
            : limits.maxPackageWeightLb,
        )
          ? [position]
          : [],
    ),
  };
}
