import axios, { type AxiosAdapter, type AxiosRequestConfig } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import type { Agent } from 'node:http';
import type { EchoShipSettings } from './echoship.config.js';
import { EchoShipFailure } from './echoship.failure.js';
import {
  envelope,
  mapEchoShip,
  MAX_BODY_BYTES,
  SEARCH_PATH,
  searchPage,
  TIMEOUT_MS,
} from './echoship.mapping.js';
import type { EchoShipLimiter } from './echoship.limiter.js';

export class EchoShipRequest {
  private readonly jar = new CookieJar();
  private readonly closed = new AbortController();
  private readonly http;

  constructor(
    private readonly settings: EchoShipSettings,
    transport: AxiosAdapter,
    private readonly limiter: EchoShipLimiter,
    private readonly rpm: number | null,
    private readonly runSignal: AbortSignal,
  ) {
    this.http = wrapper(
      axios.create({
        baseURL: settings.origin,
        jar: this.jar,
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_BODY_BYTES,
        maxBodyLength: MAX_BODY_BYTES,
        responseType: 'json',
        transitional: { silentJSONParsing: false },
        proxy: false,
        adapter: async (config) => {
          try {
            return await transport(config);
          } finally {
            (config.httpAgent as Agent | undefined)?.destroy();
            (config.httpsAgent as Agent | undefined)?.destroy();
          }
        },
      }),
    );
  }

  private async request(config: AxiosRequestConfig, signal: AbortSignal) {
    const combined = AbortSignal.any([
      signal,
      this.runSignal,
      this.closed.signal,
    ]);

    return this.limiter.run(this.rpm, combined, async () => {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);

      timer.unref();

      try {
        const response = await this.http.request({
          ...config,
          signal: AbortSignal.any([combined, deadline.signal]),
        });

        if (
          !/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(
            String(response.headers['content-type'] ?? ''),
          )
        )
          throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');

        envelope(response.data);

        return response.data as unknown;
      } catch (error) {
        if (deadline.signal.aborted && !combined.aborted)
          throw new EchoShipFailure('ECHOSHIP_TIMEOUT');

        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private search(reference: string, offset: number, signal: AbortSignal) {
    return this.request(
      {
        url: SEARCH_PATH,
        params: {
          searchQuery: reference,
          offset,
          limit: 100,
          sortBy: 'loadId:desc',
          watched: false,
        },
      },
      signal,
    );
  }

  async login(signal: AbortSignal) {
    await this.request(
      {
        method: 'POST',
        url: '/api/v1//auth/signIn',
        data: {
          Username: this.settings.username,
          Password: this.settings.password,
        },
        auth: {
          username: this.settings.username,
          password: this.settings.password,
        },
      },
      signal,
    );
    // A success-shaped login alone is not evidence that cookies authorize reads.
    searchPage(await this.search('', 0, signal));
  }

  async read(reference: string, signal: AbortSignal) {
    let total: number | undefined;
    const seen = new Set<string>();

    for (let page = 0; page < 10; page++) {
      const found = searchPage(await this.search(reference, seen.size, signal));

      if (total !== undefined && total !== found.totalRecordCount)
        throw new EchoShipFailure('ECHOSHIP_INCOMPLETE_SEARCH');

      total = found.totalRecordCount;

      for (const row of found.results) {
        if (seen.has(row.id))
          throw new EchoShipFailure('ECHOSHIP_INCOMPLETE_SEARCH');

        seen.add(row.id);
      }

      if (seen.size > total)
        throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');

      if (found.results.some((row) => row.id === reference)) {
        const detail = await this.request(
          { url: `/api/v1//loads/${reference}` },
          signal,
        );
        const tracking = await this.request(
          { url: `/api/v1//loads/${reference}/tracking` },
          signal,
        );

        return mapEchoShip(reference, detail, tracking);
      }

      if (seen.size === total)
        return { outcome: 'not_found' as const, sourceData: null };

      if (!found.results.length) break;
    }

    throw new EchoShipFailure('ECHOSHIP_INCOMPLETE_SEARCH');
  }

  async close() {
    this.closed.abort();
    await this.jar.removeAllCookies();
  }
}
