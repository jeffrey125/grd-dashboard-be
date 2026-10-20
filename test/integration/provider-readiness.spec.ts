import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { AmazonShippingAdapter } from '@modules/shipping-quotes/amazon-quote.adapter.js';

describe('Amazon readiness boundary', () => {
  it.each(['request', 'browser'] as const)(
    'resolves account/default context in %s mode while blocking rate and write requests',
    async (mode) => {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const origin = 'https://amazon.fixture';
      const authentication: string[] = [];
      const unsafe: string[] = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/getstarted/progress')
          return route.fulfill({
            contentType: 'text/html',
            body: `
        <label>Origin Postal<input></label><label>Destination Postal<input></label>
        <label>Length<input></label><label>Width<input></label><label>Height<input></label><label>Weight<input></label>
        <script>
          fetch('/hz/getLatestProposalSharedWithShipper',{headers:{'x-xsrf-token':'secret'}});
          fetch('/shippers/drafts/fixture');
          fetch('https://www.amazon.com/aaut/verify/cvf',{method:'POST'}).catch(()=>{});
          fetch('/shipping-rates/getRates',{method:'POST'}).catch(()=>{});
          fetch('/account/save',{method:'POST',body:'secret'}).catch(()=>{});
        </script>`,
          });
        if (url.pathname === '/hz/getLatestProposalSharedWithShipper')
          return route.fulfill({
            json: {
              rateCardProposal: {
                merchantId: 'private',
                simulatedShipperId: 'private',
              },
            },
          });
        if (url.pathname === '/shippers/drafts/fixture')
          return route.fulfill({
            json: {
              onboardingRequest: {
                client: {
                  account: {
                    pickupAddresses: [
                      {
                        address: {
                          name: 'Warehouse',
                          addressLine1: '1 Example St',
                          city: 'Walworth',
                          stateOrProvinceCode: 'WI',
                          postalCode: '53125',
                          countryCode: 'US',
                          token: 'secret',
                        },
                      },
                    ],
                  },
                },
              },
            },
          });
        if (
          url.origin === 'https://www.amazon.com' &&
          url.pathname === '/aaut/verify/cvf'
        ) {
          authentication.push(url.pathname);
          return route.fulfill({
            headers: { 'access-control-allow-origin': origin },
            json: {},
          });
        }
        unsafe.push(url.pathname);
        await route.abort();
      });
      const adapter = new AmazonShippingAdapter({ origin, context });
      try {
        await adapter.readiness(mode);
        expect(authentication).toEqual(['/aaut/verify/cvf']);
        expect(unsafe).toEqual([]);
      } finally {
        await adapter.close();
        await browser.close();
      }
    },
  );
});
