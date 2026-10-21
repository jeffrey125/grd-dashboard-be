import { chromium, type Page } from 'playwright';
import { z } from 'zod';
import {
  addressSchema,
  type Address,
  type ProviderCode,
} from './quote.schemas.js';

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

export function mapUnishippersAddress(body: unknown): Address {
  const org = unishippersPayload.parse(body).response.orgUnit;
  const source = org.addressList.Shipping;
  return addressSchema.safeExtend({ country: z.literal('US') }).parse({
    name: org.orgUnitName,
    street: source.addressLineList[0],
    ...(source.addressLineList[1]
      ? { street2: source.addressLineList[1] }
      : {}),
    city: source.locality,
    division: source.region,
    postalCode: source.postalCode,
    country: source.countryCode,
  });
}

export class BrowserSenderDefaults {
  async read(provider: ProviderCode): Promise<Address> {
    if (provider !== 'unishippers')
      throw new Error('sender_refresh_unavailable');
    const email = process.env.MYUNISHIPPERS_EMAIL;
    const password = process.env.MYUNISHIPPERS_PASSWORD;
    if (!email || !password) throw new Error('sender_credentials_unavailable');
    const browser = await chromium.launch({ headless: true });
    const deadline = setTimeout(() => {
      void browser.close();
    }, 75000);
    try {
      return await this.readPage(
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
    page: Page,
    credentials: { email: string; password: string },
  ): Promise<Address> {
    const origin = 'https://www.myunishippers.com';
    const loginOrigins = new Set([
      'https://auth.myunishippers.com',
      'https://auth.unishippers.com',
    ]);
    page.setDefaultTimeout(20000);
    const pending = page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === origin &&
            url.pathname === '/svc/getUserProfileFlow' &&
            response.ok()
          );
        },
        { timeout: 65000 },
      )
      .then(async (response) => mapUnishippersAddress(await response.json()));
    void pending.catch(() => undefined);
    await page.goto(`${origin}/ship/small-package`, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });
    const email = page
      .locator('#username:visible,input[name="username"]:visible')
      .first();
    const authenticated = page.getByText(/quick quote/i).first();
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
