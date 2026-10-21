import { randomUUID } from 'node:crypto';
import {
  chromium,
  type Browser,
  type Page,
  type Locator,
  type BrowserContext,
} from 'playwright';
import {
  AmazonShippingAdapter,
  AmazonVerificationRequired,
} from './amazon-quote.adapter.js';
import {
  amazonAuthenticationState,
  type EncryptedAmazonSessionStore,
} from './amazon-session.store.js';
import {
  VerificationError,
  type VerificationAction,
} from './amazon-verification.contract.js';

const challengeSelector =
  '#cvf-page-content, #challenge-container, form[action*="/ap/cvf"], form[action*="/ap/mfa"], form[action*="/ap/challenge"]';
const forbiddenInputs =
  'input[type="password"]:visible, input[type="email"]:visible, input[name="email"]:visible, input[name="password"]:visible';

function challengeFrameUrl(url: URL) {
  return (
    url.protocol === 'https:' &&
    (/(?:^|\.)(?:arkoselabs|funcaptcha)\.com$/.test(url.hostname) ||
      (url.origin === 'https://www.amazon.com' &&
        /^\/(?:ap\/(?:cvf|mfa|challenge)|aaut\/verify\/cvf)(?:\/|$)/.test(
          url.pathname,
        )))
  );
}

export interface VerificationBrowser {
  start(): Promise<void>;
  view(): Promise<
    | { verified: true }
    | { verified: false; preparing: true }
    | {
        verified: false;
        image: string;
        frame: string;
        width: number;
        height: number;
      }
  >;
  act(action: VerificationAction): Promise<void>;
  save(): Promise<void>;
  close(): Promise<void>;
}

