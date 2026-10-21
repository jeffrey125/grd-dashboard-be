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
    if (await authenticationChallenge(page))
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
