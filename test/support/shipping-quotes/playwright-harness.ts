import type { Locator, Page, Response } from 'playwright';
import {
  ProviderAuthenticationChallenge,
  ProviderAuthenticationExpired,
  ProviderContractBlocker,
  type ProviderCode,
  type ProviderCredentials,
  type QuoteInput,
  type QuoteResult,
  safeHeaderNames,
} from './provider-contracts.js';

const LOGIN_TIMEOUT_MS = 30_000;
const LOGIN_CONTROL_TIMEOUT_MS = 5_000;
const AUTH_CHECK_TIMEOUT_MS = 1_000;

export type LoginDiagnostics = {
  provider: ProviderCode;
  finalPath: string;
  challengeDetected: boolean;
};

export type ProviderHarness = {
  readonly provider: ProviderCode;
  checkAuthentication(page: Page): Promise<boolean>;
  login(
    page: Page,
    credentials: ProviderCredentials,
    options?: { force?: boolean },
  ): Promise<LoginDiagnostics>;
  requestQuote(
    page: Page,
    input: QuoteInput,
    credentials: ProviderCredentials,
  ): Promise<QuoteResult>;
  browserQuote(
    page: Page,
    input: QuoteInput,
    credentials: ProviderCredentials,
  ): Promise<QuoteResult>;
};

async function authenticationChallenge(page: Page): Promise<boolean> {
  const path = pagePath(page);
  if (path.startsWith('/ap/cvf/')) return true;

  try {
    const handle = await page.waitForFunction(
      () => ({
        title: document.title.toLowerCase(),
        body: (document.body?.innerText ?? '').toLowerCase(),
        hasChallengeControl: Boolean(
          document.querySelector(
            'input[name*="captcha" i], input[name*="otp" i], input[name*="mfa" i], iframe[title*="challenge" i]',
          ),
        ),
      }),
      undefined,
      { timeout: AUTH_CHECK_TIMEOUT_MS },
    );
    const { title, body, hasChallengeControl } = (await handle.jsonValue()) as {
      title: string;
      body: string;
      hasChallengeControl: boolean;
    };

    if (hasChallengeControl) return true;
    return (
      /authentication required|security verification/.test(
        `${title} ${body}`,
      ) ||
      /captcha|verify (?:that )?you are human|one-time password|multi-factor|mfa challenge|additional verification/.test(
        body,
      )
    );
  } catch {
    // The provider may be between redirects or still loading its bootstrap.
    return false;
  }
}

function pagePath(page: Page): string {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return '<invalid-url>';
  }
}

function errorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
  )
    return error.name;
  return undefined;
}

async function ensureNoChallenge(
  page: Page,
  provider: ProviderCode,
): Promise<void> {
  if (await authenticationChallenge(page))
    throw new ProviderAuthenticationChallenge(provider);
}

async function waitForQuoteForm(
  page: Page,
  provider: ProviderCode,
  pattern: RegExp,
): Promise<void> {
  try {
    await firstLabel(page, pattern).waitFor({
      timeout: LOGIN_CONTROL_TIMEOUT_MS,
    });
  } catch (error) {
    if (errorName(error) === 'TimeoutError')
      throw new ProviderContractBlocker(
        provider,
        'the authenticated quote page did not render its origin control',
      );
    throw error;
  }
}

async function navigateToLogin(
  page: Page,
  provider: ProviderCode,
  url: string,
): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: LOGIN_TIMEOUT_MS,
    });
  } catch (error) {
    if (pagePath(page).startsWith('/ap/cvf/'))
      throw new ProviderAuthenticationChallenge(provider);
    if (errorName(error) === 'TimeoutError')
      throw new ProviderContractBlocker(
        provider,
        'the provider login navigation did not settle before the timeout',
      );
    throw error;
  }
}

async function readResponse(response: Response): Promise<{
  status: number;
  body: unknown;
  endpointPath: string;
  requestHeaderNames: string[];
}> {
  const content = await response.text();
  let body: unknown = content;

  try {
    body = JSON.parse(content);
  } catch {
    // Keep the body as text for a provider validation page. Callers only log
    // the status and a sanitized summary, never the raw content.
  }

  return {
    status: response.status(),
    body,
    endpointPath: new URL(response.url()).pathname,
    requestHeaderNames: safeHeaderNames(response.request().headers()),
  };
}

