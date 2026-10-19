import { z } from 'zod';
import { QuoteDecimal } from './quote-decimal.js';
import { toProviderLength, toProviderWeight } from './quote-conversions.js';
import { currencyCodeSchema, phoneNumbersMatch } from './quote-standards.js';
import { randomUUID } from 'node:crypto';
import type {
  ExecutionResult,
  LeasedQuote,
} from './quote-execution.repository.js';
import { quoteFailure } from './quote-executor.js';

const money = z.object({
  value: z.union([z.number().finite().nonnegative(), z.string()]),
  unit: currencyCodeSchema,
});
const timing = z.object({
  serviceDescription: z.string().min(1).max(200).optional(),
  transitDays: z.number().int().nonnegative().optional(),
  estimatedDeliveryDate: z.iso.date().optional(),
  deliveryBy: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}$/)
    .optional(),
});
const charge = z.object({
  code: z.string().min(1).max(50).optional(),
  description: z.string().min(1).max(200).optional(),
  customerPrice: money,
});
const offers = z.object({
  clientStatus: z.object({ success: z.literal(true) }),
  response: z.object({
    offerList: z
      .array(
        z.object({
          totalOfferPrice: money,
          primaryVendor: z
            .object({ scac: z.string().min(1).max(50) })
            .optional(),
          expirationDate: z.string().optional(),
          offeredProductList: z
            .array(
              z.object({
                shopRQShipment: z.object({
                  timeInTransit: timing
                    .extend({ scac: z.string().min(1).max(50).optional() })
                    .optional(),
                  handlingUnitList: z.array(
                    z.object({ quantity: z.number().int().positive() }),
                  ),
                  charges: z.array(charge).optional(),
                }),
                charges: z.array(charge).optional(),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  }),
});

export class UnishippersContractError extends Error {
  constructor() {
    super('unishippers_contract_unverified');
  }
}

function assertSupportedJob(job: LeasedQuote): void {
  const provider = job.input.providers.find(
    (entry) => entry.code === 'unishippers',
  );
  if (
    !provider ||
    job.sender.address.country !== 'US' ||
    (job.input.destination.country !== 'US' &&
      job.input.international?.totalValue.currency !== 'USD') ||
    (provider.options.insurance !== null &&
      provider.options.insurance.currency !== 'USD') ||
    (job.mode === 'request' &&
      (provider.options.signature !== 'none' ||
        provider.options.insurance ||
        job.input.destination.country !== 'US' ||
        job.input.packageGroups.some((group) => group.customsItems.length)))
  )
    throw new UnishippersContractError();
}

function assertPackageQuantity(
  group: LeasedQuote['input']['packageGroups'][number],
): void {
  if (
    !Number.isInteger(group.quantity) ||
    group.quantity < 1 ||
    group.quantity > 50
  )
    throw new UnishippersContractError();
}

function convertMeasurement(
  group: LeasedQuote['input']['packageGroups'][number],
  value: string,
  kind: 'length' | 'weight',
): number {
  const result = new QuoteDecimal(
    kind === 'length'
      ? toProviderLength(value, group.units)
      : toProviderWeight(value, group.units),
  );
  if (!result.isFinite() || result.lte(0)) throw new UnishippersContractError();
  return result.toNumber();
}

function packageDimensions(
  group: LeasedQuote['input']['packageGroups'][number],
) {
  return {
    length: {
      value: String(convertMeasurement(group, group.length, 'length')),
      unit: 'in',
    },
    width: {
      value: String(convertMeasurement(group, group.width, 'length')),
      unit: 'in',
    },
    height: {
      value: String(convertMeasurement(group, group.height, 'length')),
      unit: 'in',
    },
    dimensionType: 'NET',
  };
}

function packageUnit(group: LeasedQuote['input']['packageGroups'][number]) {
  const dimensions = [group.length, group.width, group.height];
  const dimensionsBlank = dimensions.every((dimension) => dimension === '');
  if (!dimensionsBlank && dimensions.some((dimension) => dimension === ''))
    throw new UnishippersContractError();

  return {
    ...(dimensionsBlank
      ? {}
      : { billedDimension: { ...packageDimensions(group) } }),
    packagingType: '02',
    packagingTypeName: 'Custom',
    weight: {
      value: convertMeasurement(group, group.weight, 'weight'),
      unit: 'LB',
    },
  };
}

/**
 * The verified ESTIMATE contract sends one handling unit per box. The provider
 * ignored a group quantity field in the observed request, so this expansion
 * preserves every box while retaining one native shipment total.
 */
export function buildUnishippersEstimatePayload(
  job: LeasedQuote,
  namespace: string,
) {
  assertSupportedJob(job);

  const handlingUnitList = job.input.packageGroups.flatMap((group) => {
    assertPackageQuantity(group);
    return Array.from({ length: group.quantity }, () => packageUnit(group));
  });
  if (handlingUnitList.length === 0 || handlingUnitList.length > 50)
    throw new UnishippersContractError();

  return {
    request: {
      productType: 'SMALLPACK',
      mode: 'ESTIMATE',
      shipment: {
        handlingCharge: null,
        originAddress: {
          address: {
            postalCode: job.sender.address.postalCode,
            countryCode: 'US',
          },
        },
        destinationAddress: {
          address: {
            postalCode: job.input.destination.postalCode,
            countryCode: job.input.destination.country,
          },
        },
        handlingUnitList,
        residentialDeliveryFlag: null,
        shipmentDate: `${job.input.shipDate} 00:00:00`,
      },
    },
    correlationId: randomUUID(),
    showSpinner: false,
    orgInfo: { namespace },
  };
}

/** Only accept native browser traffic for the reviewed comparison snapshot. */
export function matchesUnishippersBrowserRequest(
  body: unknown,
  job: LeasedQuote,
  namespace: string,
): boolean {
  const address = z.object({
    companyName: z.string(),
    addressLineList: z.array(z.string()),
    locality: z.string(),
    region: z.string(),
    postalCode: z.string(),
    countryCode: z.string(),
    phone: z.string().optional(),
    contactList: z.array(
      z.object({ lastName: z.string(), phone: z.string().optional() }),
    ),
  });
  const measurement = z.object({
    value: z.union([z.string(), z.number()]),
    unit: z.string(),
  });
  const parsed = z
    .object({
      orgInfo: z.object({ namespace: z.literal(namespace) }),
      request: z.object({
        productType: z.literal('SMALLPACK'),
        mode: z.literal('SHOP').optional(),
        shipment: z.object({
          shipmentDate: z.string(),
          originAddress: z.object({ address }),
          destinationAddress: z.object({ address }),
          handlingUnitList: z
            .array(
              z.object({
                quantity: z.number().int().positive().max(50).optional(),
                billedDimension: z.object({
                  length: measurement,
                  width: measurement,
                  height: measurement,
                }),
                weight: measurement,
              }),
            )
            .max(50),
        }),
      }),
    })
    .safeParse(body);
  if (!parsed.success) return false;
  const shipment = parsed.data.request.shipment;
  const normalize = (value: string) => value.trim().toUpperCase();
  const sameAddress = (
    actual: z.infer<typeof address>,
    expected: LeasedQuote['sender']['address'],
  ) =>
    normalize(actual.companyName) === normalize(expected.name) &&
    JSON.stringify(actual.addressLineList.filter(Boolean).map(normalize)) ===
      JSON.stringify(
        [expected.street, expected.street2]
          .filter((line): line is string => Boolean(line))
          .map(normalize),
      ) &&
    normalize(actual.locality) === normalize(expected.city) &&
    normalize(actual.region) === normalize(expected.division) &&
    normalize(actual.postalCode) === normalize(expected.postalCode) &&
    actual.countryCode === expected.country &&
    (!expected.contactName ||
      normalize(actual.contactList[0]?.lastName ?? '') ===
        normalize(expected.contactName)) &&
    (!expected.phone ||
      phoneNumbersMatch(
        actual.contactList[0]?.phone ?? actual.phone ?? '',
        expected.phone,
        expected.country,
      )) &&
    (!expected.phone ||
      actual.phone === undefined ||
      phoneNumbersMatch(actual.phone, expected.phone, expected.country));
  const [year, month, day] = job.input.shipDate.split('-');
  if (
    !(
      shipment.shipmentDate.startsWith(job.input.shipDate) ||
      shipment.shipmentDate === `${month}/${day}/${year}`
    ) ||
    !sameAddress(shipment.originAddress.address, job.sender.address) ||
    !sameAddress(shipment.destinationAddress.address, job.input.destination)
  )
    return false;
  const expected = buildUnishippersEstimatePayload(job, namespace).request
    .shipment.handlingUnitList;
  const units = shipment.handlingUnitList.flatMap((unit) =>
    Array.from({ length: unit.quantity ?? 1 }, () => unit),
  );
  return (
    units.length === expected.length &&
    units.every((unit, index) => {
      const target = expected[index]!;
      const billedDimension = target.billedDimension;
      if (!billedDimension) return false;
      return (
        ['length', 'width', 'height'].every((key) => {
          const dimension = key as 'length' | 'width' | 'height';
          return (
            Number(unit.billedDimension[dimension].value) ===
              Number(billedDimension[dimension].value) &&
            unit.billedDimension[dimension].unit.toLowerCase() === 'in'
          );
        }) &&
        Number(unit.weight.value) === target.weight.value &&
        unit.weight.unit.toUpperCase() === 'LB'
      );
    })
  );
}

export function unishippersFailure(
  status: number,
  body: unknown,
): ExecutionResult | null {
  if (status === 401 || status === 403)
    return quoteFailure('authentication_failed');
  const parsed = z
    .object({
      clientStatus: z.object({
        success: z.boolean().optional(),
        fieldMap: z.record(z.string(), z.array(z.string())).optional(),
      }),
    })
    .safeParse(body);
  if (status >= 500) return quoteFailure('provider_failed');
  if (
    parsed.success &&
    parsed.data.clientStatus.fieldMap?.['AddressV3.Company Name']?.includes(
      'ERR_TOO_LONG',
    )
  )
    return quoteFailure('sender_company_too_long');
  if (
    status === 400 ||
    status === 422 ||
    (parsed.success && parsed.data.clientStatus.success !== true)
  )
    return quoteFailure('validation_failed');
  if (status < 200 || status >= 300) return quoteFailure('provider_failed');
  return null;
}

function decimal(value: string | number): string {
  const text = String(value);
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(text))
    throw new UnishippersContractError();
  return new QuoteDecimal(text).toFixed(6);
}

export function normalizeUnishippersOffers(
  body: unknown,
  packageCount: number,
  optionCoverage: 'included' | 'unsupported' | 'unverified' = 'unverified',
): ExecutionResult['quotes'] {
  const parsed = offers.safeParse(body);
  if (!parsed.success) throw new UnishippersContractError();

  return parsed.data.response.offerList.map((offer) => {
    const count = offer.offeredProductList.reduce(
      (sum, product) =>
        sum +
        product.shopRQShipment.handlingUnitList.reduce(
          (boxes, unit) => boxes + unit.quantity,
          0,
        ),
      0,
    );
    if (count !== packageCount) throw new UnishippersContractError();

    const timings = offer.offeredProductList.map(
      (product) => product.shopRQShipment.timeInTransit,
    );
    const first = timings[0];
    const consistent = timings.every(
      (item) => JSON.stringify(item) === JSON.stringify(first),
    );
    const transit =
      consistent && first
        ? [
            first.transitDays === undefined
              ? null
              : `${first.transitDays} transit days`,
            first.estimatedDeliveryDate
              ? `estimated delivery ${first.estimatedDeliveryDate}`
              : null,
            first.deliveryBy
              ? `delivery by ${first.deliveryBy} (provider local time)`
              : null,
          ]
            .filter(Boolean)
            .join('; ')
        : '';
    const charges = offer.offeredProductList.flatMap((product) => {
      // The provider has emitted the same package charge either on the
      // product or on shopRQShipment depending on the response path. Prefer
      // the product representation when both are present so one provider line
      // is not double-counted, while preserving repeated lines for repeated
      // packages.
      const source = product.charges ?? product.shopRQShipment.charges ?? [];
      return source.map((charge) => {
        const amount = decimal(charge.customerPrice.value);
        const description =
          charge.description ?? charge.code ?? 'Provider charge';
        return {
          description,
          amount,
          scope: 'package' as const,
          packageGroupPosition: null,
        };
      });
    });
    const expiry = z.iso
      .datetime({ offset: true })
      .safeParse(offer.expirationDate);

    return {
      platform: 'myUnishippers',
      carrier: offer.primaryVendor?.scac ?? first?.scac ?? 'Not provided',
      service: consistent
        ? (first?.serviceDescription ?? 'Not provided')
        : 'Not provided',
      total: decimal(offer.totalOfferPrice.value),
      currency: offer.totalOfferPrice.unit,
      estimateMethod: 'native',
      transitDescription: transit || null,
      expiresAt: expiry.success ? new Date(expiry.data).toISOString() : null,
      optionCoverage,
      dutyStatus: 'unknown',
      taxStatus: 'unknown',
      clearanceStatus: 'unknown',
      charges,
      groupContributions: [],
    };
  });
}
