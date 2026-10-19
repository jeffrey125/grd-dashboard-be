import { chromium, type Browser, type Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnishippersShippingAdapter } from './unishippers-quote.adapter.js';
import { matchesUnishippersBrowserRequest } from './unishippers-quote.contract.js';
import type { LeasedQuote } from './quote-execution.repository.js';

const origin = 'https://unishippers-adapter.fixture';
const address = {
  name: 'Fixture Sender',
  street: '1 Example Street',
  city: 'Walworth',
  division: 'WI',
  postalCode: '53125',
  country: 'US' as const,
  contactName: 'Fixture Contact',
  phone: '2025550147',
};
const destination = {
  name: 'Fixture Receiver',
  street: '350 Fifth Avenue',
  city: 'New York',
  division: 'NY',
  postalCode: '10118',
  country: 'US' as const,
  contactName: 'Fixture Receiver Contact',
  phone: '2025550148',
};

type PackageGroup = {
  quantity: number;
  units: 'imperial';
  length: string;
  width: string;
  height: string;
  weight: string;
  customsItems: [];
};

type FixtureState = {
  shopRequests: Array<Record<string, unknown>>;
  mutations: string[];
  verifyAddresses?: boolean;
  unsafeSenderSave?: boolean;
};

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function pageHtml(state: FixtureState) {
  return `<!doctype html>
    <main>
      <label>Sender<input id="sender-default" role="combobox" aria-label="Select Company Name" value="Fixture Sender - 1 Example Street, Walworth, WI 53125 US"></label>
      <label>Contact Email<input id="email" name="email" aria-label="Email"></label>
      <button type="button" id="edit-sender">EDIT SENDER</button>
      <input role="combobox" aria-label="Receiver Company or Name" id="receiver-company">
      <label>Address 1<input aria-label="Address 1" id="receiver-street"></label>
      <label>Address 2<input aria-label="Address 2" id="receiver-street2"></label>
      <label>Address 3<input aria-label="Address 3" id="receiver-street3"></label>
      <label>Postal Code<input aria-label="Postal Code" id="receiver-zip"></label>
      <input role="combobox" aria-label="City" id="receiver-city">
      <mat-select formcontrolname="state" role="combobox" aria-label="State/Prov"><span>State/Prov</span></mat-select>
      <label>Contact Name<input aria-label="Contact Name" id="receiver-contact"></label>
      <label>Phone number<input aria-label="Phone number" id="receiver-phone"></label>
      <mat-select role="combobox" aria-label="Save"><span>Select One</span></mat-select>
      <input formcontrolname="preferredShippingDate" aria-label="Ship Date" id="shipping-date">
      <section id="packages"><div class="package">
        <mat-select formcontrolname="numPackages" role="combobox" aria-label="Total Identical Packages"><span>1</span></mat-select>
        <input formcontrolname="length"><input formcontrolname="width"><input formcontrolname="height"><input formcontrolname="weight">
      </div></section>
      <button type="button" id="add">ADD</button>
      <button type="button" id="get-rates">GET RATES</button>
      <mat-select id="billOption" role="combobox" aria-label="Select Billing Details"><span>Bill My Account</span></mat-select>
      <button type="button" id="quick-quote">QUICK QUOTE</button>
    </main>
    <section role="dialog" id="sender-dialog" hidden>
      <h3>Edit Sender Address</h3>
      <input role="combobox" aria-label="Sender Company or Name" id="sender-company">
      <label>Address 1<input aria-label="Address 1" id="sender-street"></label>
      <label>Address 2<input aria-label="Address 2" id="sender-street2"></label>
      <label>Address 3<input aria-label="Address 3" id="sender-street3"></label>
      <label>Postal Code<input aria-label="Postal Code" id="sender-zip"></label>
      <input role="combobox" aria-label="City" id="sender-city">
      <mat-select formcontrolname="state" role="combobox" aria-label="State/Prov"><span>State/Prov</span></mat-select>
      <label>Contact Name<input aria-label="Contact Name" id="sender-contact"></label>
      <label>Phone number<input aria-label="Phone number" id="sender-phone"></label>
      <mat-select role="combobox" aria-label="Save"><span>Select One</span></mat-select>
      <button id="ow-save-btn-edit-address">SAVE</button>
    </section>
    <section role="dialog" id="address-verification" hidden>
      <h2>Verify Address</h2>
      <label><input type="radio" name="verify" aria-label="USE AS ENTERED" checked>USE AS ENTERED</label>
      <button id="confirm-address">USE SELECTED ADDRESS</button>
    </section>
    <section id="quick-quote-modal" hidden>
      <h2>Quick Quote</h2>
      <label>Sender ZIP<input id="senderZip" aria-label="Sender ZIP"></label>
      <label>Delivery ZIP<input id="deliveryZip" aria-label="Delivery ZIP"></label>
      <label>Length<input id="quick-quote-length-input" aria-label="Length"></label>
      <label>Width<input id="ups-package-type-width-input" aria-label="Width"></label>
      <label>Height<input id="ups-package-type-height-input" aria-label="Height"></label>
      <label>Weight<input id="ups-package-type-weight-input" aria-label="Weight"></label>
      <button type="button" id="quickQuoteButton">GET QUOTE</button>
      <button type="button" id="quickQuoteDone">DONE</button>
    </section>
    <script>
      const authHeaders = {
        'content-type': 'application/json',
        authorization: 'Bearer fixture-access',
        'x-session-token': 'fixture-session'
      };
      const profile = fetch('/svc/getUserProfileFlow', {
        method: 'POST', headers: authHeaders, body: '{}'
      }).then(response => response.json());
      profile.then(() => fetch('/svc/getNotificationCountFlow', {
        method: 'POST', headers: authHeaders, body: '{}'
      }));

      function optionList(select, values) {
        select.addEventListener('click', () => {
          document.querySelectorAll('[role="option"]').forEach(option => option.remove());
          values.forEach(value => {
            const option = document.createElement('div');
            option.setAttribute('role', 'option');
            option.textContent = value;
            option.onclick = () => {
              select.querySelector('span').textContent = value;
              select.dataset.value = value;
              option.remove();
            };
            document.body.append(option);
          });
        });
      }
      optionList(document.querySelector('#billOption'), ['Bill My Account', 'Bill Receiver']);
      document.querySelectorAll('mat-select[formcontrolname="state"]').forEach(select => optionList(select, ['Wisconsin', 'New York']));
      document.querySelectorAll('mat-select[formcontrolname="numPackages"]').forEach(select => optionList(select, ['1', '2', '3']));
      document.querySelector('#edit-sender').onclick = () => document.querySelector('#sender-dialog').hidden = false;
      document.querySelector('#ow-save-btn-edit-address').onclick = () => {
        if (${state.unsafeSenderSave === true}) void fetch('/svc/addressBookUnexpectedFlow', {method:'POST',headers:authHeaders,body:'{}'}).catch(() => {});
        document.querySelector('#sender-dialog').hidden = true;
      };
      document.querySelector('#add').onclick = () => {
        const card = document.querySelector('.package').cloneNode(true);
        document.querySelector('#packages').append(card);
        optionList(card.querySelector('mat-select'), ['1', '2', '3']);
      };
      const submitRates = async () => {
        const value = id => document.querySelector('#' + id).value;
        const units = Array.from(document.querySelectorAll('.package')).flatMap(card => Array.from({length:Number(card.querySelector('mat-select').dataset.value || 1)}, () => ({
          billedDimension:{length:{value:card.querySelector('[formcontrolname="length"]').value,unit:'in'},width:{value:card.querySelector('[formcontrolname="width"]').value,unit:'in'},height:{value:card.querySelector('[formcontrolname="height"]').value,unit:'in'}},
          weight:{value:card.querySelector('[formcontrolname="weight"]').value,unit:'LB'},packagingType:'02'
        })));
        const account = await profile;
        await fetch('/svc/shopFlow', {method:'POST',headers:authHeaders,body:JSON.stringify({request:{productType:'SMALLPACK',mode:'SHOP',shipment:{
          originAddress:{address:{companyName:value('sender-company') || 'Fixture Sender',addressLineList:[value('sender-street') || '1 Example Street',value('sender-street2')].filter(Boolean),locality:value('sender-city') || 'Walworth',region:document.querySelector('#sender-dialog mat-select[formcontrolname="state"]').dataset.value === 'New York' ? 'NY' : 'WI',postalCode:value('sender-zip') || '53125',countryCode:'US',phone:value('sender-phone') || '2025550147',contactList:[{lastName:value('sender-contact') || 'Fixture Contact',phone:value('sender-phone') || '2025550147'}]}},
          destinationAddress:{address:{companyName:value('receiver-company'),addressLineList:[value('receiver-street'),value('receiver-street2')].filter(Boolean),locality:value('receiver-city'),region:document.querySelector('main mat-select[formcontrolname="state"]').dataset.value === 'New York' ? 'NY' : 'WI',postalCode:value('receiver-zip'),countryCode:'US',phone:value('receiver-phone'),contactList:[{lastName:value('receiver-contact'),phone:value('receiver-phone')}] }},
          shipmentDate:value('shipping-date'),handlingUnitList:units
        }},orgInfo:{namespace:account.response.orgUnit.namespace}})});
      };
      let confirmations = 0;
      document.querySelector('#get-rates').onclick = () => {
        if (${state.verifyAddresses === true}) document.querySelector('#address-verification').hidden = false;
        else void submitRates();
      };
      document.querySelector('#confirm-address').onclick = () => {
        if (++confirmations === 2) {
          document.querySelector('#address-verification').hidden = true;
          void submitRates();
        }
      };
      document.querySelector('#quick-quote').onclick = () => {
        document.querySelector('#quick-quote-modal').hidden = false;
      };
      document.querySelector('#quickQuoteDone').onclick = () => {
        document.querySelector('#quick-quote-modal').hidden = true;
      };
      document.querySelector('#quickQuoteButton').onclick = async () => {
        const value = selector => document.querySelector(selector).value;
        const handlingUnitList = [{
          billedDimension: {length: {value: value('#quick-quote-length-input'), unit: 'in'}, width: {value: value('#ups-package-type-width-input'), unit: 'in'}, height: {value: value('#ups-package-type-height-input'), unit: 'in'}, dimensionType: 'NET'},
          weight: {value: value('#ups-package-type-weight-input'), unit: 'LB'}, packagingType: '02'
        }];
        const account = await profile;
        await fetch('/svc/shopFlow', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({request: {productType: 'SMALLPACK', mode: 'ESTIMATE', shipment: {
            originAddress: {address: {postalCode: value('#senderZip'), countryCode: 'US'}},
            destinationAddress: {address: {postalCode: value('#deliveryZip'), countryCode: 'US'}},
            handlingUnitList
          }}, orgInfo: {namespace: account.response.orgUnit.namespace}})
        });
      };
    </script>`;
}