function throwIfAuthenticationExpired(
  provider: ProviderCode,
  status: number,
): void {
  if (status === 401 || status === 403)
    throw new ProviderAuthenticationExpired(provider);
}

async function textOrEmpty(locator: ReturnType<Page['locator']>) {
  return (await locator.count()) > 0 ? await locator.first().innerText() : '';
}

function firstLabel(page: Page, pattern: RegExp) {
  return page.getByLabel(pattern).first();
}

async function requiredControl(
  locator: Locator,
  provider: ProviderCode,
  message: string,
): Promise<Locator> {
  try {
    await locator.waitFor({
      state: 'attached',
      timeout: LOGIN_CONTROL_TIMEOUT_MS,
    });
    return locator;
  } catch {
    throw new ProviderContractBlocker(provider, message);
  }
}

type AmazonSession = {
  merchantId: string;
  proposalId: string;
  headers: Record<string, string>;
};

type AmazonBootstrap =
  | { state: 'authenticated'; session: AmazonSession }
  | { state: 'expired' | 'unavailable' };

export class AmazonContractHarness implements ProviderHarness {
  readonly provider = 'amazon' as const;
  private readonly sessions = new WeakMap<Page, AmazonSession>();

  constructor(readonly origin = 'https://ship.amazon.com') {}

  private loginEmail(page: Page): Locator {
    return page
      .locator(
        'input#ap_email:visible, input[type="email"]:visible, input[name="email"]:visible',
      )
      .first();
  }

  private captureBootstrap(page: Page): Promise<AmazonBootstrap> {
    this.sessions.delete(page);
    return page
      .waitForResponse(
        (response) =>
          new URL(response.url()).origin === this.origin &&
          new URL(response.url()).pathname ===
            '/hz/getLatestProposalSharedWithShipper',
        { timeout: LOGIN_TIMEOUT_MS },
      )
      .then(async (response): Promise<AmazonBootstrap> => {
        if (response.status() === 401 || response.status() === 403)
          return { state: 'expired' };
        if (!response.ok()) return { state: 'unavailable' };
        const body = (await response.json()) as {
          rateCardProposal?: {
            merchantId?: unknown;
            simulatedShipperId?: unknown;
          };
        };
        const merchantId = body.rateCardProposal?.merchantId;
        const proposalId = body.rateCardProposal?.simulatedShipperId;
        const xsrf = response.request().headers()['x-xsrf-token'];
        if (
          typeof merchantId !== 'string' ||
          !merchantId ||
          typeof proposalId !== 'string' ||
          !proposalId ||
          !xsrf
        )
          return { state: 'unavailable' };
        const session = {
          merchantId,
          proposalId,
          headers: { 'content-type': 'application/json', 'x-xsrf-token': xsrf },
        };
        this.sessions.set(page, session);
        return { state: 'authenticated', session };
      })
      .catch((): AmazonBootstrap => ({ state: 'unavailable' }));
  }

  private async waitForEntryPage(page: Page): Promise<void> {
    const entry = firstLabel(page, /origin.*postal/i)
      .or(page.getByRole('button', { name: /^view$/i }))
      .or(page.getByRole('button', { name: /^calculate rates$/i }))
      .or(this.loginEmail(page))
      .filter({ visible: true })
      .first();
    try {
      await entry.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      await ensureNoChallenge(page, this.provider);
      throw new ProviderContractBlocker(
        this.provider,
        'the session check rendered neither a login form nor the rates entry page',
      );
    }
    await ensureNoChallenge(page, this.provider);
  }

  private async openCalculator(page: Page): Promise<void> {
    // The URL can update before the new document renders its rates controls.
    await firstLabel(page, /origin.*postal/i)
      .or(page.getByRole('button', { name: /^view$/i }))
      .or(page.getByRole('button', { name: /^calculate rates$/i }))
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
    if (await firstLabel(page, /origin.*postal/i).isVisible()) return;
    const view = page.getByRole('button', { name: /^view$/i });
    if (await view.isVisible()) await view.click();
    const calculate = page.getByRole('button', { name: /^calculate rates$/i });
    await calculate
      .or(firstLabel(page, /origin.*postal/i))
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
    if (!(await firstLabel(page, /origin.*postal/i).isVisible()))
      await calculate.click();
    await waitForQuoteForm(page, this.provider, /origin.*postal/i);
  }

