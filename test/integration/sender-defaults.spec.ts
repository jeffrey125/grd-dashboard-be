import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { BrowserSenderDefaults } from '@modules/shipping-quotes/browser-sender-defaults.js';

describe('Authenticated sender default boundary', () => {
  it('reads the unique Amazon pickup address and strips unrelated fields', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', (route) => {
        if (
          new URL(route.request().url()).pathname.startsWith(
            '/shippers/drafts/',
          )
        )
          return route.fulfill({
            json: {
              onboardingRequest: {
                client: {
                  account: {
                    pickupAddresses: [
                      {
                        address: {
                          name: 'Fixture warehouse',
                          addressLine1: '1 Example Street',
                          city: 'Walworth',
                          stateOrProvinceCode: 'WI',
                          postalCode: '53125',
                          countryCode: 'US',
                          email: 'never-return@example.test',
                          token: 'never-return',
                        },
                      },
                    ],
                  },
                },
              },
            },
          });
        return route.fulfill({
          contentType: 'text/html',
          body: `<a>Sign out</a><script>fetch('/shippers/drafts/fixture')</script>`,
        });
      });
      const gateway = new BrowserSenderDefaults();
      expect(
        await gateway.readPage('amazon', page, {
          email: 'fixture@example.test',
          password: 'fixture password',
        }),
      ).toEqual({
        name: 'Fixture warehouse',
        street: '1 Example Street',
        city: 'Walworth',
        division: 'WI',
        postalCode: '53125',
        country: 'US',
      });
    } finally {
      await browser.close();
    }
  });
  it('rejects unrelated authentication tenants before entering credentials', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === 'ship.amazon.com'
          ? route.fulfill({
              contentType: 'text/html',
              body: "<script>location.replace('https://unrelated.auth0.com/login')</script>",
            })
          : route.fulfill({
              contentType: 'text/html',
              body: '<input id="ap_email" type="email"><button>Continue</button>',
            }),
      );
      await expect(
        new BrowserSenderDefaults().readPage('amazon', page, {
          email: 'fixture@example.test',
          password: 'fixture password',
        }),
      ).rejects.toThrow('unexpected_login_origin');
      expect(await page.locator('#ap_email').inputValue()).toBe('');
    } finally {
      await browser.close();
    }
  });
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
      expect(await gateway.readPage('unishippers', page, credentials)).toEqual({
        name: 'Fixture warehouse',
        street: '1 Example Street',
        city: 'Walworth',
        division: 'WI',
        postalCode: '53125',
        country: 'US',
      });
      expect(await page.locator('#email').inputValue()).toBe('');
      shipping = undefined;
      await expect(
        gateway.readPage('unishippers', page, credentials),
      ).rejects.toThrow();
    } finally {
      await browser.close();
    }
  });
});
