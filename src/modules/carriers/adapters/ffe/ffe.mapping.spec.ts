import { describe, expect, it } from 'vitest';
import { mapFfe } from './ffe.mapping.js';

describe('FFE tracking mapping', () => {
  it.each([
    { pickupDate: null, apptPickupDate: '2026-10-01T00:00:00' },
    { pickupDate: 'not-a-date', apptPickupDate: '2026-10-01T00:00:00' },
    {
      pickupDate: ' 0001-01-01T00:00:00 ',
      apptPickupDate: '2026-10-01T00:00:00',
    },
    {
      pickupDate: '2026-02-30T00:00:00',
      apptPickupDate: '2026-10-01T00:00:00',
    },
  ])('uses an appointment when actual pickup is unavailable: %j', (dates) => {
    expect(mapFfe('A', { orderNumber: 'A', ...dates })).toMatchObject({
      outcome: 'found',
      snapshot: { pickedUpOn: '2026-10-01' },
    });
  });
  it('falls through invalid estimates and never completes a merely scheduled shipment', () => {
    expect(
      mapFfe('A', {
        orderNumber: 'A',
        shipmentStatus: 'Scheduled',
        apptDeliveryDate: '2026-02-30',
        schedDeliveryDate: 'bad',
        requestedDeliveryDate: '2026-10-20T00:00:00',
        deliveryDate: '2026-10-19T00:00:00',
      }),
    ).toMatchObject({
      snapshot: { estimatedDeliveryOn: '2026-10-20', deliveredOn: null },
    });
  });
  it('keeps delivered status active when its date is invalid or absent', () => {
    for (const deliveryDate of [null, 'bad', '0001-01-01T00:00:00'])
      expect(
        mapFfe('A', {
          orderNumber: 'A',
          shipmentStatus: 'Delivered',
          deliveryDate,
        }),
      ).toMatchObject({
        snapshot: { carrierStatus: 'Delivered', deliveredOn: null },
      });
  });
  it('rejects unusable, mismatched, and structurally malformed records', () => {
    for (const row of [
      { orderNumber: 'A' },
      { orderNumber: 'B', shipmentStatus: 'Moving' },
      { orderNumber: 'A', shipmentStatus: { secret: 'PRIVATE' } },
    ])
      expect(() => mapFfe('A', row)).toThrow();
  });
  it('prefers actual pickup, preserves calendar dates and only retains consumed evidence', () => {
    expect(
      mapFfe('001', {
        orderNumber: '001',
        shipmentStatus: ' Delivered ',
        pickupDate: '2026-10-02T23:00:00-05:00',
        apptPickupDate: '2026-10-01T00:00:00',
        apptDeliveryDate: '2026-10-06T00:00:00',
        deliveryDate: '2026-10-07T00:00:00',
        consigneeAddress1: 'PRIVATE',
      }),
    ).toEqual({
      outcome: 'found',
      snapshot: {
        carrierStatus: 'Delivered',
        carrierStatusDetail: null,
        pickedUpOn: '2026-10-02',
        estimatedDeliveryOn: '2026-10-06',
        deliveredOn: '2026-10-07',
      },
      sourceData: {
        orderNumber: '001',
        shipmentStatus: ' Delivered ',
        pickupDate: '2026-10-02T23:00:00-05:00',
        apptPickupDate: '2026-10-01T00:00:00',
        apptDeliveryDate: '2026-10-06T00:00:00',
        schedDeliveryDate: null,
        requestedDeliveryDate: null,
        deliveryDate: '2026-10-07T00:00:00',
      },
    });
  });
});
