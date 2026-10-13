import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { FfeAdapter } from './ffe.adapter.js';
import { FfeConfiguration } from './ffe.config.js';

describe('FFE request sessions', () => {
  let adapter: FfeAdapter;
  const signal = new AbortController().signal;
  afterEach(async () => {
    await adapter?.onModuleDestroy();
  });

  it.each([
    { FFE_URL: 'https://example.invalid/Customer/ShipmentTracking' },
    { FFE_URL: 'http://www.ffeinc.com/Customer/ShipmentTracking' },
    {
      FFE_URL:
        'https://www.ffeinc.com/Customer/ShipmentTracking?secret=PRIVATE',
    },
    { FFE_USERNAME: ' ' },
    { FFE_PASSWORD: '\nPRIVATE' },
  ])('rejects invalid configuration before any I/O: %j', async (override) => {
    const http = vi.fn();
    const browser = vi.fn();
    adapter = new FfeAdapter(
      new FfeConfiguration({
        FFE_URL: 'https://www.ffeinc.com/Customer/ShipmentTracking',
        FFE_USERNAME: 'fixture',
        FFE_PASSWORD: 'PRIVATE',
        ...override,
      }),
      http,
      browser,
    );
    await expect(
      adapter.openSession({
        signal,
        fetchMode: 'request',
        rateLimitPerMinute: null,
      }),
    ).rejects.toMatchObject({
      code: 'FFE_CONFIGURATION_INVALID',
      message: 'FFE lookup could not be completed.',
    });
    expect(http).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  });

  it('logs in without a browser and retrieves an exact order from one-year JSON search', async () => {
    const browser = vi.fn();
    const transport: AxiosAdapter = async (request) => {
      let data = '<table id="shipmentTrackingDataTable"></table>';
      let status = 200;
      const headers: Record<string, string> = { 'content-type': 'text/html' };
      if (request.url === '/Account/Login') {
        if (request.method === 'post') {
          expect(
            new URLSearchParams(request.data).get('__RequestVerificationToken'),
          ).toBe('TOKEN&VALUE');
          status = 302;
          headers.location = '/Customer';
          data = '';
        } else
          data =
            '<form action="/Account/Login" method="post"><input name="__RequestVerificationToken" value="TOKEN&amp;VALUE"><input name="ReturnUrl" value=""></form>';
      }
      if (request.url === '/Customer/LoadShipmentTrackingData') {
        const body = JSON.parse(request.data);
        expect(body.archiveLimit).toBe('365');
        expect(body.columns[0].search.value).toBe('001');
        headers['content-type'] = 'application/json';
        data = JSON.stringify({
          draw: String(body.draw),
          recordsTotal: 50,
          recordsFiltered: 1,
          data: [
            {
              orderNumber: '001',
              shipmentStatus: 'Scheduled',
              apptPickupDate: '2026-10-15T00:00:00',
            },
          ],
        });
      }
      return { data, status, statusText: 'OK', headers, config: request };
    };
    adapter = new FfeAdapter(
      new FfeConfiguration({
        FFE_URL: 'https://www.ffeinc.com/Customer/ShipmentTracking',
        FFE_USERNAME: 'fixture',
        FFE_PASSWORD: 'PRIVATE',
      }),
      transport,
      browser,
    );
    const session = await adapter.openSession({
      signal,
      fetchMode: 'request',
      rateLimitPerMinute: null,
    });
    expect(await session.read('001', signal)).toMatchObject({
      outcome: 'found',
      snapshot: { carrierStatus: 'Scheduled', pickedUpOn: '2026-10-15' },
    });
    expect(browser).not.toHaveBeenCalled();
    await session.close();
  });
});
