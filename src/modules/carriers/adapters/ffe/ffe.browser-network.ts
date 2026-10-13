import type { Page } from 'playwright';
import { FfeFailure } from './ffe.failure.js';
import {
  DATA_PATH,
  LOGIN_PATH,
  TIMEOUT_MS,
  TRACKING_PATH,
  type FfeSessionOptions,
} from './ffe.protocol.js';

/** Chromium interception covers every redirect hop, unlike Playwright route handlers. */
export class FfeBrowserNetwork {
  failure?: FfeFailure;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private queued = 0;
  constructor(
    private readonly options: FfeSessionOptions,
    private readonly stop: () => void,
  ) {}

  async attach(page: Page, signal: AbortSignal) {
    const cdp = await page.context().newCDPSession(page);
    const clear = (id: string) => {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    };
    await cdp.send('Network.enable');
    cdp.on('Network.loadingFinished', ({ requestId }: { requestId: string }) =>
      clear(requestId),
    );
    cdp.on('Network.loadingFailed', ({ requestId }: { requestId: string }) =>
      clear(requestId),
    );
    cdp.on(
      'Fetch.requestPaused',
      (event: {
        requestId: string;
        networkId?: string;
        redirectedRequestId?: string;
        resourceType: string;
        request: { url: string; method: string };
      }) => {
        void (async () => {
          // A redirected request reuses its network ID; the preceding hop is done.
          if (event.networkId) clear(event.networkId);
          const url = new URL(event.request.url);
          const protectedRequest =
            ['Document', 'XHR', 'Fetch'].includes(event.resourceType) ||
            event.request.method !== 'GET';
          if (url.origin !== this.options.settings.origin && protectedRequest) {
            await cdp.send('Fetch.failRequest', {
              requestId: event.requestId,
              errorReason: 'BlockedByClient',
            });
            // Optional third-party XHR (for example map telemetry) is blocked,
            // but cannot invalidate otherwise usable first-party tracking.
            if (
              event.resourceType === 'Document' ||
              event.redirectedRequestId
            ) {
              this.failure = new FfeFailure('FFE_UNTRUSTED_REDIRECT');
              this.stop();
            }
            return;
          }
          const dispatch = async () => {
            signal.throwIfAborted();
            if (
              url.origin === this.options.settings.origin &&
              protectedRequest
            ) {
              const id = event.networkId ?? event.requestId;
              clear(id);
              this.timers.set(
                id,
                setTimeout(() => {
                  this.failure = new FfeFailure('FFE_TIMEOUT');
                  this.stop();
                }, TIMEOUT_MS),
              );
            }
            await cdp.send('Fetch.continueRequest', {
              requestId: event.requestId,
            });
          };
          if (
            url.origin === this.options.settings.origin &&
            [LOGIN_PATH, TRACKING_PATH, DATA_PATH, '/Customer'].includes(
              url.pathname,
            )
          ) {
            this.queued++;
            let waiting = true;
            try {
              await this.options.limiter.run(this.options.rpm, signal, () => {
                waiting = false;
                this.queued--;
                return dispatch();
              });
            } finally {
              if (waiting) this.queued--;
            }
          } else await dispatch();
        })().catch(() => {
          void cdp
            .send('Fetch.failRequest', {
              requestId: event.requestId,
              errorReason: 'Aborted',
            })
            .catch(() => undefined);
        });
      },
    );
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    });
  }

  /** UI/response waits are bounded, but intentional RPM queue time is excluded. */
  async wait<T>(operation: Promise<T>): Promise<T> {
    let remaining = TIMEOUT_MS;
    let previous = performance.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setInterval(() => {
            const now = performance.now();
            if (!this.queued) remaining -= now - previous;
            previous = now;
            if (remaining <= 0) {
              this.failure = new FfeFailure('FFE_TIMEOUT');
              reject(this.failure);
              this.stop();
            }
          }, 100);
        }),
      ]);
    } finally {
      clearInterval(timer);
    }
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
