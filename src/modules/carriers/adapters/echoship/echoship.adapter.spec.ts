import { describe, expect, it, vi } from 'vitest';
import {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios';
import { EchoShipAdapter } from './echoship.adapter.js';
import { EchoShipConfiguration } from './echoship.config.js';

const config = () =>
  new EchoShipConfiguration({
    ECHOSHIP_URL: 'https://echoship.com',
    ECHOSHIP_USERNAME: 'fixture',
    ECHOSHIP_PASSWORD: 'private-password',
  });
const signal = new AbortController().signal;

describe('EchoShip request session', () => {
  it('orders authoritative API events by modified date before created date', async () => {
    const transport: AxiosAdapter = async (request) => {
      const data = request.url!.endsWith('signIn')
        ? {}
        : request.url!.endsWith('/tracking')
          ? [
              {
                id: 69451086,
                typeName: 'Earlier event with same modification time',
                notes: null,
                createdDate: '2026-10-12T10:00:00',
                modifiedDate: '2026-10-14T10:00:00',
              },
              {
                id: 69451086,
                typeName: 'Shipment enroute',
                notes: ' Arrived  at terminal ',
                createdDate: '2026-10-13T10:00:00',
                modifiedDate: '2026-10-14T10:00:00',
              },
              {
                id: 69451086,
                typeName: 'Old status',
                notes: null,
                createdDate: '2026-10-14T09:00:00',
                modifiedDate: '2026-10-14T09:00:00',
              },
            ]
          : request.url!.includes('loadSummaries')
            ? {
                results: [
                  {
                    id: 69451086,
                    estimatedDeliveryDate: '2026-10-13T00:00:00Z',
                  },
                ],
                totalRecordCount: 1,
              }
            : {
                id: '69451086',
                pickupDate: '2026-10-08T23:23:00-07:00',
                secret: 'PRIVATE',
              };

      return {
        config: request,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { status: { code: 200 }, data },
      };
    };
    const adapter = new EchoShipAdapter(config(), transport);
    const session = await adapter.openSession({
      signal,
      rateLimitPerMinute: null,
      fetchMode: 'request',
    });

    try {
      const result = await session.read('69451086', signal);

      expect(result).toMatchObject({
        outcome: 'found',
        snapshot: {
          carrierStatus: 'Shipment enroute',
          carrierStatusDetail: 'Arrived at terminal',
          pickedUpOn: '2026-10-08',
          estimatedDeliveryOn: null,
          deliveredOn: null,
        },
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(JSON.stringify(result)).not.toContain('Old status');
    } finally {
      await session.close();
      await adapter.onModuleDestroy();
    }
  });

  async function fixture(
    options: {
      search?: (offset: number) => unknown;
      detail?: unknown;
      events?: unknown;
      failure?: string;
      status?: number;
    } = {},
  ) {
    const calls: string[] = [];
    const transport: AxiosAdapter = async (request) => {
      calls.push(request.url!);

      const lookup =
        !request.url!.endsWith('signIn') &&
        !(
          request.url!.includes('loadSummaries') &&
          request.params.searchQuery === ''
        );

      if (lookup && options.failure)
        throw new AxiosError('SECRET', options.failure, request);

      if (lookup && options.status)
        throw new AxiosError('SECRET', undefined, request, undefined, {
          config: request,
          status: options.status,
          statusText: 'SECRET',
          headers: {},
          data: { secret: 'SECRET' },
        });

      const data = request.url!.endsWith('signIn')
        ? {}
        : request.url!.includes('loadSummaries')
          ? lookup && options.search
            ? options.search(request.params.offset)
            : { results: [{ id: 69451086 }], totalRecordCount: 1 }
          : request.url!.endsWith('/tracking')
            ? (options.events ?? [
                {
                  id: 69451086,
                  typeName: 'Moving',
                  notes: null,
                  createdDate: '2026-10-13T10:00:00',
                  modifiedDate: '2026-10-13T10:00:00',
                },
              ])
            : (options.detail ?? {
                id: '69451086',
                pickupDate: '2026-10-08T16:23:00',
              });

      return {
        config: request,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { status: { code: 200 }, data },
      };
    };
    const browser = vi.fn();
    const adapter = new EchoShipAdapter(config(), transport, browser);
    const session = await adapter.openSession({
      signal,
      rateLimitPerMinute: null,
      fetchMode: 'request',
    });

    return {
      calls,
      browser,
      session,
      close: async () => {
        await session.close();
        await adapter.onModuleDestroy();
      },
      adapter,
    };
  }

  it('confirms complete absence without launching a browser', async () => {
    const f = await fixture({
      search: () => ({ results: [], totalRecordCount: 0 }),
    });

    try {
      expect(await f.session.read('69451086', signal)).toEqual({
        outcome: 'not_found',
        sourceData: null,
      });
      expect(f.browser).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });

  it('tracks a status-only shipment and prefers tracking events when they arrive', async () => {
    const events: unknown[] = [];
    const f = await fixture({
      detail: { id: '69451086', status: ' CheckedIn ', secret: 'PRIVATE' },
      events,
    });

    try {
      expect(await f.session.read('69451086', signal)).toEqual({
        outcome: 'found',
        snapshot: {
          carrierStatus: 'CheckedIn',
          carrierStatusDetail: null,
          pickedUpOn: null,
          estimatedDeliveryOn: null,
          deliveredOn: null,
        },
        sourceData: {
          load: {
            id: '69451086',
            status: ' CheckedIn ',
            pickupDate: null,
            deliveryDate: null,
            deliveryByDate: null,
            deliveryAppointmentStart: null,
          },
          trackingEvent: null,
        },
      });

      events.push({
        id: 69451086,
        typeName: 'Shipment enroute',
        notes: 'Arrived at terminal',
        createdDate: '2026-10-27T12:00:00',
        modifiedDate: '2026-10-27T12:00:00',
      });

      expect(await f.session.read('69451086', signal)).toMatchObject({
        outcome: 'found',
        snapshot: {
          carrierStatus: 'Shipment enroute',
          carrierStatusDetail: 'Arrived at terminal',
        },
      });
      expect(f.calls.filter((url) => url.endsWith('signIn'))).toHaveLength(1);
      expect(f.calls.some((url) => url.includes('location-history'))).toBe(
        false,
      );
    } finally {
      await f.close();
    }
  });

  it.each([undefined, null, '', '   ', 123, 'x'.repeat(256)])(
    'does not invent tracking data for an unusable detail status: %j',
    async (status) => {
      const f = await fixture({
        detail: { id: '69451086', status },
        events: [],
      });

      try {
        expect(await f.session.read('69451086', signal)).toMatchObject({
          outcome: 'failed',
          sourceData: null,
        });
      } finally {
        await f.close();
      }
    },
  );

  it('does not use the detail status to hide malformed tracking events', async () => {
    const f = await fixture({
      detail: { id: '69451086', status: 'CheckedIn' },
      events: [{ id: 69451086, typeName: 'Moving' }],
    });

    try {
      expect(await f.session.read('69451086', signal)).toMatchObject({
        outcome: 'failed',
        sourceData: null,
      });
    } finally {
      await f.close();
    }
  });

  it('finds an exact result on a later search page', async () => {
    const f = await fixture({
      search: (offset) => ({
        results: [{ id: offset === 0 ? 11111111 : 69451086 }],
        totalRecordCount: 2,
      }),
    });

    try {
      expect(await f.session.read('69451086', signal)).toMatchObject({
        outcome: 'found',
      });
    } finally {
      await f.close();
    }
  });

  it.each([
    { search: () => ({ results: [], totalRecordCount: 3 }) },
    { search: () => ({ results: [{ id: 11111111 }], totalRecordCount: 3 }) },
    { search: () => ({ results: 'invalid', totalRecordCount: 0 }) },
    { detail: { id: '99999999' } },
    { detail: { id: '69451086', pickupDate: '2026-02-30T12:00:00' } },
    {
      events: [
        {
          id: 1,
          typeName: 'Delivered',
          createdDate: '2026-10-13T10:00:00',
          modifiedDate: '2026-10-13T10:00:00',
        },
      ],
    },
    {
      events: [
        {
          id: 69451086,
          typeName: 'Moving',
          createdDate: 'bad',
          modifiedDate: '2026-10-13T10:00:00',
        },
      ],
    },
    {
      events: [
        {
          id: 69451086,
          typeName: 'Moving',
          createdDate: '2026-10-13T10:00:00',
          modifiedDate: 'bad',
        },
      ],
    },
    {
      events: [
        {
          id: 69451086,
          typeName: 'A',
          createdDate: '2026-10-13T10:00:00',
          modifiedDate: '2026-10-13T10:00:00',
        },
        {
          id: 69451086,
          typeName: 'B',
          createdDate: '2026-10-13T10:00:00',
          modifiedDate: '2026-10-13T10:00:00',
        },
      ],
    },
  ])(
    'fails incomplete or malformed evidence without a partial snapshot: %j',
    async (options) => {
      const f = await fixture(options);

      try {
        expect(await f.session.read('69451086', signal)).toMatchObject({
          outcome: 'failed',
          sourceData: null,
        });
      } finally {
        await f.close();
      }
    },
  );

  it('prefers the Delivery appointment over deliveryByDate and treats year-one as absent', async () => {
    const f = await fixture({
      detail: {
        id: '69451086',
        pickupDate: '0001-01-01T00:00:00',
        deliveryByDate: '2026-10-14T17:00:00',
        stops: [
          {
            stopType: 'Delivery',
            appointmentStart: '2026-10-15T08:00:00Z',
            address: 'SECRET',
          },
        ],
      },
    });

    try {
      expect(await f.session.read('69451086', signal)).toMatchObject({
        outcome: 'found',
        snapshot: { pickedUpOn: null, estimatedDeliveryOn: '2026-10-15' },
      });
    } finally {
      await f.close();
    }
  });

  it('uses deliveryDate for delivered calendar date', async () => {
    const f = await fixture({
      detail: {
        id: '69451086',
        deliveryDate: '2026-10-14T23:50:00-07:00',
        deliveryByDate: '2026-10-13T08:00:00',
      },
    });

    try {
      expect(await f.session.read('69451086', signal)).toMatchObject({
        outcome: 'found',
        snapshot: { deliveredOn: '2026-10-14', estimatedDeliveryOn: null },
      });
    } finally {
      await f.close();
    }
  });

  it.each([401, 403])(
    'stops authenticated reads after HTTP %s without re-login',
    async (status) => {
      const f = await fixture({ status });

      try {
        expect(await f.session.read('69451086', signal)).toMatchObject({
          outcome: 'failed',
          reasonCode: 'ECHOSHIP_AUTHENTICATION_FAILED',
        });

        const count = f.calls.length;

        expect(await f.session.read('69372728', signal)).toMatchObject({
          outcome: 'failed',
          reasonCode: 'ECHOSHIP_AUTHENTICATION_FAILED',
        });
        expect(f.calls).toHaveLength(count);
        expect(f.calls.filter((url) => url.endsWith('signIn'))).toHaveLength(1);
      } finally {
        await f.close();
      }
    },
  );

  it.each([
    { failure: 'ECONNABORTED' },
    { status: 500 },
    { status: 429 },
    { status: 404 },
  ])(
    'never retries technical failures or treats detail HTTP errors as absence: %j',
    async (options) => {
      const f = await fixture(options);

      try {
        expect(await f.session.read('69451086', signal)).toMatchObject({
          outcome: 'failed',
          sourceData: null,
        });
        expect(f.calls).toHaveLength(3);
      } finally {
        await f.close();
      }
    },
  );

  it('validates and reuses the login across manual or scheduled sessions', async () => {
    const f = await fixture();

    try {
      const second = await f.adapter.openSession({
        signal,
        rateLimitPerMinute: null,
        fetchMode: 'request',
      });

      await second.close();

      expect(f.calls.filter((url) => url.endsWith('signIn'))).toHaveLength(1);
      expect(
        f.calls.filter((url) => url.includes('loadSummaries')),
      ).toHaveLength(2);
    } finally {
      await f.close();
    }
  });

  it('aborts without I/O for cancelled reads and never sends after close', async () => {
    const f = await fixture();

    try {
      await expect(
        f.session.read('69451086', AbortSignal.abort()),
      ).rejects.toBeDefined();
      await f.session.close();

      expect(await f.session.read('69451086', signal)).toMatchObject({
        outcome: 'failed',
      });
      expect(f.calls).toHaveLength(2);
    } finally {
      await f.close();
    }
  });

  it('does not accept a success-shaped login if the authenticated verification fails', async () => {
    const calls: InternalAxiosRequestConfig[] = [];
    const transport: AxiosAdapter = async (request) => {
      calls.push(request);

      if (calls.length > 1)
        throw new AxiosError('SECRET', undefined, request, undefined, {
          config: request,
          status: 401,
          statusText: 'unauthorized',
          headers: {},
          data: {},
        });

      return {
        config: request,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { status: { code: 200 }, data: {} },
      };
    };
    const adapter = new EchoShipAdapter(config(), transport);

    try {
      await expect(
        adapter.openSession({
          signal,
          rateLimitPerMinute: null,
          fetchMode: 'request',
        }),
      ).rejects.toMatchObject({ code: 'ECHOSHIP_AUTHENTICATION_FAILED' });

      expect(calls).toHaveLength(2);
    } finally {
      await adapter.onModuleDestroy();
    }
  });

  it('preserves request pacing across reused sessions and cancels waits without sending', async () => {
    const times: number[] = [];
    const transport: AxiosAdapter = async (request) => {
      times.push(Date.now());

      return {
        config: request,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: {
          status: { code: 200 },
          data: request.url!.endsWith('signIn')
            ? {}
            : { results: [], totalRecordCount: 0 },
        },
      };
    };
    const adapter = new EchoShipAdapter(config(), transport);

    try {
      const first = await adapter.openSession({
        signal,
        fetchMode: 'request',
        rateLimitPerMinute: 600,
      });

      await first.close();

      const second = await adapter.openSession({
        signal,
        fetchMode: 'request',
        rateLimitPerMinute: 600,
      });

      expect(times).toHaveLength(3);

      for (let index = 1; index < times.length; index++)
        // Allow transport/interceptor clock jitter around the 100 ms dispatch spacing.
        expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(90);

      const controller = new AbortController();
      const reading = second.read('69451086', controller.signal);
      const rejected = expect(reading).rejects.toBeDefined();

      controller.abort();
      await rejected;

      expect(times).toHaveLength(3);

      await second.close();
    } finally {
      await adapter.onModuleDestroy();
    }
  });
});
