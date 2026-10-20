import { guardReadinessPage } from './provider-readiness-guard.js';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Route,
} from 'playwright';
import type {
  ExecutionResult,
  LeasedQuote,
} from './quote-execution.repository.js';
import { quoteFailure, type QuoteAdapter } from './quote-executor.js';
import {
  aggregateUnishippersQuickQuoteRates,
  buildUnishippersQuickQuoteReplay,
  matchesUnishippersQuickQuoteRequest,
  normalizeUnishippersOffers,
  unishippersQuickQuoteSignature,
  UnishippersContractError,
  unishippersFailure,
} from './unishippers-quote.contract.js';
import { toProviderLength, toProviderWeight } from './quote-conversions.js';
import { QuoteDecimal } from './quote-decimal.js';
import { unishippersQuickQuoteDateSupported } from './quote-provider-eligibility.js';
import { z } from 'zod';

const LOGIN_TIMEOUT_MS = 30_000;
const RATE_TIMEOUT_MS = 90_000;
const READ_ONLY_PROVIDER_POSTS = new Set([
  '/svc/getAddressLocationFlow',
  '/svc/getCountryDivisionMappingFlow',
  '/svc/getCountryListFlow',
  '/svc/getDynamicEntityFlow',
  '/svc/getNotificationCountFlow',
  '/svc/getNotificationListFlow',
  '/svc/getShippingAddressFlow',
  '/svc/getSystemNotificationsFlow',
  '/svc/getUserProfileFlow',
  '/svc/searchIndexDocumentFlow',
]);
const LOGIN_ORIGINS = new Set([
  'https://auth.myunishippers.com',
  'https://auth.unishippers.com',
]);
const alertFetch = z
  .object({ request: z.object({ mode: z.literal('FETCH') }).passthrough() })
  .passthrough();

function isAlertFetch(request: Request): boolean {
  try {
    return alertFetch.safeParse(request.postDataJSON()).success;
  } catch {
    return false;
  }
}

type UnishippersAdapterOptions = {
  origin?: string;
  launch?: () => Promise<Browser>;
  context?: BrowserContext;
  credentials?: () => { email: string; password: string };
};

type QuickQuoteCapture = {
  body: unknown;
  headers: Record<string, string>;
  response: { status: number; body: unknown };
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

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function replayHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers()).filter(([name]) => {
      const lower = name.toLowerCase();
      return (
        lower === 'accept' ||
        lower === 'authorization' ||
        lower === 'cachettl' ||
        lower === 'content-type' ||
        lower === 'x-requested-with' ||
        lower.startsWith('x-')
      );
    }),
  );
}