async function handleRoute(route: Route, state: FixtureState): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) {
    await route.abort();
    return;
  }
  if (url.pathname === '/ship/small-package') {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: pageHtml(state),
    });
    return;
  }
  if (url.pathname === '/svc/getUserProfileFlow') {
    await route.fulfill(
      json(200, {
        clientStatus: { success: true },
        response: {
          orgUnit: {
            namespace: 'fixture-namespace',
            orgUnitName: 'Fixture Sender',
            addressList: {
              Shipping: {
                addressLineList: ['1 Example Street'],
                locality: 'Walworth',
                region: 'WI',
                postalCode: '53125',
                countryCode: 'US',
              },
            },
          },
        },
      }),
    );
    return;
  }
  if (url.pathname === '/svc/getNotificationCountFlow') {
    await route.fulfill(json(200, { clientStatus: { success: true } }));
    return;
  }
  if (url.pathname === '/svc/shopFlow') {
    const body = JSON.parse(request.postData() ?? '{}') as Record<
      string,
      unknown
    >;
    state.shopRequests.push(body);
    const requestBody = body.request as {
      shipment?: { handlingUnitList?: Array<unknown> };
    };
    const count = requestBody.shipment?.handlingUnitList?.length ?? 0;
    await route.fulfill(
      json(200, {
        clientStatus: { success: true },
        response: {
          offerList: [
            {
              totalOfferPrice: {
                value: count === 2 ? 24.16 : 12.08,
                unit: 'USD',
              },
              primaryVendor: { scac: 'UPS' },
              expirationDate: '2026-10-24 00:00:00',
              offeredProductList: Array.from({ length: count }, () => ({
                shopRQShipment: {
                  timeInTransit: {
                    serviceDescription: 'UPS Ground',
                    transitDays: 2,
                    estimatedDeliveryDate: '2026-10-21',
                    deliveryBy: '23:00:00',
                    scac: 'UPS',
                  },
                  handlingUnitList: [{ quantity: 1 }],
                  charges: [
                    {
                      code: 'FRT',
                      description: 'SMALL PACKAGE FREIGHT',
                      customerPrice: { value: 12.08, unit: 'USD' },
                    },
                  ],
                },
              })),
            },
          ],
        },
      }),
    );
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
    state.mutations.push(url.pathname);
  await route.abort();
}