  private async requireBootstrap(
    pending: Promise<AmazonBootstrap>,
  ): Promise<void> {
    const result = await pending;
    if (result.state === 'expired')
      throw new ProviderAuthenticationExpired(this.provider);
    if (result.state !== 'authenticated')
      throw new ProviderContractBlocker(
        this.provider,
        'the proposal bootstrap did not supply current identifiers and XSRF context',
      );
  }

  async checkAuthentication(page: Page): Promise<boolean> {
    const bootstrap = this.captureBootstrap(page);
    const response = await page.goto(
      `${this.origin}/getstarted/progress?show=rates`,
      { waitUntil: 'domcontentloaded', timeout: LOGIN_TIMEOUT_MS },
    );
    await ensureNoChallenge(page, this.provider);
    if (response?.status() === 401 || response?.status() === 403) return false;
    if (!response?.ok())
      throw new ProviderContractBlocker(
        this.provider,
        'the session check page was unavailable',
      );
    await this.waitForEntryPage(page);
    if (await this.loginEmail(page).isVisible()) return false;
    if (
      new URL(page.url()).origin !== this.origin ||
      pagePath(page) !== '/getstarted/progress'
    )
      throw new ProviderContractBlocker(
        this.provider,
        'the session check ended on an unexpected page',
      );
    await this.openCalculator(page);
    const result = await bootstrap;
    if (result.state === 'expired') return false;
    if (result.state !== 'authenticated')
      throw new ProviderContractBlocker(
        this.provider,
        'the proposal bootstrap did not supply current identifiers and XSRF context',
      );
    return true;
  }

  async login(
    page: Page,
    credentials: ProviderCredentials,
    options: { force?: boolean } = {},
  ): Promise<LoginDiagnostics> {
    if (!options.force && (await this.checkAuthentication(page)))
      return {
        provider: this.provider,
        finalPath: pagePath(page),
        challengeDetected: false,
      };
    const bootstrap = this.captureBootstrap(page);
    if (options.force || !(await this.loginEmail(page).isVisible()))
      await navigateToLogin(
        page,
        this.provider,
        `${this.origin}/getstarted/progress?show=rates`,
      );
    await this.waitForEntryPage(page);
    if (await this.loginEmail(page).isVisible()) {
      await this.loginEmail(page).fill(credentials.email);
      await page
        .getByRole('button', { name: /continue/i })
        .first()
        .click();
      await ensureNoChallenge(page, this.provider);
      const password = await requiredControl(
        page
          .locator(
            'input#ap_password, input[type="password"], input[name="password"]',
          )
          .first(),
        this.provider,
        'the login page did not expose a password control',
      );
      await password.fill(credentials.password);
      await page
        .getByRole('button', { name: /sign in/i })
        .first()
        .click();
      try {
        await page.waitForURL(
          (url) =>
            url.pathname === '/getstarted/progress' ||
            url.pathname.startsWith('/ap/cvf/'),
          { timeout: LOGIN_TIMEOUT_MS },
        );
      } catch (error) {
        await ensureNoChallenge(page, this.provider);
        throw error;
      }
    }
    await ensureNoChallenge(page, this.provider);
    await this.waitForEntryPage(page);
    await this.openCalculator(page);
    await this.requireBootstrap(bootstrap);
    return {
      provider: this.provider,
      finalPath: pagePath(page),
      challengeDetected: false,
    };
  }

  private session(page: Page): AmazonSession {
    const session = this.sessions.get(page);
    if (!session)
      throw new ProviderContractBlocker(
        this.provider,
        'no verified proposal context exists for this browser page',
      );
    return session;
  }

  async requestQuote(
    page: Page,
    input: QuoteInput,
    credentials: ProviderCredentials,
  ): Promise<QuoteResult> {
    return runAuthenticated(this, page, credentials, () =>
      this.requestQuoteInSession(page, input),
    );
  }

