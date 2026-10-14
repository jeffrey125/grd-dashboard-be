import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
  type Request,
} from 'playwright';
import type { EchoShipSettings } from './echoship.config.js';
import type { EchoShipLimiter } from './echoship.limiter.js';
import { EchoShipFailure } from './echoship.failure.js';
import {
  envelope,
  mapEchoShip,
  MAX_BODY_BYTES,
  SEARCH_PATH,
  searchPage,
  TIMEOUT_MS,
} from './echoship.mapping.js';

export type EchoShipBrowserLauncher = (
  settings: EchoShipSettings,
) => Promise<Browser>;

export const launchEchoShipBrowser: EchoShipBrowserLauncher = (settings) =>
  chromium.launch({
    headless: true,
    executablePath: settings.executablePath,
    timeout: TIMEOUT_MS,
  });

/** Uses navigation-generated responses only; no APIRequestContext or Axios calls. */
export class EchoShipBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private closed = false;
  private readonly sessionAbort = new AbortController();
  private authenticationFailed = false;
  private authenticated = false;
  private readonly authenticatedRequests = new WeakSet<Request>();
  private readonly abort = () => {
    void this.close().catch(() => undefined);
  };

  constructor(
    private readonly settings: EchoShipSettings,
    private readonly launcher: EchoShipBrowserLauncher,
    private readonly limiter: EchoShipLimiter,
    private readonly rpm: number | null,
    private readonly runSignal: AbortSignal,
  ) {}

  async login(signal: AbortSignal) {
    this.runSignal.addEventListener('abort', this.abort, { once: true });
    this.browser = await this.launcher(this.settings);

    if (this.closed || signal.aborted) {
      await this.browser.close();
      signal.throwIfAborted();

      throw new EchoShipFailure('ECHOSHIP_SESSION_CLOSED');
    }

    this.context = await this.browser.newContext({ serviceWorkers: 'block' });
    await this.context.route('**/api/**', async (route) => {
      try {
        await this.limiter.run(
          this.rpm,
          AbortSignal.any([this.runSignal, this.sessionAbort.signal]),
          () => route.continue(),
        );
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(TIMEOUT_MS);
    this.page.setDefaultNavigationTimeout(TIMEOUT_MS);
    this.page.on('request', (request) => {
      if (this.authenticated) this.authenticatedRequests.add(request);
    });
    this.page.on('response', (response) => {
      if (
        this.authenticatedRequests.has(response.request()) &&
        new URL(response.url()).origin === this.settings.origin &&
        new URL(response.url()).pathname.startsWith('/api/') &&
        [401, 403].includes(response.status())
      )
        this.authenticationFailed = true;
    });
    this.page.on('framenavigated', (frame) => {
      if (
        this.authenticated &&
        frame === this.page!.mainFrame() &&
        ['/', '/login'].includes(new URL(frame.url()).pathname)
      )
        this.authenticationFailed = true;
    });
    await this.page.goto(this.settings.loginUrl, {
      waitUntil: 'domcontentloaded',
    });
    await this.page
      .locator('input[name="username"]')
      .fill(this.settings.username);
    await this.page
      .locator('input[name="password"]')
      .fill(this.settings.password);
    await this.page.getByRole('button', { name: 'Login', exact: true }).click();
    await this.page.waitForURL(`${this.settings.origin}/new-quote/ltl`);
    await this.searchHome();
    this.authenticated = true;

    if (this.authenticationFailed)
      throw new EchoShipFailure('ECHOSHIP_AUTHENTICATION_FAILED');
  }

  private async json(response: Response) {
    if ([401, 403].includes(response.status()))
      throw new EchoShipFailure('ECHOSHIP_AUTHENTICATION_FAILED');

    if (
      response.status() !== 200 ||
      !/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(
        response.headers()['content-type'] ?? '',
      )
    )
      throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');

    const length = Number(response.headers()['content-length']);

    if (length > MAX_BODY_BYTES)
      throw new EchoShipFailure('ECHOSHIP_RESPONSE_TOO_LARGE');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = await Promise.race([
      response.body(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void this.close().catch(() => undefined);
          reject(new EchoShipFailure('ECHOSHIP_TIMEOUT'));
        }, TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));

    if (body.byteLength > MAX_BODY_BYTES)
      throw new EchoShipFailure('ECHOSHIP_RESPONSE_TOO_LARGE');

    const data: unknown = JSON.parse(body.toString('utf8'));

    envelope(data);

    return data;
  }

  private response(path: string, search?: string) {
    // Attach rejection handling immediately: page actions may fail before the response arrives.
    const result = this.page!.waitForResponse((response) => {
      const url = new URL(response.url());

      return (
        url.origin === this.settings.origin &&
        url.pathname === path &&
        (search === undefined || url.searchParams.get('searchQuery') === search)
      );
    }).then((response) => this.json(response));

    void result.catch(() => undefined);

    return result;
  }

  private async searchHome() {
    const response = this.response(SEARCH_PATH);

    await this.page!.goto(`${this.settings.origin}/shipments/all`, {
      waitUntil: 'domcontentloaded',
    });
    searchPage(await response);
    await this.page!.locator('input#search-input').waitFor();
  }

  async read(reference: string, signal: AbortSignal) {
    if (this.closed) throw new EchoShipFailure('ECHOSHIP_SESSION_CLOSED');

    if (this.authenticationFailed)
      throw new EchoShipFailure('ECHOSHIP_AUTHENTICATION_FAILED');

    signal.addEventListener('abort', this.abort, { once: true });

    try {
      signal.throwIfAborted();
      await this.searchHome();

      const response = this.response(SEARCH_PATH, reference);

      await this.page!.locator('input#search-input').pressSequentially(
        reference,
        { delay: 50 },
      );

      const search = searchPage(await response);
      const ids = search.results.map((row) => row.id);

      if (
        new Set(ids).size !== ids.length ||
        ids.length > search.totalRecordCount
      )
        throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');

      if (!ids.includes(reference)) {
        // Unknown pagination widgets must not turn a partial page into false absence.
        if (ids.length !== search.totalRecordCount)
          throw new EchoShipFailure('ECHOSHIP_INCOMPLETE_SEARCH');

        return { outcome: 'not_found' as const, sourceData: null };
      }

      const detail = this.response(`/api/v1//loads/${reference}`);
      const tracking = this.response(`/api/v1//loads/${reference}/tracking`);

      await this.page!.getByText(reference, { exact: true }).first().click();
      await this.page!.waitForURL(
        `${this.settings.origin}/shipments/${reference}`,
      );

      const [load, events] = await Promise.all([detail, tracking]);

      // Both transports use the provider API as the authoritative source. Browser
      // mode differs only in how login/navigation obtains these responses; portal
      // DOM text may lag or use a feature-selected location-history projection.
      return mapEchoShip(reference, load, events);
    } catch (error) {
      if (this.authenticationFailed)
        throw new EchoShipFailure('ECHOSHIP_AUTHENTICATION_FAILED');

      throw error;
    } finally {
      signal.removeEventListener('abort', this.abort);
    }
  }

  async close() {
    this.closed = true;
    this.sessionAbort.abort();
    this.runSignal.removeEventListener('abort', this.abort);
    // Browser.close also closes the isolated context, cookies, pages, and pending waits.
    await this.browser?.close();
  }
}