function group(
  quantity = 1,
  overrides: Partial<PackageGroup> = {},
): PackageGroup {
  return {
    quantity,
    units: 'imperial',
    length: '10',
    width: '8',
    height: '6',
    weight: '5',
    customsItems: [],
    ...overrides,
  };
}

function makeJob(
  mode: 'request' | 'browser',
  packageGroups: PackageGroup[],
  senderMode: 'explicit' | 'account_default' = 'explicit',
  senderAddress = address,
): LeasedQuote {
  return {
    id: 'attempt-1',
    requestId: 'request-1',
    accountId: 1,
    owner: 'owner-1',
    code: 'unishippers',
    mode,
    enabled: true,
    reloginCount: 0,
    sender: {
      code: 'unishippers',
      mode: senderMode,
      retrievedAt: '2026-10-20T00:00:00.000Z',
      address: { ...senderAddress },
    },
    input: {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      shipDate: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
      }).format(new Date()),
      destination: { ...destination },
      providers: [
        {
          code: 'unishippers',
          sender:
            senderMode === 'explicit'
              ? { mode: 'explicit', address: { ...senderAddress } }
              : {
                  mode: 'account_default',
                  refreshId: '11111111-1111-4111-8111-111111111112',
                },
          options: { signature: 'none', insurance: null },
        },
      ],
      packageGroups,
    },
  };
}

