import { describe, expect, it } from 'vitest';
import { mapUpsResponse } from './ups.mapper.js';

const reference = '1Z999AA10123456784';

describe('UPS response mapping', () => {
  it('selects the exact package, prefers RDD, and retains only consumed source fields', () => {
    const result = mapUpsResponse(
      {
        trackResponse: {
          shipment: [
            {
              package: [
                {
                  trackingNumber: 'sibling',
                  currentStatus: { description: 'Wrong' },
                },
                {
                  trackingNumber: reference,
                  currentStatus: {
                    description: 'In Transit',
                    simplifiedTextDescription: 'Moving',
                    code: 'I',
                  },
                  deliveryDate: [
                    { type: 'RDD', date: '20261022' },
                    { type: 'SDD', date: '20261020' },
                  ],
                  address: { name: 'PRIVATE_NAME' },
                  signature: 'PRIVATE_SIGNATURE',
                },
              ],
            },
          ],
        },
      },
      reference,
    );

    expect(result).toEqual({
      outcome: 'found',
      snapshot: {
        carrierStatus: 'Moving',
        carrierStatusDetail: 'In Transit',
        pickedUpOn: null,
        estimatedDeliveryOn: '2026-10-22',
        deliveredOn: null,
      },
      sourceData: {
        trackingNumber: reference,
        currentStatus: {
          description: 'In Transit',
          simplifiedTextDescription: 'Moving',
        },
        deliveryDate: [
          { type: 'RDD', date: '20261022' },
          { type: 'SDD', date: '20261020' },
        ],
      },
    });
  });

  it.each([
    [
      { description: ' Delivered ', simplifiedTextDescription: ' ' },
      [{ type: 'DEL', date: '20260228' }],
      {
        carrierStatus: 'Delivered',
        carrierStatusDetail: null,
        estimatedDeliveryOn: null,
        deliveredOn: '2026-02-28',
      },
    ],
    [
      { description: 'In Transit' },
      [{ type: 'SDD', date: '20261020' }],
      {
        carrierStatus: 'In Transit',
        carrierStatusDetail: null,
        estimatedDeliveryOn: '2026-10-20',
        deliveredOn: null,
      },
    ],
    [
      { description: 'Moving', simplifiedTextDescription: 'Moving' },
      null,
      {
        carrierStatus: 'Moving',
        carrierStatusDetail: null,
        estimatedDeliveryOn: null,
        deliveredOn: null,
      },
    ],
  ])(
    'maps status fallbacks and calendar dates without inventing pickup data',
    (currentStatus, deliveryDate, expected) => {
      const pkg = { trackingNumber: reference, currentStatus, deliveryDate };
      const result = mapUpsResponse(
        { trackResponse: { shipment: [{ package: [pkg] }] } },
        reference,
      );

      expect(result).toMatchObject({
        outcome: 'found',
        snapshot: { ...expected, pickedUpOn: null },
        sourceData: pkg,
      });
    },
  );

  it.each([
    {},
    { trackResponse: { shipment: [] } },
    {
      trackResponse: {
        shipment: [
          {
            package: [
              {
                trackingNumber: 'other',
                currentStatus: { description: 'Delivered' },
              },
            ],
          },
        ],
      },
    },
    ...['20260230', 'garbage', '00000201'].map((date) => ({
      trackResponse: {
        shipment: [
          {
            package: [
              {
                trackingNumber: reference,
                currentStatus: { description: 'Moving' },
                deliveryDate: [{ type: 'RDD', date }],
              },
            ],
          },
        ],
      },
    })),
    {
      trackResponse: {
        shipment: [
          {
            package: [
              { trackingNumber: reference, currentStatus: { description: '' } },
            ],
          },
        ],
      },
    },
  ])(
    'rejects malformed or mismatched responses instead of reporting not found',
    (body) => {
      expect(() => mapUpsResponse(body, reference)).toThrow(
        'UPS returned an invalid tracking response.',
      );
    },
  );
});
