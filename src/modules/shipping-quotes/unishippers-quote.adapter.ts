import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import type {
  ExecutionResult,
  LeasedQuote,
} from './quote-execution.repository.js';
import { quoteFailure, type QuoteAdapter } from './quote-executor.js';
import {
  buildUnishippersEstimatePayload,
  normalizeUnishippersOffers,
  matchesUnishippersBrowserRequest,
  UnishippersContractError,
  unishippersFailure,
} from './unishippers-quote.contract.js';
import type { Address } from './quote.schemas.js';
import { QuoteDecimal } from './quote-decimal.js';
import { unishippersBrowserInputFailure } from './quote-provider-eligibility.js';
import { z } from 'zod';

const LOGIN_TIMEOUT_MS = 30_000;
const RATE_TIMEOUT_MS = 90_000;
const US_STATES: Record<string, string> = Object.fromEntries(
  'AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming'
    .split('|')
    .map((entry) => entry.split(':')),
);
const COUNTRY_NAMES: Record<string, string> = {
  CA: 'Canada',
  US: 'United States',
};

type UnishippersSession = {
  namespace: string;
  headers: Record<string, string>;
  defaultOrigin: Address;
};

const profileResponse = z.object({
  clientStatus: z.object({ success: z.literal(true) }),
  response: z.object({
    orgUnit: z.object({
      namespace: z.string().min(1),
      orgUnitName: z.string().min(1),
      addressList: z.object({
        Shipping: z.object({
          addressLineList: z.array(z.string().min(1)).min(1).max(2),
          locality: z.string().min(1),
          region: z.string().min(1),
          postalCode: z.string().min(1),
          countryCode: z.literal('US'),
        }),
      }),
    }),
  }),
});

type UnishippersAdapterOptions = {
  origin?: string;
  launch?: () => Promise<Browser>;
  context?: BrowserContext;
  credentials?: () => { email: string; password: string };
};

export class UnishippersAuthenticationExpired extends Error {
  constructor() {
    super('myUnishippers authentication expired');
  }
}

export class UnishippersAuthenticationFailed extends Error {
  constructor() {
    super('myUnishippers authentication failed');
  }
}

async function responseBody(response: {
  status(): number;
  text(): Promise<string>;
}) {
  const text = await response.text();
  try {
    return { status: response.status(), body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status(), body: undefined };
  }
}

async function selectMaterialOption(
  select: Locator,
  value: string,
  page: Page,
): Promise<void> {
  await select.click();
  const option = page.getByRole('option', { name: value, exact: true });
  await option.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
  await option.click();
}

export class UnishippersShippingAdapter implements QuoteAdapter {
  readonly simulated = false;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private session?: UnishippersSession;

  constructor(private readonly options: UnishippersAdapterOptions = {}) {}

  private get origin() {
    return this.options.origin ?? 'https://www.myunishippers.com';
  }

  private get credentials() {
    const credentials = this.options.credentials?.() ?? {
      email: process.env.MYUNISHIPPERS_EMAIL?.trim() ?? '',
      password: process.env.MYUNISHIPPERS_PASSWORD ?? '',
    };
    if (!credentials.email || !credentials.password)
      throw new UnishippersAuthenticationFailed();
    return credentials;
  }

  private async getPage(): Promise<Page> {
    if (this.page) return this.page;
    if (this.options.context) this.context = this.options.context;
    else {
      this.browser = await (
        this.options.launch ?? (() => chromium.launch({ headless: true }))
      )();
      this.context = await this.browser.newContext({ serviceWorkers: 'block' });
    }
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(LOGIN_TIMEOUT_MS);
    return this.page;
  }

  private loginEmail(page: Page): Locator {
    return (
      page
        // Auth0 uses "username" here. The authenticated shipping form can expose
        // an unrelated contact field with id/name "email".
        .locator('#username:visible,input[name="username"]:visible')
        .first()
    );
  }

  private quoteButton(page: Page): Locator {
    return page.getByRole('button', { name: /^quick quote$/i }).first();
  }

  private async waitForEntry(page: Page): Promise<void> {
    const entry = this.quoteButton(page).or(this.loginEmail(page)).first();
    await entry.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
    const body = (await page.locator('body').innerText()).toLowerCase();
    if (
      /captcha|verify (?:that )?you are human|one-time password|multi-factor/.test(
        body,
      )
    )
      throw new UnishippersAuthenticationFailed();
  }