  private async requestQuoteInSession(
    page: Page,
    input: QuoteInput,
  ): Promise<QuoteResult> {
    const session = this.session(page);
    const result = await page.evaluate(
      async ({ input, session }) => {
        const endpoint = new URL('/shipping-rates/getRates', location.origin);
        endpoint.searchParams.set('merchantId', session.merchantId);
        endpoint.searchParams.set('simulatedShipperId', session.proposalId);
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: session.headers,
          body: JSON.stringify({
            originZip: input.originZip,
            destinationZip: input.destinationZip,
            length: input.length,
            width: input.width,
            height: input.height,
            weight: input.weight,
            serviceCode: 'swa-us-mfn',
          }),
        });
        return {
          status: response.status,
          body: await response.text(),
          endpointPath: endpoint.pathname,
          requestHeaderNames: Object.keys(session.headers),
        };
      },
      { input, session },
    );
    throwIfAuthenticationExpired(this.provider, result.status);
    let body: unknown = result.body;
    try {
      body = JSON.parse(result.body);
    } catch {
      /* Preserve opaque provider errors in memory only. */
    }
    return {
      ...result,
      body,
      identifiers: {
        merchantId: session.merchantId,
        proposalId: session.proposalId,
      },
    };
  }

  async browserQuote(
    page: Page,
    input: QuoteInput,
    credentials: ProviderCredentials,
  ): Promise<QuoteResult> {
    return runAuthenticated(this, page, credentials, () =>
      this.browserQuoteInSession(page, input),
    );
  }

  private async browserQuoteInSession(
    page: Page,
    input: QuoteInput,
  ): Promise<QuoteResult> {
    const session = this.session(page);
    await this.openCalculator(page);
    await firstLabel(page, /origin.*postal/i).fill(input.originZip);
    await firstLabel(page, /destination.*postal/i).fill(input.destinationZip);
    await firstLabel(page, /^length/i).fill(String(input.length));
    await firstLabel(page, /^width/i).fill(String(input.width));
    await firstLabel(page, /^height/i).fill(String(input.height));
    await firstLabel(page, /^weight/i).fill(String(input.weight));
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/shipping-rates/getRates' &&
          response.request().method() === 'POST',
        { timeout: LOGIN_TIMEOUT_MS },
      ),
      page.getByRole('button', { name: /estimate rate/i }).click(),
    ]);
    const result = await readResponse(response);
    throwIfAuthenticationExpired(this.provider, result.status);
    return {
      ...result,
      identifiers: {
        merchantId: session.merchantId,
        proposalId: session.proposalId,
      },
    };
  }
}

type UnishippersSession = {
  namespace: string;
  headers: Record<string, string>;
};

type UnishippersBootstrap =
  | { state: 'authenticated'; session: UnishippersSession }
  | { state: 'expired' | 'unavailable' };

export class UnishippersContractHarness implements ProviderHarness {
  readonly provider = 'unishippers' as const;
  private readonly sessions = new WeakMap<Page, UnishippersSession>();

  constructor(readonly origin = 'https://www.myunishippers.com') {}

  private loginEmail(page: Page): Locator {
    // The shipping form also has a contact-email field. It is not a login form.
    return page.locator('#username, input[name="username"]').first();
  }

  private quoteButton(page: Page): Locator {
    return page.getByRole('button', { name: /^quick quote$/i });
  }

  private captureBootstrap(page: Page): Promise<UnishippersBootstrap> {
    this.sessions.delete(page);
    const sessionHeaders = page
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
      .then((request) => request.headers())
      .catch(() => undefined);
    return page
      .waitForResponse(
        (response) =>
          new URL(response.url()).origin === this.origin &&
          new URL(response.url()).pathname === '/svc/getUserProfileFlow',
        { timeout: LOGIN_TIMEOUT_MS },
      )
      .then(async (response): Promise<UnishippersBootstrap> => {
        if (response.status() === 401 || response.status() === 403)
          return { state: 'expired' };
        if (!response.ok()) return { state: 'unavailable' };
        const body = (await response.json()) as {
          clientStatus?: { success?: boolean };
          response?: { orgUnit?: { namespace?: unknown } };
        };
        const namespace = body.response?.orgUnit?.namespace;
        const nativeHeaders = await sessionHeaders;
        if (
          body.clientStatus?.success !== true ||
          typeof namespace !== 'string' ||
          !namespace ||
          !nativeHeaders?.authorization ||
          !nativeHeaders?.['x-session-token']
        )
          return { state: 'unavailable' };
        const session = {
          namespace,
          headers: {
            'content-type': 'application/json',
            authorization: nativeHeaders.authorization,
            'x-session-token': nativeHeaders['x-session-token'],
            ...(nativeHeaders.cachettl
              ? { cachettl: nativeHeaders.cachettl }
              : {}),
          },
        };
        this.sessions.set(page, session);
        return { state: 'authenticated', session };
      })
      .catch((): UnishippersBootstrap => ({ state: 'unavailable' }));
  }

