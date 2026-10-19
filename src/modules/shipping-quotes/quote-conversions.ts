import { QuoteDecimal, type Decimal } from './quote-decimal.js';
import type { ProviderCode, QuoteInput } from './quote.schemas.js';

const CENTIMETERS_PER_INCH = new QuoteDecimal('2.54');
const KILOGRAMS_PER_POUND = new QuoteDecimal('0.45359237');

function round(value: Decimal): string {
  return value.toDecimalPlaces(6).toFixed(6);
}

export function toProviderLength(
  value: string,
  units: 'imperial' | 'metric',
): string {
  return round(
    units === 'metric'
      ? new QuoteDecimal(value).div(CENTIMETERS_PER_INCH)
      : new QuoteDecimal(value),
  );
}

export function toProviderWeight(
  value: string,
  units: 'imperial' | 'metric',
): string {
  return round(
    units === 'metric'
      ? new QuoteDecimal(value).div(KILOGRAMS_PER_POUND)
      : new QuoteDecimal(value),
  );
}

export function canonicalMeasurements(
  group: QuoteInput['packageGroups'][number],
) {
  const length = (value: string) =>
    value === ''
      ? undefined
      : round(
          group.units === 'imperial'
            ? new QuoteDecimal(value).times(CENTIMETERS_PER_INCH)
            : new QuoteDecimal(value),
        );
  return {
    ...(length(group.length) ? { lengthCm: length(group.length) } : {}),
    ...(length(group.width) ? { widthCm: length(group.width) } : {}),
    ...(length(group.height) ? { heightCm: length(group.height) } : {}),
    weightKg: round(
      group.units === 'imperial'
        ? new QuoteDecimal(group.weight).times(KILOGRAMS_PER_POUND)
        : new QuoteDecimal(group.weight),
    ),
  };
}

export function conversionSnapshot(input: QuoteInput, provider: ProviderCode) {
  return {
    provider,
    policy: {
      targetUnits: 'imperial',
      decimalPlaces: 6,
      rounding: 'half_up',
      centimetersPerInch: '2.54',
      kilogramsPerPound: '0.45359237',
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
