import {
  assertSanitizedFixture,
  contractFixtureSchema,
  type ContractFixture,
} from '../../support/shipping-quotes/provider-contracts.js';

const unishippersEstimate = (
  quantity: number,
  country = 'US',
  destinationZip = '10118',
) => ({
  request: {
    productType: 'SMALLPACK',
    mode: 'ESTIMATE',
    shipment: {
      originAddress: { address: { postalCode: '53125', countryCode: 'US' } },
      destinationAddress: {
        address: { postalCode: destinationZip, countryCode: country },
      },
      handlingUnitList: Array.from({ length: quantity }, () => ({
        billedDimension: {
          length: { value: '10', unit: 'in' },
          width: { value: '8', unit: 'in' },
          height: { value: '6', unit: 'in' },
          dimensionType: 'NET',
        },
        weight: { value: '5', unit: 'LB' },
        packagingType: '02',
        packagingTypeName: 'Custom',
      })),
    },
  },
  orgInfo: { namespace: '<resolved-at-runtime>' },
});

export const contractFixtures: ContractFixture[] = [
  {
    provider: 'unishippers',
    scenario: 'domestic-success',
    mode: 'request',
    request: {
      method: 'POST',
      path: '/svc/shopFlow',
      headerNames: [
        'authorization',
        'content-type',
        'cookie',
        'x-session-token',
      ],
      payload: unishippersEstimate(2),
    },
    response: {
      status: 200,
      outcome: 'success',
      summary: {
        totalCurrency: 'USD',
        total: 24.16,
        packageCount: 2,
        chargeScope: 'whole-shipment',
        estimateMethod: 'provider-total',
        responsePath: 'response.offerList',
      },
    },
    identifiers: { namespace: '<resolved-at-runtime>' },
  },
  {
    provider: 'unishippers',
    scenario: 'domestic-success',
    mode: 'browser',
    request: {
      method: 'POST',
      path: '/svc/shopFlow',
      headerNames: [
        'authorization',
        'content-type',
        'cookie',
        'x-session-token',
      ],
      payload: unishippersEstimate(1),
    },
    response: {
      status: 200,
      outcome: 'success',
      summary: {
        totalCurrency: 'USD',
        total: 12.08,
        packageCount: 1,
        quantityBehavior: 'single-package-native-quick-quote',
        responsePath: 'response.offerList',
      },
    },
    identifiers: { namespace: '<resolved-at-runtime>' },
  },
  {
    provider: 'unishippers',
    scenario: 'validation-error',
    mode: 'request',
    request: {
      method: 'POST',
      path: '/svc/shopFlow',
      headerNames: [
        'authorization',
        'content-type',
        'cookie',
        'x-session-token',
      ],
      payload: {
        request: {
          productType: 'SMALLPACK',
          shipment: {
            originAddress: { address: { companyName: '<over-35-characters>' } },
          },
        },
      },
    },
    response: {
      status: 422,
      outcome: 'validation-error',
      summary: {
        field: 'AddressV3.Company Name',
        code: 'ERR_TOO_LONG',
        classification: 'provider-validation',
        scope:
          'historical-full-shipment-path; estimate-mode-does-not-send-company-name',
      },
    },
    identifiers: { namespace: '<resolved-at-runtime>' },
  },
  {
    provider: 'unishippers',
    scenario: 'authentication-expiry',
    mode: 'request',
    request: {
      method: 'POST',
      path: '/svc/shopFlow',
      headerNames: [
        'authorization',
        'content-type',
        'cookie',
        'x-session-token',
      ],
      payload: unishippersEstimate(2),
    },
    response: {
      status: 401,
      outcome: 'expired',
      summary: { recovery: 'one-relogin-and-replay' },
    },
    identifiers: { namespace: '<resolved-at-runtime>' },
  },
  {
    provider: 'unishippers',
    scenario: 'unsupported-route',
    mode: 'request',
    request: {
      method: 'POST',
      path: '/svc/shopFlow',
      headerNames: [
        'authorization',
        'content-type',
        'cookie',
        'x-session-token',
      ],
      payload: unishippersEstimate(1, 'CA', 'H2Y 1C6'),
    },
    response: {
      status: 422,
      outcome: 'unsupported',
      summary: {
        capability: 'international-estimate',
        reason:
          'tested-canada-input-rejected; account-wide-capability-remains-unverified',
      },
    },
    identifiers: { namespace: '<resolved-at-runtime>' },
  },
];

for (const fixture of contractFixtures) {
  contractFixtureSchema.parse(fixture);
  assertSanitizedFixture(fixture);
}