  private async waitForEntryPage(page: Page): Promise<void> {
    try {
      await this.quoteButton(page).or(this.loginEmail(page)).first().waitFor({
        state: 'visible',
        timeout: 10_000,
      });
    } catch {
      await ensureNoChallenge(page, this.provider);
      throw new ProviderContractBlocker(
        this.provider,
        'the session check rendered neither a login form nor authenticated account context',
      );
    }
    await ensureNoChallenge(page, this.provider);
  }

  private async requireBootstrap(
    pending: Promise<UnishippersBootstrap>,
  ): Promise<void> {
    const bootstrap = await pending;
    if (bootstrap.state === 'expired')
      throw new ProviderAuthenticationExpired(this.provider);
    if (bootstrap.state !== 'authenticated')
      throw new ProviderContractBlocker(
        this.provider,
        'the authenticated profile did not supply current namespace and request headers',
      );
  }

  async checkAuthentication(page: Page): Promise<boolean> {
    const bootstrap = this.captureBootstrap(page);
    const response = await page.goto(`${this.origin}/ship/small-package`, {
      waitUntil: 'domcontentloaded',
      timeout: LOGIN_TIMEOUT_MS,
    });
    await ensureNoChallenge(page, this.provider);
    if (response?.status() === 401 || response?.status() === 403) return false;
    if (!response?.ok())
      throw new ProviderContractBlocker(
        this.provider,
        'the session check page was unavailable',
      );
    await this.waitForEntryPage(page);
    if (!(await this.quoteButton(page).isVisible())) return false;
    if (
      new URL(page.url()).origin !== this.origin ||
      pagePath(page) !== '/ship/small-package'
    )
      throw new ProviderContractBlocker(
        this.provider,
        'the session check ended on an unexpected page',
      );
    const result = await bootstrap;
    if (result.state === 'expired') return false;
    if (result.state !== 'authenticated')
      throw new ProviderContractBlocker(
        this.provider,
        'the authenticated profile did not supply current namespace and request headers',
      );
    return true;
  }

  async login(
    page: Page,
    credentials: ProviderCredentials,
    options: { force?: boolean } = {},
  ): Promise<LoginDiagnostics> {
    if (!options.force && (await this.checkAuthentication(page)))
      return {
        provider: this.provider,
        finalPath: pagePath(page),
        challengeDetected: false,
      };

    const bootstrap = this.captureBootstrap(page);
    if (options.force || !(await this.loginEmail(page).isVisible()))
      await navigateToLogin(
        page,
        this.provider,
        `${this.origin}/ship/small-package`,
      );
    await this.waitForEntryPage(page);
    if (!(await this.quoteButton(page).isVisible())) {
      await this.loginEmail(page).fill(credentials.email);
      await page
        .getByRole('button', { name: /continue/i })
        .first()
        .click();
      await ensureNoChallenge(page, this.provider);
      const password = await requiredControl(
        page.locator('input[type="password"], input[name="password"]').first(),
        this.provider,
        'the login page did not expose a password control',
      );
      await password.fill(credentials.password);
      await page
        .getByRole('button', { name: /continue|log in|sign in/i })
        .first()
        .click();
    }
    try {
      await this.quoteButton(page).waitFor({
        state: 'visible',
        timeout: LOGIN_TIMEOUT_MS,
      });
    } catch (error) {
      await ensureNoChallenge(page, this.provider);
      throw error;
    }
    await ensureNoChallenge(page, this.provider);
    await this.requireBootstrap(bootstrap);
    return {
      provider: this.provider,
      finalPath: pagePath(page),
      challengeDetected: false,
    };
  }

  private session(page: Page): UnishippersSession {
    const session = this.sessions.get(page);
    if (!session)
      throw new ProviderContractBlocker(
        this.provider,
        'no verified profile context exists for this browser page',
      );
    return session;
  }

  async requestQuote(
    page: Page,
    input: QuoteInput,
    credentials: ProviderCredentials,
  ): Promise<QuoteResult> {
    return runAuthenticated(this, page, credentials, () =>
      this.requestQuoteInSession(page, input),
    );
  }

