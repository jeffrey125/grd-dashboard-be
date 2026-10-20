import { chromium, type Page } from 'playwright';
import { z } from 'zod';
import {
  addressSchema,
  type Address,
  type ProviderCode,
} from './quote.schemas.js';

const amazonPayload = z.object({
  onboardingRequest: z.object({
    client: z.object({
      account: z.object({
        pickupAddresses: z
          .array(
            z.object({
              address: z.object({
                name: z.string().nullish(),
                companyName: z.string().nullish(),
                addressLine1: z.string(),
                addressLine2: z.string().nullish(),
                addressLine3: z.string().nullish(),
                city: z.string(),
                stateOrProvinceCode: z.string(),
                postalCode: z.string(),
                countryCode: z.string(),
              }),
            }),
          )
          .length(1),
      }),
    }),
  }),
});
const unishippersPayload = z.object({
  clientStatus: z.object({ success: z.literal(true) }),
  response: z.object({
    orgUnit: z.object({
      orgUnitName: z.string(),
      addressList: z.object({
        Shipping: z.object({
          addressLineList: z.array(z.string()).min(1).max(2),
          locality: z.string(),
          region: z.string(),
          postalCode: z.string(),
          countryCode: z.string(),
        }),
      }),
    }),
  }),
});

function mapAddress(provider: ProviderCode, body: unknown): Address {
  let address: Address;
  if (provider === 'amazon') {
    const a =
      amazonPayload.parse(body).onboardingRequest.client.account
        .pickupAddresses[0].address;
    address = {
      name: a.companyName || a.name || '',
      street: a.addressLine1,
      ...(a.addressLine2 || a.addressLine3
        ? {
            street2: [a.addressLine2, a.addressLine3]
              .filter(Boolean)
              .join(', '),
          }
        : {}),
      city: a.city,
      division: a.stateOrProvinceCode,
      postalCode: a.postalCode,
      country: a.countryCode,
    };
  } else {
    const org = unishippersPayload.parse(body).response.orgUnit;
    const a = org.addressList.Shipping;
    address = {
      name: org.orgUnitName,
      street: a.addressLineList[0],
      ...(a.addressLineList[1] ? { street2: a.addressLineList[1] } : {}),
      city: a.locality,
      division: a.region,
      postalCode: a.postalCode,
      country: a.countryCode,
    };
  }
  return addressSchema.safeExtend({ country: z.literal('US') }).parse(address);
}
export class BrowserSenderDefaults {
  async read(provider: ProviderCode): Promise<Address> {
    const prefix = provider === 'amazon' ? 'AMAZON_SHIPPING' : 'MYUNISHIPPERS';
    const email = process.env[`${prefix}_EMAIL`];
    const password = process.env[`${prefix}_PASSWORD`];
    if (!email || !password) throw new Error('sender_credentials_unavailable');
    const browser = await chromium.launch({ headless: true });
    const deadline = setTimeout(() => {
      void browser.close();
    }, 75000);
    try {
      return await this.readPage(
        provider,
        await browser.newPage({ serviceWorkers: 'block' }),
        { email, password },
      );
    } catch {
      throw new Error('sender_refresh_failed');
    } finally {
      clearTimeout(deadline);
      await browser.close();
    }
  }

  async readPage(
    provider: ProviderCode,
    page: Page,
    credentials: { email: string; password: string },
  ): Promise<Address> {
    const origin =
      provider === 'amazon'
        ? 'https://ship.amazon.com'
        : 'https://www.myunishippers.com';
    const loginOrigins = new Set(
      provider === 'amazon'
        ? ['https://ship.amazon.com', 'https://www.amazon.com']
        : ['https://auth.myunishippers.com', 'https://auth.unishippers.com'],
    );
    const path =
      provider === 'amazon'
        ? '/getstarted/progress?show=rates'
        : '/ship/small-package';
    page.setDefaultTimeout(20000);
    const pending = page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === origin &&
            (provider === 'amazon'
              ? /^\/shippers\/drafts\/[^/]+$/.test(url.pathname)
              : url.pathname === '/svc/getUserProfileFlow') &&
            response.ok()
          );
        },
        { timeout: 65000 },
      )
      .then(async (response) => mapAddress(provider, await response.json()));
    // Attach a rejection handler immediately while login proceeds; raw provider errors never escape read().
    void pending.catch(() => undefined);
    await page.goto(origin + path, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });
    const email = page
      .locator(
        provider === 'amazon'
          ? '#ap_email:visible,input[type="email"]:visible'
          : '#username:visible,input[name="username"]:visible',
      )
      .first();
    const authenticated = page
      .getByText(provider === 'amazon' ? /sign out/i : /quick quote/i)
      .first();
    await email
      .or(authenticated)
      .first()
      .waitFor({ state: 'visible', timeout: 25000 });
    if (await email.isVisible()) {
      const loginUrl = new URL(page.url());
      if (!loginOrigins.has(loginUrl.origin))
        throw new Error('unexpected_login_origin');
      await email.fill(credentials.email);
      await page
        .getByRole('button', { name: /continue/i })
        .first()
        .click();
      const password = page.locator('input[type="password"]:visible').first();
      await password.waitFor({ state: 'visible' });
      const passwordUrl = new URL(page.url());
      if (passwordUrl.origin !== loginUrl.origin)
        throw new Error('unexpected_login_origin');
      await password.fill(credentials.password);
      await page
        .getByRole('button', { name: /continue|sign in|log in/i })
        .first()
        .click();
    }
    const result = await pending;
    if (new URL(page.url()).origin !== origin)
      throw new Error('sender_authentication_unconfirmed');
    return result;
  }
}
