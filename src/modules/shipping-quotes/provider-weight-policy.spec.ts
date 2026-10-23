import { describe, expect, it } from 'vitest';
import {
  maxPackageWeightSchema,
  providerWeightPolicy,
} from './provider-weight-policy.js';
import type { QuoteInput } from './quote.schemas.js';

const input = (
  weight: string,
  units: 'imperial' | 'metric' = 'imperial',
  quantity = 1,
): Pick<QuoteInput, 'packageGroups'> => ({
  packageGroups: [
    {
      weight,
      units,
      quantity,
      length: '10',
      width: '10',
      height: '10',
      customsItems: [],
    },
  ],
});

describe('Provider per-box weight policy', () => {
  it.each([
    ['amazon', '50', false],
    ['amazon', '50.000001', true],
    ['unishippers', '150', false],
    ['unishippers', '150.000001', true],
  ] as const)('checks inclusive %s boundary %s', (code, weight, exceeded) => {
    expect(
      providerWeightPolicy(input(weight), { code })
        .exceededPackageGroupPositions,
    ).toEqual(exceeded ? [0] : []);
  });
  it('does not multiply the weight by quantity', () => {
    expect(
      providerWeightPolicy(input('40', 'imperial', 100), { code: 'amazon' })
        .exceededPackageGroupPositions,
    ).toEqual([]);
  });
  it('compares kg against an unrounded converted limit', () => {
    expect(
      providerWeightPolicy(input('22.679618', 'metric'), { code: 'amazon' })
        .exceededPackageGroupPositions,
    ).toEqual([]);
    expect(
      providerWeightPolicy(input('22.679619', 'metric'), { code: 'amazon' })
        .exceededPackageGroupPositions,
    ).toEqual([0]);
  });
  it('supports admin increases and decreases and identifies every overweight group', () => {
    const boxes = {
      packageGroups: [
        ...input('60').packageGroups,
        ...input('90').packageGroups,
      ],
    };
    expect(
      providerWeightPolicy(boxes, { code: 'amazon', maxPackageWeightLb: '100' })
        .exceededPackageGroupPositions,
    ).toEqual([]);
    expect(
      providerWeightPolicy(boxes, {
        code: 'amazon',
        maxPackageWeightLb: '20.5',
      }).exceededPackageGroupPositions,
    ).toEqual([0, 1]);
  });
  it.each(['0', '-1', 'NaN', 'Infinity', '', 'abc', '0.0000001'])(
    'rejects invalid limit %s without throwing',
    (value) => {
      expect(maxPackageWeightSchema.safeParse(value).success).toBe(false);
    },
  );
  it.each(['0.000001', '50.5', '160'])(
    'accepts positive configured limit %s',
    (value) => {
      expect(maxPackageWeightSchema.safeParse(value).success).toBe(true);
    },
  );
});