  private async requestQuoteInSession(
    page: Page,
    input: QuoteInput,
  ): Promise<QuoteResult> {
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 50
    )
      throw new ProviderContractBlocker(
        this.provider,
        'package quantity must be an integer from 1 to 50',
      );
    const session = this.session(page);
    const result = await page.evaluate(
      async ({ input, session }) => {
        // ESTIMATE ignores a quantity property; one native handling unit is
        // required per package. Use the returned whole-shipment total unchanged.
        const unit = {
          billedDimension: {
            length: { value: String(input.length), unit: 'in' },
            width: { value: String(input.width), unit: 'in' },
            height: { value: String(input.height), unit: 'in' },
            dimensionType: 'NET',
          },
          weight: { value: String(input.weight), unit: 'LB' },
          packagingType: '02',
          packagingTypeName: 'Custom',
        };
        const response = await fetch('/svc/shopFlow', {
          method: 'POST',
          credentials: 'include',
          headers: session.headers,
          body: JSON.stringify({
            request: {
              productType: 'SMALLPACK',
              mode: 'ESTIMATE',
              shipment: {
                handlingCharge: null,
                originAddress: {
                  address: { postalCode: input.originZip, countryCode: 'US' },
                },
                destinationAddress: {
                  address: {
                    postalCode: input.destinationZip,
                    countryCode: input.country,
                  },
                },
                handlingUnitList: Array.from(
                  { length: input.quantity },
                  () => unit,
                ),
                residentialDeliveryFlag: null,
              },
            },
            correlationId: crypto.randomUUID(),
            showSpinner: false,
            orgInfo: { namespace: session.namespace },
          }),
        });
        return {
          status: response.status,
          body: await response.text(),
          endpointPath: '/svc/shopFlow',
          requestHeaderNames: Object.keys(session.headers),
        };
      },
      { input, session },
    );
    throwIfAuthenticationExpired(this.provider, result.status);
    let body: unknown = result.body;
    try {
      body = JSON.parse(result.body);
    } catch {
      /* Keep opaque validation content in memory only. */
    }
    return { ...result, body, identifiers: { namespace: session.namespace } };
  }

  async browserQuote(
    page: Page,
    input: QuoteInput,
    credentials: ProviderCredentials,
  ): Promise<QuoteResult> {
    return runAuthenticated(this, page, credentials, () =>
      this.browserQuoteInSession(page, input),
    );
  }

  private async browserQuoteInSession(
    page: Page,
    input: QuoteInput,
  ): Promise<QuoteResult> {
    if (input.quantity !== 1 || input.country !== 'US')
      throw new ProviderContractBlocker(
        this.provider,
        'the native Quick Quote dialog supports one domestic package; this mode cannot represent the requested input',
      );
    const session = this.session(page);
    await this.quoteButton(page).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Sender Zip', { exact: true })
      .fill(input.originZip);
    await dialog
      .getByLabel('Delivery Zip', { exact: true })
      .fill(input.destinationZip);
    await dialog
      .getByLabel('Length', { exact: true })
      .fill(String(input.length));
    await dialog.getByLabel('Width', { exact: true }).fill(String(input.width));
    await dialog
      .getByLabel('Height', { exact: true })
      .fill(String(input.height));
    await dialog
      .getByLabel('Weight', { exact: true })
      .fill(String(input.weight));
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/svc/shopFlow' &&
          response.request().method() === 'POST',
        { timeout: LOGIN_TIMEOUT_MS },
      ),
      dialog.getByRole('button', { name: /^get quote$/i }).click(),
    ]);
    const result = await readResponse(response);
    throwIfAuthenticationExpired(this.provider, result.status);
    return { ...result, identifiers: { namespace: session.namespace } };
  }
}

async function runAuthenticated<T>(
  harness: ProviderHarness,
  page: Page,
  credentials: ProviderCredentials,
  operation: () => Promise<T>,
): Promise<T> {
  // login() checks the current session first and reuses it when still valid.
  await harness.login(page, credentials);
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ProviderAuthenticationExpired)) throw error;
    await harness.login(page, credentials, { force: true });
    return operation();
  }
}

export async function loginAndOpen(
  harness: ProviderHarness,
  page: Page,
  credentials: ProviderCredentials,
): Promise<LoginDiagnostics> {
  return harness.login(page, credentials);
}

export async function safeVisibleText(page: Page): Promise<string> {
  return textOrEmpty(page.locator('body')).then((value) =>
    value.replace(/\s+/g, ' ').trim().slice(0, 200),
  );
}
