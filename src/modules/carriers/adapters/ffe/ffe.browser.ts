import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from 'playwright';
import { FfeBrowserNetwork } from './ffe.browser-network.js';
import type { FfeSettings } from './ffe.config.js';
import { FfeFailure } from './ffe.failure.js';
import { mapFfe } from './ffe.mapping.js';
import {
  assertResponse,
  DATA_PATH,
  LOGIN_PATH,
  MAX_BODY_BYTES,
  searchPage,
  TIMEOUT_MS,
  TRACKING_PATH,
  type FfeSessionOptions,
} from './ffe.protocol.js';

export type FfeBrowserLauncher = (settings: FfeSettings) => Promise<Browser>;

export const launchFfeBrowser: FfeBrowserLauncher = (settings) =>
  chromium.launch({
    headless: true,
    executablePath: settings.executablePath,
    timeout: TIMEOUT_MS,
  });

/** Only user-interface actions generate tracking requests; no request-client fallback. */
export class FfeBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private pageClosing?: Promise<void>;
  private closed = false;
  private authenticated = false;
  private authenticationFailed = false;
  private network?: FfeBrowserNetwork;
  private readonly abortController = new AbortController();
  private readonly abort = () => {
    void this.close().catch(() => undefined);
  };

  constructor(
    private readonly options: FfeSessionOptions,
    private readonly launch: FfeBrowserLauncher,
  ) {}

  async login(signal: AbortSignal) {
    this.options.signal.addEventListener('abort', this.abort, { once: true });
    signal.throwIfAborted();
    this.browser = await this.launch(this.options.settings);

    if (this.closed || signal.aborted) {
      await this.browser.close();
      signal.throwIfAborted();

      throw new FfeFailure('FFE_SESSION_CLOSED');
    }

    this.context = await this.browser.newContext({ serviceWorkers: 'block' });

    const { page, network } = await this.createPage();

    try {
      await network.wait(
        page.goto(`${this.options.settings.origin}${LOGIN_PATH}`, {
          waitUntil: 'domcontentloaded',
          timeout: 0,
        }),
      );

      const form = page
        .locator('form')
        .filter({ has: page.locator('#UserName') });

      if ((await form.getAttribute('action')) !== LOGIN_PATH)
        throw new FfeFailure('FFE_AUTHENTICATION_FAILED');

      await page.locator('#UserName').fill(this.options.settings.username);
      await page.locator('#Password').fill(this.options.settings.password);
      await page
        .getByRole('button', { name: 'Login', exact: true })
        .click({ noWaitAfter: true });
      await network.wait(
        page.waitForURL(`${this.options.settings.origin}/Customer`, {
          timeout: 0,
        }),
      );
      await this.verify();
      this.authenticated = true;
    } catch (error) {
      throw network.failure ?? error;
    }
  }

  private async createPage() {
    this.network?.close();
    this.pageClosing = undefined;

    const page = await this.context!.newPage();
    const network = new FfeBrowserNetwork(this.options, () => {
      network.close();
      this.pageClosing = page.close().catch(() => undefined);
    });

    this.page = page;
    this.network = network;
    await network.attach(
      page,
      AbortSignal.any([this.options.signal, this.abortController.signal]),
    );
    page.setDefaultTimeout(TIMEOUT_MS);
    page.setDefaultNavigationTimeout(TIMEOUT_MS);
    page.on('framenavigated', (frame) => {
      if (
        this.authenticated &&
        frame === page.mainFrame() &&
        new URL(frame.url()).pathname === LOGIN_PATH
      )
        this.authenticationFailed = true;
    });
    page.on('response', (response) => {
      if (
        this.authenticated &&
        new URL(response.url()).origin === this.options.settings.origin &&
        [401, 403].includes(response.status())
      )
        this.authenticationFailed = true;
    });

    return { page, network };
  }

  private async verify() {
    const response = await this.network!.wait(
      this.page!.goto(`${this.options.settings.origin}${TRACKING_PATH}`, {
        waitUntil: 'domcontentloaded',
        timeout: 0,
      }),
    );

    if (
      this.authenticationFailed ||
      new URL(this.page!.url()).pathname === LOGIN_PATH ||
      (await this.page!.locator('#UserName').count())
    )
      throw new FfeFailure('FFE_AUTHENTICATION_FAILED');

    if (!response) throw new FfeFailure('FFE_INVALID_RESPONSE');

    assertResponse(
      response.status(),
      response.headers()['content-type'] ?? '',
      'html',
    );
    await this.page!.locator('#shipmentTrackingDataTable').waitFor();
  }

  private response(reference: string) {
    const waiting = this.network!.wait(
      this.page!.waitForResponse(
        (response) => {
          const url = new URL(response.url());

          if (
            url.origin !== this.options.settings.origin ||
            url.pathname !== DATA_PATH ||
            response.request().method() !== 'POST'
          )
            return false;

          try {
            const body = response.request().postDataJSON();

            return (
              body.archiveLimit === '365' &&
              body.start === 0 &&
              body.columns?.[0]?.data === 'orderNumber' &&
              body.columns[0].search.value === reference
            );
          } catch {
            return false;
          }
        },
        { timeout: 0 },
      ),
    );

    void waiting.catch(() => undefined);

    return waiting;
  }

  private async json(response: Response) {
    assertResponse(
      response.status(),
      response.headers()['content-type'] ?? '',
      'json',
    );

    if (Number(response.headers()['content-length']) > MAX_BODY_BYTES)
      throw new FfeFailure('FFE_RESPONSE_TOO_LARGE');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = await Promise.race([
      response.body(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          this.network?.close();
          this.pageClosing = this.page!.close().catch(() => undefined);
          reject(new FfeFailure('FFE_TIMEOUT'));
        }, TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));

    if (body.byteLength > MAX_BODY_BYTES)
      throw new FfeFailure('FFE_RESPONSE_TOO_LARGE');

    const request = response.request().postDataJSON();

    if (
      !Number.isSafeInteger(request.draw) ||
      !Number.isSafeInteger(request.length) ||
      request.length < 1 ||
      request.length > 200
    )
      throw new FfeFailure('FFE_INVALID_RESPONSE');

    return searchPage(
      JSON.parse(body.toString('utf8')),
      request.draw,
      request.length,
    );
  }

  async read(reference: string, signal: AbortSignal) {
    if (this.closed) throw new FfeFailure('FFE_SESSION_CLOSED');

    if (this.authenticationFailed)
      throw new FfeFailure('FFE_AUTHENTICATION_FAILED');

    signal.addEventListener('abort', this.abort, { once: true });

    try {
      signal.throwIfAborted();
      await this.pageClosing;

      // Recover a timed-out page with the existing authenticated context. Never
      // retry the failed reference or perform a second login during this run.
      if (this.page!.isClosed()) await this.createPage();

      await this.verify();

      const archive = this.page!.locator('#archive-toggle-value');

      if ((await archive.inputValue()) !== '365') {
        const changed = this.response('');

        await this.page!.locator('#archive-toggle-button').click();

        try {
          await this.json(await changed);
        } catch (error) {
          if (!this.closed && !this.pageClosing) await this.verify();

          throw error;
        }
      }

      if ((await archive.inputValue()) !== '365')
        throw new FfeFailure('FFE_INVALID_RESPONSE');

      const waiting = this.response(reference);
      const input = this.page!.getByPlaceholder('Order# Search', {
        exact: true,
      });

      await input.fill(reference);
      await input.press('Tab');

      let result: ReturnType<typeof searchPage>;

      try {
        result = await this.json(await waiting);
      } catch (error) {
        if (!this.closed && !this.pageClosing) await this.verify();

        throw error;
      }

      if (this.authenticationFailed)
        throw new FfeFailure('FFE_AUTHENTICATION_FAILED');

      const match = result.data.find((row) => row.orderNumber === reference);

      if (match) return mapFfe(reference, match);

      await this.verify();

      if (result.data.length !== result.recordsFiltered)
        throw new FfeFailure('FFE_INCOMPLETE_SEARCH');

      return { outcome: 'not_found' as const, sourceData: null };
    } catch (error) {
      if (this.network?.failure) {
        await this.pageClosing;

        throw this.network.failure;
      }

      if (this.authenticationFailed)
        throw new FfeFailure('FFE_AUTHENTICATION_FAILED');

      throw error;
    } finally {
      signal.removeEventListener('abort', this.abort);
    }
  }

  async close() {
    this.closed = true;
    this.network?.close();
    this.abortController.abort();
    this.options.signal.removeEventListener('abort', this.abort);
    await this.browser?.close();
  }
}
