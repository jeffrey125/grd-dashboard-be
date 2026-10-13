import axios, { type AxiosAdapter, type AxiosRequestConfig } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { load } from 'cheerio';
import type { Agent } from 'node:http';
import { FfeFailure } from './ffe.failure.js';
import { mapFfe } from './ffe.mapping.js';
import {
  assertResponse,
  DATA_PATH,
  LOGIN_PATH,
  MAX_BODY_BYTES,
  searchBody,
  searchPage,
  TIMEOUT_MS,
  TRACKING_PATH,
  type FfeSessionOptions,
} from './ffe.protocol.js';

export class FfeRequest {
  private readonly jar = new CookieJar();
  private readonly closed = new AbortController();
  private readonly http;
  private draw = 1;
  constructor(
    private readonly options: FfeSessionOptions,
    transport: AxiosAdapter,
  ) {
    this.http = wrapper(
      axios.create({
        baseURL: options.settings.origin,
        jar: this.jar,
        proxy: false,
        maxRedirects: 0,
        timeout: TIMEOUT_MS,
        maxContentLength: MAX_BODY_BYTES,
        maxBodyLength: MAX_BODY_BYTES,
        responseType: 'text',
        validateStatus: () => true,
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
      this.options.signal,
      this.closed.signal,
    ]);
    return this.options.limiter.run(this.options.rpm, combined, async () => {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
      timer.unref();
      try {
        const response = await this.http.request<string>({
          ...config,
          signal: AbortSignal.any([combined, deadline.signal]),
        });
        if (
          typeof response.data !== 'string' ||
          Buffer.byteLength(response.data) > MAX_BODY_BYTES
        )
          throw new FfeFailure('FFE_INVALID_RESPONSE');
        if ([401, 403].includes(response.status))
          throw new FfeFailure('FFE_AUTHENTICATION_FAILED');
        if (
          response.status >= 300 &&
          response.status < 400 &&
          config.url !== LOGIN_PATH
        )
          throw new FfeFailure('FFE_AUTHENTICATION_FAILED');
        return response;
      } catch (error) {
        if (deadline.signal.aborted && !combined.aborted)
          throw new FfeFailure('FFE_TIMEOUT');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
  }
  private async verify(signal: AbortSignal) {
    const response = await this.request({ url: TRACKING_PATH }, signal);
    assertResponse(
      response.status,
      String(response.headers['content-type'] ?? ''),
      'html',
    );
    const $ = load(response.data);
    if ($('#UserName').length || $('#shipmentTrackingDataTable').length !== 1)
      throw new FfeFailure('FFE_AUTHENTICATION_FAILED');
  }
  async login(signal: AbortSignal) {
    const response = await this.request({ url: LOGIN_PATH }, signal);
    assertResponse(
      response.status,
      String(response.headers['content-type'] ?? ''),
      'html',
    );
    const $ = load(response.data);
    const form = $('form').filter(
      (_i, element) =>
        $(element).attr('action') === LOGIN_PATH &&
        $(element).attr('method')?.toLowerCase() === 'post',
    );
    const tokens = form.find('input[name="__RequestVerificationToken"]');
    const token = tokens.attr('value');
    if (
      form.length !== 1 ||
      tokens.length !== 1 ||
      !token ||
      token.length > 8192
    )
      throw new FfeFailure('FFE_AUTHENTICATION_FAILED');
    const signedIn = await this.request(
      {
        url: LOGIN_PATH,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          ReturnUrl: '',
          UserName: this.options.settings.username,
          Password: this.options.settings.password,
          __RequestVerificationToken: token,
        }).toString(),
      },
      signal,
    );
    const location = signedIn.headers.location;
    if (
      signedIn.status !== 302 ||
      typeof location !== 'string' ||
      new URL(location, this.options.settings.origin).href !==
        `${this.options.settings.origin}/Customer`
    )
      throw new FfeFailure('FFE_AUTHENTICATION_FAILED');
    await this.verify(signal);
  }
  async read(reference: string, signal: AbortSignal) {
    let total: number | undefined;
    let accountTotal: number | undefined;
    let start = 0;
    for (let page = 0; page < 10; page++) {
      const draw = ++this.draw;
      const response = await this.request(
        {
          url: DATA_PATH,
          method: 'POST',
          data: JSON.stringify(searchBody(reference, start, draw)),
          headers: { 'content-type': 'application/json' },
        },
        signal,
      );
      let result: ReturnType<typeof searchPage>;
      try {
        assertResponse(
          response.status,
          String(response.headers['content-type'] ?? ''),
          'json',
        );
        result = searchPage(JSON.parse(response.data), draw, 100);
      } catch (error) {
        await this.verify(signal);
        throw error;
      }
      if (
        total !== undefined &&
        (total !== result.recordsFiltered ||
          accountTotal !== result.recordsTotal)
      )
        throw new FfeFailure('FFE_INCOMPLETE_SEARCH');
      total = result.recordsFiltered;
      accountTotal = result.recordsTotal;
      if (start + result.data.length > total)
        throw new FfeFailure('FFE_INVALID_RESPONSE');
      const match = result.data.find((row) => row.orderNumber === reference);
      // No record-update timestamp is verified. Preserve provider order, including duplicates.
      if (match) return mapFfe(reference, match);
      if (start + result.data.length === total) {
        await this.verify(signal);
        return { outcome: 'not_found' as const, sourceData: null };
      }
      if (!result.data.length) throw new FfeFailure('FFE_INCOMPLETE_SEARCH');
      start += result.data.length;
    }
    throw new FfeFailure('FFE_INCOMPLETE_SEARCH');
  }
  async close() {
    this.closed.abort();
    await this.jar.removeAllCookies();
  }
}
