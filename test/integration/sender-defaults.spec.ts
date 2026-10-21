import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { BrowserSenderDefaults } from '@modules/shipping-quotes/browser-sender-defaults.js';

describe('Authenticated sender default boundary', () => {
  it('uses the myUnishippers Shipping address and never substitutes billing data', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let shipping: unknown = {
        addressLineList: ['1 Example Street'],
        locality: 'Walworth',
        region: 'WI',
        postalCode: '53125',
        countryCode: 'US',
      };
      await page.route('**/*', (route) =>
        new URL(route.request().url()).pathname === '/svc/getUserProfileFlow'
          ? route.fulfill({
              json: {
                clientStatus: { success: true },
                response: {
                  orgUnit: {
                    orgUnitName: 'Fixture warehouse',
                    addressList: {
                      Shipping: shipping,
                      BILLING: { addressLineList: ['Wrong origin'] },
                    },
                  },
                },
              },
            })
          : route.fulfill({
              contentType: 'text/html',
              body: `<label>Contact Email<input id="email" name="email"></label><button>QUICK QUOTE</button><script>fetch('/svc/getUserProfileFlow')</script>`,
            }),
      );
      const gateway = new BrowserSenderDefaults();
      const credentials = {
        email: 'fixture@example.test',
        password: 'fixture password',
      };
      expect(await gateway.readPage(page, credentials)).toEqual({
        name: 'Fixture warehouse',
        street: '1 Example Street',
        city: 'Walworth',
        division: 'WI',
        postalCode: '53125',
        country: 'US',
      });
      expect(await page.locator('#email').inputValue()).toBe('');
      shipping = undefined;
      await expect(gateway.readPage(page, credentials)).rejects.toThrow();
    } finally {
      await browser.close();
    }
  });
});
