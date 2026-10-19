import { bignumber, unit } from 'mathjs';
import { QuoteDecimal, type Decimal } from './quote-decimal.js';
import type { ProviderCode, QuoteInput } from './quote.schemas.js';

function round(value: Decimal): string {
  return value.toDecimalPlaces(6).toFixed(6);
}

function convert(value: string, source: string, target: string): string {
  const converted = unit(bignumber(value), source).toNumeric(target);

  return round(new QuoteDecimal(converted.toString()));
}

export function toProviderLength(
  value: string,
  units: 'imperial' | 'metric',
): string {
  return units === 'metric'
    ? convert(value, 'cm', 'in')
    : round(new QuoteDecimal(value));
}

export function toProviderWeight(
  value: string,
  units: 'imperial' | 'metric',
): string {
  return units === 'metric'
    ? convert(value, 'kg', 'lb')
    : round(new QuoteDecimal(value));
}

export function canonicalMeasurements(
  group: QuoteInput['packageGroups'][number],
) {
  const length = (value: string) =>
    value === ''
      ? undefined
      : group.units === 'imperial'
        ? convert(value, 'in', 'cm')
        : round(new QuoteDecimal(value));
  return {
    ...(length(group.length) ? { lengthCm: length(group.length) } : {}),
    ...(length(group.width) ? { widthCm: length(group.width) } : {}),
    ...(length(group.height) ? { heightCm: length(group.height) } : {}),
    weightKg:
      group.units === 'imperial'
        ? convert(group.weight, 'lb', 'kg')
        : round(new QuoteDecimal(group.weight)),
  };
}

export function conversionSnapshot(input: QuoteInput, provider: ProviderCode) {
  return {
    provider,
    policy: {
      targetUnits: 'imperial',
      decimalPlaces: 6,
      rounding: 'half_up',
      converter: 'mathjs',
      measurementType: 'BigNumber',
    },
    packageGroups: input.packageGroups.map((group, position) => ({
      position,
      quantity: group.quantity,
      original: {
        units: group.units,
        length: group.length,
        width: group.width,
        height: group.height,
        weight: group.weight,
      },
      provider: {
        units: 'imperial',
        length:
          group.length === ''
            ? null
            : toProviderLength(group.length, group.units),
        width:
          group.width === ''
            ? null
            : toProviderLength(group.width, group.units),
        height:
          group.height === ''
            ? null
            : toProviderLength(group.height, group.units),
        weight: toProviderWeight(group.weight, group.units),
      },
    })),
  };
}