/** A challenge-only viewport. No URLs, selectors, JavaScript, credentials or CDP are accepted from staff. */
export class AmazonVerificationBrowser implements VerificationBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private adapter?: AmazonShippingAdapter;
  private frame?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    url: string;
  };
  private closed = false;
  private verified = false;

  constructor(
    private readonly store: EncryptedAmazonSessionStore,
    private readonly launch: () => Promise<Browser> = () =>
      chromium.launch({ headless: true }),
  ) {}

  async start() {
    this.browser = await this.launch();
    if (this.closed) {
      await this.browser.close();
      throw new VerificationError('expired');
    }
    this.context = await this.browser.newContext({
      storageState: await this.store.load(),
      serviceWorkers: 'block',
      viewport: { width: 1100, height: 850 },
      acceptDownloads: false,
    });
    this.context.on('page', (page) => {
      if (this.context!.pages().length > 1)
        void page.close().catch(() => undefined);
    });
    // Permit only the sign-in / verification journey and the read-only Shipping entry.
    await this.context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.isNavigationRequest() &&
        request.frame() === request.frame().page().mainFrame()
      ) {
        const allowed =
          (url.origin === 'https://www.amazon.com' &&
            /^\/ap\/(?:signin|cvf|mfa|challenge)(?:\/|$)/.test(url.pathname)) ||
          (url.origin === 'https://ship.amazon.com' &&
            ['/getstarted/progress', '/'].includes(url.pathname));
        if (!allowed) {
          await route.abort();
          return;
        }
      }
      if (
        request.isNavigationRequest() &&
        request.frame() !== request.frame().page().mainFrame() &&
        !challengeFrameUrl(url)
      ) {
        await route.abort();
        return;
      }
      await route.fallback();
    });
    this.context.on('page', (page) => {
      page.on('framenavigated', (frame) => {
        if (frame.url() === 'about:blank') return;
        const url = new URL(frame.url());
        const allowed =
          frame === page.mainFrame()
            ? (url.origin === 'https://www.amazon.com' &&
                /^\/ap\/(?:signin|cvf|mfa|challenge)(?:\/|$)/.test(
                  url.pathname,
                )) ||
              (url.origin === 'https://ship.amazon.com' &&
                ['/getstarted/progress', '/'].includes(url.pathname))
            : challengeFrameUrl(url);
        if (!allowed) void this.close().catch(() => undefined);
      });
    });
    this.adapter = new AmazonShippingAdapter({ context: this.context });
    try {
      await this.adapter.prepareStaffVerification();
      this.verified = true;
    } catch (error) {
      if (!(error instanceof AmazonVerificationRequired))
        throw new VerificationError('unsupported');
    }
    this.page = this.context.pages()[0];
    if (!this.page || this.closed) throw new VerificationError('expired');
  }

  private async challenge(): Promise<Locator> {
    const page = this.page;
    if (!page || this.closed) throw new VerificationError('expired');
    const url = new URL(page.url());
    if (
      url.origin !== 'https://www.amazon.com' ||
      !/^\/ap\/(?:cvf|mfa|challenge)(?:\/|$)/.test(url.pathname)
    )
      throw new VerificationError('unsupported');
    for (const frame of page.frames()) {
      if (await frame.locator(forbiddenInputs).count())
        throw new VerificationError('unsupported');
      if (frame === page.mainFrame() || frame.url() === 'about:blank') continue;
      const source = new URL(frame.url());
      if (!challengeFrameUrl(source))
        throw new VerificationError('unsupported');
    }
    const area = page.locator(challengeSelector).first();
    if (!(await area.isVisible())) throw new VerificationError('unsupported');
    return area;
  }

  async view() {
    const before = this.page?.url();
    try {
      return await this.capture();
    } catch (error) {
      // Provider redirects can race a screenshot. Discard it and poll again;
      // never report a successful challenge from a redirect alone.
      if (!this.closed && this.page && before !== this.page.url())
        return { verified: false as const, preparing: true as const };
      throw error;
    }
  }

  private async capture() {
    if (this.closed || !this.page) throw new VerificationError('expired');
    this.frame = undefined;
    if (
      !this.verified &&
      new URL(this.page.url()).origin === 'https://ship.amazon.com'
    ) {
      // Revalidate protected bootstrap. A redirect alone is not proof of authentication.
      await this.adapter!.verifySession();
      this.verified = true;
    }
    if (this.verified) return { verified: true as const };
    const area = await this.challenge();
    await area.scrollIntoViewIfNeeded();
    const bounds = await area.boundingBox();
    if (!bounds || bounds.width > 1100 || bounds.height > 2000)
      throw new VerificationError('unsupported');
    const url = this.page.url();
    const image = (
      await area.screenshot({ type: 'png', timeout: 5000 })
    ).toString('base64');
    await this.challenge();
    if (this.page.url() !== url)
      return { verified: false as const, preparing: true as const };
    const current = await area.boundingBox();
    if (!current) throw new VerificationError('stale_frame');
    this.frame = { id: randomUUID(), ...current, url };
    return {
      verified: false as const,
      image,
      frame: this.frame.id,
      width: current.width,
      height: current.height,
    };
  }

  async act(action: VerificationAction) {
    const frame = this.frame;
    const area = await this.challenge();
    if (!frame || frame.id !== action.frame || this.page!.url() !== frame.url)
      throw new VerificationError('stale_frame');
    const bounds = await area.boundingBox();
    if (
      !bounds ||
      Math.abs(bounds.x - frame.x) > 1 ||
      Math.abs(bounds.y - frame.y) > 1 ||
      Math.abs(bounds.width - frame.width) > 1 ||
      Math.abs(bounds.height - frame.height) > 1
    )
      throw new VerificationError('stale_frame');
    this.frame = undefined;
    if (action.type === 'click') {
      const x = bounds.x + action.x * bounds.width;
      const y = bounds.y + action.y * bounds.height;
      const safe = await area.evaluate(
        (root, point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return (
            !!hit &&
            root.contains(hit) &&
            !hit.closest('a, input[type="password"], input[type="email"]')
          );
        },
        { x, y },
      );
      if (!safe) throw new VerificationError('unsupported');
      await this.page!.mouse.click(x, y);
    } else {
      // Only focused controls within the challenge (including its provider iframe).
      const safe = await area.evaluate((root) => {
        const active = document.activeElement;
        return (
          !!active &&
          root.contains(active) &&
          !active.closest('a') &&
          ['INPUT', 'BUTTON', 'IFRAME', 'CANVAS', 'TEXTAREA'].includes(
            active.tagName,
          )
        );
      });
      if (!safe) throw new VerificationError('unsupported');
      if (action.type === 'text')
        await this.page!.keyboard.insertText(action.text);
      else await this.page!.keyboard.press(action.key);
    }
  }

  async save() {
    if (!this.verified || this.closed || !this.context)
      throw new VerificationError('expired');
    const state = await this.context.storageState();
    if (this.closed) throw new VerificationError('expired');
    await this.store.save(amazonAuthenticationState(state));
  }

  async close() {
    this.closed = true;
    this.frame = undefined;
    await this.browser?.close();
  }
}