  private captureBootstrap(page: Page): Promise<UnishippersSession> {
    this.session = undefined;
    const nativeHeaders = page
      .waitForRequest(
        (request) => {
          const url = new URL(request.url());
          const headers = request.headers();
          return (
            url.origin === this.origin &&
            url.pathname.startsWith('/svc/') &&
            Boolean(headers.authorization && headers['x-session-token'])
          );
        },
        { timeout: LOGIN_TIMEOUT_MS },
      )
      .then((request) => request.headers());
    void nativeHeaders.catch(() => undefined);
    return page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === this.origin &&
            url.pathname === '/svc/getUserProfileFlow'
          );
        },
        { timeout: LOGIN_TIMEOUT_MS },
      )
      .then(async (response) => {
        if (response.status() === 401 || response.status() === 403)
          throw new UnishippersAuthenticationExpired();
        if (!response.ok()) throw new UnishippersAuthenticationFailed();
        const body = await response.json();
        const profile = profileResponse.safeParse(body);
        const headers = await nativeHeaders;
        if (
          !profile.success ||
          !headers.authorization ||
          !headers['x-session-token']
        )
          throw new UnishippersAuthenticationFailed();
        const org = profile.data.response.orgUnit;
        const shipping = org.addressList.Shipping;
        const session = {
          namespace: org.namespace,
          headers: {
            'content-type': 'application/json',
            authorization: headers.authorization,
            'x-session-token': headers['x-session-token'],
            ...(headers.cachettl ? { cachettl: headers.cachettl } : {}),
          },
          defaultOrigin: {
            name: org.orgUnitName,
            street: shipping.addressLineList[0]!,
            ...(shipping.addressLineList[1]
              ? { street2: shipping.addressLineList[1] }
              : {}),
            city: shipping.locality,
            division: shipping.region,
            postalCode: shipping.postalCode,
            country: shipping.countryCode,
          },
        };
        this.session = session;
        return session;
      });
  }

  private async login(force = false): Promise<void> {
    const page = await this.getPage();
    if (force) this.session = undefined;
    const bootstrap = this.captureBootstrap(page);
    void bootstrap.catch(() => undefined);
    const response = await page.goto(`${this.origin}/ship/small-package`, {
      waitUntil: 'domcontentloaded',
      timeout: LOGIN_TIMEOUT_MS,
    });
    if (response && response.status() >= 400) {
      if (response.status() === 401 || response.status() === 403)
        throw new UnishippersAuthenticationExpired();
      throw new UnishippersAuthenticationFailed();
    }
    await this.waitForEntry(page);
    const email = this.loginEmail(page);
    if (await email.isVisible()) {
      const loginOrigins = new Set([
        this.origin,
        'https://auth.myunishippers.com',
        'https://auth.unishippers.com',
      ]);
      const loginOrigin = new URL(page.url()).origin;
      if (!loginOrigins.has(loginOrigin))
        throw new UnishippersAuthenticationFailed();
      await email.fill(this.credentials.email);
      await page
        .getByRole('button', { name: /continue/i })
        .first()
        .click();
      const password = page.locator('input[type="password"]:visible').first();
      await password.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
      if (!loginOrigins.has(new URL(page.url()).origin))
        throw new UnishippersAuthenticationFailed();
      await password.fill(this.credentials.password);
      await page
        .getByRole('button', { name: /continue|log in|sign in/i })
        .first()
        .click();
    }
    await this.quoteButton(page).waitFor({
      state: 'visible',
      timeout: LOGIN_TIMEOUT_MS,
    });
    if (new URL(page.url()).origin !== this.origin)
      throw new UnishippersAuthenticationFailed();
    await bootstrap;
  }

  private async ensureBillMyAccount(page: Page): Promise<void> {
    const billing = page.locator('#billOption:visible').first();
    await billing.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
    const current = (await billing.innerText()).trim();
    if (/bill my account/i.test(current)) return;
    if (/select billing details/i.test(current)) {
      await selectMaterialOption(billing, 'Bill My Account', page);
      return;
    }
    throw new UnishippersContractError();
  }

  private async ensureAccountContext(
    page: Page,
    job: LeasedQuote,
  ): Promise<void> {
    await this.ensureBillMyAccount(page);
    if (job.sender.mode !== 'account_default') return;
    if (!job.sender.retrievedAt) throw new UnishippersContractError();
    const session = this.currentSession();
    const sender = page
      .getByRole('combobox', { name: 'Select Company Name', exact: true })
      .first();
    await sender.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
    let displayed = '';
    try {
      displayed = await sender.inputValue();
    } catch {
      displayed = await sender.innerText();
    }
    const expected = job.sender.address;
    const profile = session.defaultOrigin;
    const normalize = (value: string) => value.trim().toUpperCase();
    if (
      normalize(expected.name) !== normalize(profile.name) ||
      normalize(expected.street) !== normalize(profile.street) ||
      normalize(expected.street2 ?? '') !== normalize(profile.street2 ?? '') ||
      normalize(expected.city) !== normalize(profile.city) ||
      normalize(expected.division) !== normalize(profile.division) ||
      normalize(expected.postalCode) !== normalize(profile.postalCode) ||
      normalize(expected.country) !== normalize(profile.country)
    )
      throw new UnishippersContractError();
    if (
      !normalize(displayed).includes(normalize(expected.name)) ||
      !normalize(displayed).includes(normalize(expected.postalCode)) ||
      !normalize(displayed).includes(normalize(expected.division))
    )
      throw new UnishippersContractError();
  }

  private currentSession(): UnishippersSession {
    if (!this.session) throw new UnishippersAuthenticationFailed();
    return this.session;
  }

  private async requestQuote(
    job: LeasedQuote,
    page: Page,
  ): Promise<ExecutionResult> {
    const session = this.currentSession();
    const payload = buildUnishippersEstimatePayload(job, session.namespace);
    const packageCount = job.input.packageGroups.reduce(
      (sum, group) => sum + group.quantity,
      0,
    );
    const response = await page.evaluate(
      async ({ payload, headers }) => {
        const result = await fetch('/svc/shopFlow', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(payload),
        });
        return { status: result.status, body: await result.text() };
      },
      { payload, headers: session.headers },
    );
    let body: unknown;
    try {
      body = JSON.parse(response.body);
    } catch {
      body = undefined;
    }
    const failure = unishippersFailure(response.status, body);
    if (failure) return failure;
    return {
      outcome: 'success',
      reason: null,
      simulated: false,
      relogins: 0,
      quotes: normalizeUnishippersOffers(body, packageCount, 'included'),
    };
  }

  private async browserQuote(
    job: LeasedQuote,
    page: Page,
  ): Promise<ExecutionResult> {
    const expected = buildUnishippersEstimatePayload(
      job,
      this.currentSession().namespace,
    );
    const inputFailure = unishippersBrowserInputFailure(job.input, job.sender);
    if (inputFailure) return quoteFailure(inputFailure);

    let mutationBlocked = false;
    const pattern = '**/*';
    const readOnlyPosts = new Set([
      '/svc/shopFlow',
      '/svc/schedulePickupFlow',
      '/svc/addressValidationFlow',
      '/svc/calculateUPSOversizeAdditionalChargeFlow',
      '/svc/searchIndexDocumentFlow',
      '/svc/getUserProfileFlow',
      '/svc/getNotificationCountFlow',
      '/svc/getNotificationListFlow',
      '/svc/getSystemNotificationsFlow',
      '/svc/getDynamicEntityFlow',
      '/svc/getShippingAddressFlow',
      '/svc/getAddressLocationFlow',
      '/svc/getCountryDivisionMappingFlow',
      '/svc/getCountryListFlow',
      '/svc/getValidCitiesForPostalCodeFlow',
    ]);
    let rejectUnsafe!: (error: Error) => void;
    const unsafe = new Promise<never>((_resolve, reject) => {
      rejectUnsafe = reject;
    });
    void unsafe.catch(() => undefined);
    const guard = async (route: import('playwright').Route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      // schedulePickupFlow retrieves pickup offers in the native rate flow;
      // booking is performed by orderFlow. Never allow an order or saved data.
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
        !(
          request.method() === 'POST' &&
          new URL(request.url()).origin === this.origin &&
          readOnlyPosts.has(path)
        )
      ) {
        mutationBlocked = true;
        await route.abort();
        rejectUnsafe(new UnishippersContractError());
      } else await route.fallback();
    };
    await page.route(pattern, guard);
    const entered = page.getByRole('radio', { name: /^USE AS ENTERED/ });
    const preserveEnteredAddress = async () => {
      await entered.check();
      await page
        .getByRole('button', { name: 'USE SELECTED ADDRESS', exact: true })
        .click();
    };
    await page.addLocatorHandler(entered, preserveEnteredAddress, {
      noWaitAfter: true,
    });
    // Install before filling: native accounts can auto-quote during form changes.
    const pending = Promise.race([
      unsafe,
      page.waitForResponse(
        (candidate) => {
          const request = candidate.request();
          if (
            new URL(candidate.url()).origin !== this.origin ||
            new URL(candidate.url()).pathname !== '/svc/shopFlow' ||
            request.method() !== 'POST'
          )
            return false;
          try {
            return matchesUnishippersBrowserRequest(
              request.postDataJSON(),
              job,
              this.currentSession().namespace,
            );
          } catch {
            return false;
          }
        },
        { timeout: RATE_TIMEOUT_MS },
      ),
    ]);
    void pending.catch(() => undefined);
    try {
      if (job.sender.mode === 'explicit') {
        await page
          .getByRole('button', { name: 'EDIT SENDER', exact: true })
          .click();
        const dialog = page.getByRole('dialog').filter({
          has: page.getByRole('heading', { name: 'Edit Sender Address' }),
        });
        await dialog
          .getByRole('combobox', {
            name: 'Sender Company or Name',
            exact: true,
          })
          .fill(job.sender.address.name);
        await this.fillAddress(page, dialog, job.sender.address);
        await this.assertNoAddressSave(dialog);
        // The verified provider handler only closes this dialog with local form
        // data; account writes require a separate address-book selection.
        await dialog.locator('#ow-save-btn-edit-address').click();
        await dialog.waitFor({ state: 'hidden' });
      }
      await page
        .getByRole('combobox', {
          name: 'Receiver Company or Name',
          exact: true,
        })
        .fill(job.input.destination.name);
      await this.fillAddress(page, page.locator('body'), job.input.destination);
      await this.assertNoAddressSave(page.locator('body'));
      const [year, month, day] = job.input.shipDate.split('-');
      await page
        .locator('input[formcontrolname="preferredShippingDate"]')
        .fill(`${month}/${day}/${year}`);
      await page
        .locator('input[formcontrolname="preferredShippingDate"]')
        .press('Tab');

      const quantities = page.locator(
        'mat-select[formcontrolname="numPackages"]:visible',
      );
      for (let index = 1; index < job.input.packageGroups.length; index += 1)
        await page
          .getByRole('button', { name: 'ADD', exact: true })
          .last()
          .click();
      let position = 0;
      for (const [index, group] of job.input.packageGroups.entries()) {
        await selectMaterialOption(
          quantities.nth(index),
          String(group.quantity),
          page,
        );
        const unit = expected.request.shipment.handlingUnitList[position]!;
        position += group.quantity;
        if (!unit.billedDimension) throw new UnishippersContractError();
        for (const dimension of ['length', 'width', 'height'] as const) {
          const field = page
            .locator(`input[formcontrolname="${dimension}"]:visible`)
            .nth(index);
          const value = unit.billedDimension[dimension].value;
          await field.fill(value);
          if (Number(await field.inputValue()) !== Number(value))
            throw new UnishippersContractError();
        }
        const weight = page
          .locator('input[formcontrolname="weight"]:visible')
          .nth(index);
        await weight.fill(String(unit.weight.value));
        if (Number(await weight.inputValue()) !== unit.weight.value)
          throw new UnishippersContractError();
      }
      await this.fillInternationalDetails(page, job);
      await this.fillProviderOptions(page, job);
      const rates = page.getByRole('button', {
        name: 'GET RATES',
        exact: true,
      });
      let requested = false;
      // Some accounts start the partial rate flow automatically; others expose
      // GET RATES. Both paths can request address confirmation before continuing.
      for (let index = 0; index < 6; index += 1) {
        const step = await Promise.race([
          pending.then(() => 'response' as const),
          entered
            .waitFor({ state: 'visible', timeout: RATE_TIMEOUT_MS })
            .then(() => 'address' as const),
          ...(requested
            ? []
            : [
                rates
                  .waitFor({ state: 'visible', timeout: RATE_TIMEOUT_MS })
                  .then(() => 'rates' as const),
              ]),
        ]);
        if (step === 'response') break;
        if (step === 'address') {
          await page.removeLocatorHandler(entered);
          await preserveEnteredAddress();
          await page.addLocatorHandler(entered, preserveEnteredAddress, {
            noWaitAfter: true,
          });
        } else {
          requested = true;
          await Promise.race([pending, rates.click()]);
        }
      }
      const response = await pending;
      if (mutationBlocked) throw new UnishippersContractError();
      const result = await responseBody(response);
      const failure = unishippersFailure(result.status, result.body);
      if (failure) return failure;
      return {
        outcome: 'success',
        reason: null,
        simulated: false,
        relogins: 0,
        quotes: normalizeUnishippersOffers(
          result.body,
          expected.request.shipment.handlingUnitList.length,
          'included',
        ),
      };
    } finally {
      await page.removeLocatorHandler(entered).catch(() => undefined);
      // Keep the deny-by-default guard active through teardown, including any
      // delayed provider subscriptions after a rate response.
      await page.close().catch(() => undefined);
      if (this.page === page) this.page = undefined;
    }
  }

  private async assertNoAddressSave(scope: Locator): Promise<void> {
    for (const select of await scope
      .getByRole('combobox', { name: 'Save', exact: true })
      .filter({ visible: true })
      .all())
      if ((await select.innerText()).trim() !== 'Select One')
        throw new UnishippersContractError();
  }

  private async fillInternationalDetails(
    page: Page,
    job: LeasedQuote,
  ): Promise<void> {
    if (job.input.destination.country === 'US') return;
    const international = job.input.international;
    if (!international) throw new UnishippersContractError();
    const description = page
      .getByLabel(/specific description of contents/i)
      .filter({ visible: true })
      .first();
    const total = page
      .getByLabel(/^total value$/i)
      .filter({ visible: true })
      .first();
    await description.fill(international.contentsDescription);
    await total.fill(international.totalValue.amount);
    if (
      (await description.inputValue()) !== international.contentsDescription ||
      !new QuoteDecimal(await total.inputValue()).equals(
        international.totalValue.amount,
      )
    )
      throw new UnishippersContractError();
  }

  private async fillProviderOptions(
    page: Page,
    job: LeasedQuote,
  ): Promise<void> {
    const provider = job.input.providers.find(
      (entry) => entry.code === 'unishippers',
    );
    if (!provider) throw new UnishippersContractError();
    if (provider.options.signature !== 'none') {
      const signature = page.locator('#signatureOptions:visible').first();
      await selectMaterialOption(
        signature,
        provider.options.signature === 'signature'
          ? 'Signature Required'
          : 'Adult Signature Required',
        page,
      );
    }
    if (provider.options.insurance) {
      const insurance = page
        .getByRole('checkbox', { name: /insure shipment/i })
        .first();
      await insurance.check();
      const amount = page
        .getByLabel(/insured value|insurance amount/i)
        .filter({ visible: true })
        .first();
      await amount.fill(provider.options.insurance.amount);
      if (
        !new QuoteDecimal(await amount.inputValue()).equals(
          provider.options.insurance.amount,
        )
      )
        throw new UnishippersContractError();
    }
  }

  private async fillAddress(
    page: Page,
    scope: Locator,
    address: Address,
  ): Promise<void> {
    const country = scope
      .getByRole('combobox', { name: 'Country', exact: true })
      .filter({ visible: true })
      .first();
    if (await country.isVisible())
      await selectMaterialOption(
        country,
        COUNTRY_NAMES[address.country] ?? address.country,
        page,
      );
    await scope
      .getByLabel('Address 1', { exact: true })
      .filter({ visible: true })
      .fill(address.street);
    await scope
      .getByLabel('Address 2', { exact: true })
      .filter({ visible: true })
      .fill(address.street2 ?? '');
    await scope
      .getByLabel('Address 3', { exact: true })
      .filter({ visible: true })
      .fill('');
    await scope
      .getByLabel('Postal Code', { exact: true })
      .filter({ visible: true })
      .fill(address.postalCode);
    const state = scope.locator('mat-select[formcontrolname="state"]:visible');
    await selectMaterialOption(
      state,
      address.country === 'US'
        ? (US_STATES[address.division.toUpperCase()] ?? address.division)
        : address.division,
      page,
    );
    const city = scope
      .getByRole('combobox', { name: 'City', exact: true })
      .filter({ visible: true });
    await city.fill(address.city);
    await city.press('Tab');
    await scope
      .getByLabel('Contact Name', { exact: true })
      .filter({ visible: true })
      .fill(address.contactName!);
    await scope
      .getByLabel('Phone number', { exact: true })
      .filter({ visible: true })
      .fill(address.phone!);
  }

  async quote(job: LeasedQuote, signal: AbortSignal): Promise<ExecutionResult> {
    try {
      signal.throwIfAborted();
      const page = await this.getPage();
      await this.login();
      await this.ensureAccountContext(page, job);
      const result =
        job.mode === 'request'
          ? await this.requestQuote(job, page)
          : await this.browserQuote(job, page);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      if (
        error instanceof UnishippersAuthenticationExpired ||
        error instanceof UnishippersAuthenticationFailed
      )
        return quoteFailure('authentication_failed');
      if (error instanceof UnishippersContractError)
        return quoteFailure('unsupported');
      return quoteFailure('provider_failed');
    }
  }

  async relogin(_job: LeasedQuote, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.session = undefined;
    await this.login(true);
  }

  async close(_job: LeasedQuote): Promise<void> {
    this.session = undefined;
    this.page = undefined;
    this.context = undefined;
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close();
  }
}