export class UnishippersShippingAdapter implements QuoteAdapter {
  readonly simulated = false;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

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
    if (this.page && !this.page.isClosed()) return this.page;
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
    return page
      .locator('#username:visible,input[name="username"]:visible')
      .first();
  }

  private quoteButton(page: Page): Locator {
    return page.getByRole('button', { name: /^quick quote$/i }).first();
  }

  private async waitForEntry(page: Page): Promise<void> {
    await this.quoteButton(page).or(this.loginEmail(page)).first().waitFor({
      state: 'visible',
      timeout: LOGIN_TIMEOUT_MS,
    });
    const body = (await page.locator('body').innerText()).toLowerCase();
    if (
      /captcha|verify (?:that )?you are human|one-time password|multi-factor/.test(
        body,
      )
    )
      throw new UnishippersAuthenticationFailed();
  }

  private async login(page: Page): Promise<void> {
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
      const loginOrigins = new Set([this.origin, ...LOGIN_ORIGINS]);
      if (!loginOrigins.has(new URL(page.url()).origin))
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
  }

  private requestGuard(): (route: Route) => Promise<void> {
    return async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method());
      const providerPost =
        request.method() === 'POST' &&
        url.origin === this.origin &&
        (READ_ONLY_PROVIDER_POSTS.has(url.pathname) ||
          url.pathname === '/svc/shopFlow' ||
          (url.pathname === '/svc/setAlertFlow' && isAlertFetch(request)));
      const loginPost =
        request.method() === 'POST' &&
        LOGIN_ORIGINS.has(url.origin) &&
        /^(?:\/u\/login(?:\/(?:identifier|password))?|\/usernamepassword\/login|\/oauth\/token)$/.test(
          url.pathname,
        );

      if (read || providerPost || loginPost) await route.fallback();
      else await route.abort();
    };
  }

  private async guardedLogin(
    force = false,
  ): Promise<{ page: Page; guard: (route: Route) => Promise<void> }> {
    if (force && this.page) {
      await this.page.close().catch(() => undefined);
      this.page = undefined;
    }
    const page = await this.getPage();
    const guard = this.requestGuard();
    await page.route('**/*', guard);
    try {
      await this.login(page);
    } catch (error) {
      await page.unroute('**/*', guard).catch(() => undefined);
      throw error;
    }

    return { page, guard };
  }

  private quickQuoteField(page: Page, id: string): Locator {
    return page.locator(`#${id}:visible`).first();
  }

  private async openQuickQuote(page: Page): Promise<void> {
    const sender = this.quickQuoteField(page, 'senderZip');
    if (!(await sender.isVisible())) await this.quoteButton(page).click();
    await sender.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
    await this.quickQuoteField(page, 'deliveryZip').waitFor({
      state: 'visible',
      timeout: LOGIN_TIMEOUT_MS,
    });
  }

  private assertQuickQuoteInput(job: LeasedQuote): void {
    const provider = job.input.providers.find(
      (entry) => entry.code === 'unishippers',
    );
    if (
      !provider ||
      job.sender.mode !== 'explicit' ||
      job.sender.address.country !== 'US' ||
      job.input.destination.country !== 'US' ||
      provider.options.signature !== 'none' ||
      provider.options.insurance !== null ||
      job.input.international ||
      !unishippersQuickQuoteDateSupported(job.input) ||
      job.input.packageGroups.some((group) =>
        [group.length, group.width, group.height].some((value) => value === ''),
      )
    )
      throw new UnishippersContractError();
  }

  private async fillQuickQuoteGroup(
    page: Page,
    job: LeasedQuote,
    packageGroupPosition: number,
  ): Promise<void> {
    const group = job.input.packageGroups[packageGroupPosition];
    if (!group) throw new UnishippersContractError();
    const values = {
      senderZip: job.sender.address.postalCode,
      deliveryZip: job.input.destination.postalCode,
      'quick-quote-length-input': toProviderLength(group.length, group.units),
      'ups-package-type-width-input': toProviderLength(
        group.width,
        group.units,
      ),
      'ups-package-type-height-input': toProviderLength(
        group.height,
        group.units,
      ),
      'ups-package-type-weight-input': toProviderWeight(
        group.weight,
        group.units,
      ),
    };

    for (const [id, value] of Object.entries(values)) {
      const field = this.quickQuoteField(page, id);
      await field.fill(
        id.endsWith('Zip') ? value : new QuoteDecimal(value).toString(),
      );
      if (id.endsWith('Zip')) {
        if ((await field.inputValue()).trim() !== value.trim())
          throw new UnishippersContractError();
      } else if (!new QuoteDecimal(await field.inputValue()).equals(value))
        throw new UnishippersContractError();
    }
  }

  private async captureQuickQuote(
    page: Page,
    job: LeasedQuote,
    packageGroupPosition: number,
  ): Promise<QuickQuoteCapture> {
    await this.openQuickQuote(page);
    await this.fillQuickQuoteGroup(page, job, packageGroupPosition);
    const response = page.waitForResponse(
      (candidate) => {
        const request = candidate.request();
        if (
          request.method() !== 'POST' ||
          new URL(candidate.url()).origin !== this.origin ||
          new URL(candidate.url()).pathname !== '/svc/shopFlow'
        )
          return false;
        try {
          return matchesUnishippersQuickQuoteRequest(
            request.postDataJSON(),
            job,
            packageGroupPosition,
          );
        } catch {
          return false;
        }
      },
      { timeout: RATE_TIMEOUT_MS },
    );
    void response.catch(() => undefined);
    const submit = page
      .locator('#quickQuoteButton:visible')
      .or(page.getByRole('button', { name: /^get quote$/i }))
      .first();
    await submit.click();
    const captured = await response;
    const request = captured.request();

    return {
      body: request.postDataJSON(),
      headers: replayHeaders(request),
      response: {
        status: captured.status(),
        body: parseBody(await captured.text()),
      },
    };
  }

  private async replayQuickQuote(
    page: Page,
    captured: QuickQuoteCapture,
    job: LeasedQuote,
    packageGroupPosition: number,
  ): Promise<{ status: number; body: unknown }> {
    const payload = buildUnishippersQuickQuoteReplay(
      captured.body,
      job,
      packageGroupPosition,
    );
    const response = await page.evaluate(
      async ({ headers, payload }) => {
        const result = await fetch('/svc/shopFlow', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(payload),
        });

        return { status: result.status, text: await result.text() };
      },
      { headers: captured.headers, payload },
    );

    return { status: response.status, body: parseBody(response.text) };
  }

  private async quickQuote(
    page: Page,
    job: LeasedQuote,
  ): Promise<ExecutionResult> {
    this.assertQuickQuoteInput(job);
    const grouped = new Map<
      string,
      {
        packageGroupPosition: number;
        groups: Array<{ packageGroupPosition: number; quantity: number }>;
      }
    >();
    job.input.packageGroups.forEach((group, packageGroupPosition) => {
      const signature = unishippersQuickQuoteSignature(
        job,
        packageGroupPosition,
      );
      const existing = grouped.get(signature);
      if (existing)
        existing.groups.push({
          packageGroupPosition,
          quantity: group.quantity,
        });
      else
        grouped.set(signature, {
          packageGroupPosition,
          groups: [{ packageGroupPosition, quantity: group.quantity }],
        });
    });
    const uniqueGroups = Array.from(grouped.values());
    const first = uniqueGroups[0];
    if (!first) throw new UnishippersContractError();

    const captured = await this.captureQuickQuote(
      page,
      job,
      first.packageGroupPosition,
    );
    const batches = [];
    for (const [index, entry] of uniqueGroups.entries()) {
      const response =
        index === 0
          ? captured.response
          : await this.replayQuickQuote(
              page,
              captured,
              job,
              entry.packageGroupPosition,
            );
      const failure = unishippersFailure(response.status, response.body);
      if (failure) return failure;
      const quotes = normalizeUnishippersOffers(response.body, 1, 'included');
      batches.push({
        groups: entry.groups,
        quotes,
      });
    }

    return {
      outcome: 'success',
      reason: null,
      simulated: false,
      relogins: 0,
      quotes: aggregateUnishippersQuickQuoteRates(batches),
    };
  }

  async readiness(_mode: 'request' | 'browser'): Promise<void> {
    const page = await this.getPage();
    await guardReadinessPage(page, this.origin);
    await this.login(page);
    await this.openQuickQuote(page);
    for (const id of [
      'senderZip',
      'deliveryZip',
      'quick-quote-length-input',
      'ups-package-type-width-input',
      'ups-package-type-height-input',
      'ups-package-type-weight-input',
      'quickQuoteButton',
    ])
      await this.quickQuoteField(page, id).waitFor({ state: 'visible' });
  }

  async quote(job: LeasedQuote, signal: AbortSignal): Promise<ExecutionResult> {
    try {
      signal.throwIfAborted();
      const { page, guard } = await this.guardedLogin();
      try {
        const result = await this.quickQuote(page, job);
        signal.throwIfAborted();

        return result;
      } finally {
        await page.unroute('**/*', guard).catch(() => undefined);
      }
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
    const { page, guard } = await this.guardedLogin(true);
    await page.unroute('**/*', guard).catch(() => undefined);
  }

  async close(_job?: LeasedQuote): Promise<void> {
    this.page = undefined;
    this.context = undefined;
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close();
  }
}