describe('myUnishippers production adapter contract', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function fixture() {
    const state: FixtureState = { shopRequests: [], mutations: [] };
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', (route) => handleRoute(route, state));
    return { context, state };
  }

  it('runs authenticated request mode with native per-box units and bootstrap namespace', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
      credentials: () => ({
        email: 'fixture@example.test',
        password: 'fixture-password',
      }),
    });
    try {
      const result = await adapter.quote(
        makeJob('request', [group(2)], 'account_default'),
        new AbortController().signal,
      );

      expect(result).toMatchObject({ outcome: 'success', reason: null });
      expect(result.quotes[0]).toMatchObject({
        platform: 'myUnishippers',
        carrier: 'UPS',
        service: 'UPS Ground',
        total: '24.160000',
        currency: 'USD',
        estimateMethod: 'native',
      });
      const payload = testFixture.state.shopRequests[0];
      expect(payload).toBeDefined();
      expect(payload?.orgInfo).toEqual({ namespace: 'fixture-namespace' });
      const shipment = payload.request as {
        shipment: { handlingUnitList: unknown[] };
      };
      expect(shipment.shipment.handlingUnitList).toHaveLength(2);
      expect(testFixture.state.mutations).toEqual([]);
    } finally {
      await adapter.close(makeJob('request', [group(2)]));
      await testFixture.context.close();
    }
  });

  it('drives the full browser form with receiver contacts', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
      credentials: () => ({
        email: 'fixture@example.test',
        password: 'fixture-password',
      }),
    });
    try {
      const result = await adapter.quote(
        makeJob('browser', [group(1)], 'account_default'),
        new AbortController().signal,
      );

      expect(result).toMatchObject({ outcome: 'success', reason: null });
      expect(result.quotes[0]).toMatchObject({
        platform: 'myUnishippers',
        total: '12.080000',
      });
      const payload = testFixture.state.shopRequests[0];
      expect(payload).toBeDefined();
      const shipment = payload.request as {
        shipment: {
          handlingUnitList: unknown[];
          originAddress: { address: Record<string, unknown> };
          destinationAddress: { address: Record<string, unknown> };
        };
      };
      expect(shipment.shipment.handlingUnitList).toHaveLength(1);
      expect(shipment.shipment.originAddress.address).toMatchObject({
        postalCode: '53125',
        countryCode: 'US',
      });
      expect(shipment.shipment.destinationAddress.address).toMatchObject({
        postalCode: '10118',
        countryCode: 'US',
        contactList: [
          { lastName: 'Fixture Receiver Contact', phone: '2025550148' },
        ],
      });
      expect(testFixture.state.mutations).toEqual([]);
    } finally {
      await adapter.close(makeJob('browser', [group(1)]));
      await testFixture.context.close();
    }
  });

  it('submits native multiple packages through the full browser form', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
      credentials: () => ({
        email: 'fixture@example.test',
        password: 'fixture-password',
      }),
    });
    try {
      const result = await adapter.quote(
        makeJob('browser', [group(2)], 'account_default'),
        new AbortController().signal,
      );

      expect(result).toMatchObject({
        outcome: 'success',
        reason: null,
      });
      expect(result.quotes[0]?.total).toBe('24.160000');
      expect(testFixture.state.mutations).toEqual([]);
    } finally {
      await adapter.close(makeJob('browser', [group(2)]));
      await testFixture.context.close();
    }
  });

  it('uses a comparison-only explicit sender correction without account mutation', async () => {
    const testFixture = await fixture();
    const correctedSender = {
      ...address,
      name: 'Global Resources Direct LLC',
    };
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
      credentials: () => ({
        email: 'fixture@example.test',
        password: 'fixture-password',
      }),
    });
    try {
      const result = await adapter.quote(
        makeJob('browser', [group(1)], 'explicit', correctedSender),
        new AbortController().signal,
      );

      expect(result.outcome).toBe('success');
      const payload = testFixture.state.shopRequests[0];
      expect(payload).toBeDefined();
      expect(
        (
          payload.request as {
            shipment: { originAddress: { address: Record<string, unknown> } };
          }
        ).shipment.originAddress.address,
      ).toMatchObject({
        companyName: correctedSender.name,
        addressLineList: [correctedSender.street],
        locality: correctedSender.city,
        region: correctedSender.division,
        postalCode: correctedSender.postalCode,
        countryCode: correctedSender.country,
        phone: correctedSender.phone,
        contactList: [
          {
            lastName: correctedSender.contactName,
            phone: correctedSender.phone,
          },
        ],
      });
      const job = makeJob('browser', [group(1)], 'explicit', correctedSender);
      expect(
        matchesUnishippersBrowserRequest(payload, job, 'fixture-namespace'),
      ).toBe(true);
      for (const field of [
        'shipmentDate',
        'originAddress',
        'destinationAddress',
        'handlingUnitList',
      ]) {
        const stale = structuredClone(payload) as {
          request: { shipment: Record<string, unknown> };
        };
        stale.request.shipment[field] =
          field === 'shipmentDate' ? '1999-01-01 00:00:00' : null;
        expect(
          matchesUnishippersBrowserRequest(stale, job, 'fixture-namespace'),
        ).toBe(false);
      }
      expect(
        matchesUnishippersBrowserRequest(payload, job, 'other-account'),
      ).toBe(false);
      const nativeWithoutMode = structuredClone(payload) as {
        request: { mode?: string };
      };
      delete nativeWithoutMode.request.mode;
      expect(
        matchesUnishippersBrowserRequest(
          nativeWithoutMode,
          job,
          'fixture-namespace',
        ),
      ).toBe(true);
      const wrongPhone = structuredClone(payload) as {
        request: {
          shipment: { originAddress: { address: { phone: string } } };
        };
      };
      wrongPhone.request.shipment.originAddress.address.phone = '2025550199';
      expect(
        matchesUnishippersBrowserRequest(wrongPhone, job, 'fixture-namespace'),
      ).toBe(false);
      for (const change of [
        { request: { ...(payload.request as object), mode: 'ESTIMATE' } },
        { request: { ...(payload.request as object), productType: 'LTL' } },
      ])
        expect(
          matchesUnishippersBrowserRequest(
            { ...payload, ...change },
            job,
            'fixture-namespace',
          ),
        ).toBe(false);
      expect(testFixture.state.mutations).toEqual([]);
    } finally {
      await adapter.close(makeJob('browser', [group(1)]));
      await testFixture.context.close();
    }
  });

  it('submits the selected future ship date through the full browser form', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const job = makeJob('browser', [group(1)]);
    job.input.shipDate = '2099-10-20';

    try {
      const result = await adapter.quote(job, new AbortController().signal);

      expect(result).toMatchObject({
        outcome: 'success',
        reason: null,
      });
      expect(testFixture.state.shopRequests[0]).toMatchObject({
        request: { shipment: { shipmentDate: '10/20/2099' } },
      });
    } finally {
      await adapter.close(job);
      await testFixture.context.close();
    }
  });

  it('keeps multiple package groups together in one native browser quote', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const job = makeJob(
      'browser',
      [group(1), group(1, { length: '20', weight: '7' })],
      'account_default',
    );
    try {
      const result = await adapter.quote(job, new AbortController().signal);
      expect(result.outcome).toBe('success');
      expect(result.quotes[0]?.total).toBe('24.160000');
      expect(testFixture.state.shopRequests).toHaveLength(1);
      expect(testFixture.state.shopRequests[0]).toMatchObject({
        request: {
          shipment: {
            handlingUnitList: [
              { billedDimension: { length: { value: '10' } } },
              {
                billedDimension: { length: { value: '20' } },
                weight: { value: '7' },
              },
            ],
          },
        },
      });
    } finally {
      await adapter.close(job);
      await testFixture.context.close();
    }
  });

  it('returns actionable validation for missing browser contact details without submitting rates', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const job = makeJob('browser', [group(2)]);
    delete job.input.destination.phone;
    try {
      const result = await adapter.quote(job, new AbortController().signal);
      expect(result).toMatchObject({
        outcome: 'validation_failed',
        reason: 'contact_details_required',
        quotes: [],
      });
      expect(testFixture.state.shopRequests).toEqual([]);
    } finally {
      await adapter.close(job);
      await testFixture.context.close();
    }
  });

  it('preserves entered addresses through both native confirmation dialogs without repeating the rate request', async () => {
    const testFixture = await fixture();
    testFixture.state.verifyAddresses = true;
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const job = makeJob('browser', [group(2)], 'account_default');
    try {
      const result = await adapter.quote(job, new AbortController().signal);
      expect(result.outcome).toBe('success');
      expect(testFixture.state.shopRequests).toHaveLength(1);
      expect(testFixture.state.mutations).toEqual([]);
    } finally {
      await adapter.close(job);
      await testFixture.context.close();
    }
  });

  it('blocks an unknown write attempted by a changed sender editor and fails closed', async () => {
    const testFixture = await fixture();
    testFixture.state.unsafeSenderSave = true;
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const job = makeJob('browser', [group(1)]);
    try {
      expect(
        await adapter.quote(job, new AbortController().signal),
      ).toMatchObject({ outcome: 'unsupported', quotes: [] });
      expect(testFixture.state.mutations).toEqual([]);
    } finally {
      await adapter.close(job);
      await testFixture.context.close();
    }
  });

  it('requires contacts for an explicit sender before posting a quote', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const job = makeJob('browser', [group(1)]);
    delete job.sender.address.phone;
    try {
      expect(
        await adapter.quote(job, new AbortController().signal),
      ).toMatchObject({
        outcome: 'validation_failed',
        reason: 'contact_details_required',
      });
      expect(testFixture.state.shopRequests).toEqual([]);
    } finally {
      await adapter.close(job);
      await testFixture.context.close();
    }
  });
});
