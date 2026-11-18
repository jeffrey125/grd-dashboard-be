import { createCache } from 'cache-manager';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@modules/auth/auth.repository.js';
import { upcomingWindow } from './upcoming.dates.js';
import { UpcomingService } from './upcoming.service.js';
import type {
  UpcomingAccess,
  UpcomingOrder,
  UpcomingFileRecord,
} from './upcoming.contracts.js';

const a = 'recAAAAAAAAAAAAAA';
const b = 'recBBBBBBBBBBBBBB';
const principal: Principal = {
  id: 1,
  externalId: '00000000-0000-4000-8000-000000000001',
  sessionId: 1,
  role: 'staff',
  mustChangePassword: false,
};
const order = (
  id: string,
  reps: string[],
  date = '2026-11-17',
): UpcomingOrder => ({
  id,
  repIds: reps,
  reps,
  requestedShipOn: date,
  salesOrders: [],
  customer: 'Fixture',
  customerPo: null,
  tracking: null,
  notes: null,
  pallets: null,
  lines: [],
  airtableUrl: 'https://airtable.com/example',
});
function setup() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'));
  let assignments: UpcomingAccess = { ownRepId: a, assignedRepIds: [] };
  const reps = [
    { id: a, name: 'A', email: 'a@example.test' },
    { id: b, name: 'B', email: null },
  ];
  const source = {
    configured: true,
    files: vi.fn(async (): Promise<UpcomingFileRecord | null> => null),
    reps: vi.fn(async () => reps),
    load: vi.fn(async () => ({
      reps,
      updatedAt: new Date().toISOString(),
      orders: [
        order(a, [a]),
        order(b, [b]),
        order('recCCCCCCCCCCCCCC', []),
        order('recDDDDDDDDDDDDDD', [a, b], '2026-11-30'),
      ],
    })),
  };
  const repository = {
    get: vi.fn(async () => assignments),
    account: vi.fn(async () => ({ id: 1, email: 'a@example.test' })),
    replace: vi.fn(async (_id: number, value: UpcomingAccess) => {
      assignments = value;
    }),
  };
  const service = new UpcomingService(source, repository, createCache());
  return {
    service,
    source,
    repository,
    setAccess: (value: UpcomingAccess) => {
      assignments = value;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('upcoming shipment scope and cache', () => {
  it('enforces own, multiple assistant, admin and unassigned scope on cache hits', async () => {
    const { service, source, setAccess } = setup();
    expect(
      (await service.list(principal, { window: 'week' })).orders.map(
        (o) => o.id,
      ),
    ).toEqual([a]);
    setAccess({ ownRepId: null, assignedRepIds: [a, b] });
    expect(
      (await service.list(principal, { window: 'week' })).orders,
    ).toHaveLength(2);
    expect(
      (
        await service.list(
          { ...principal, role: 'admin' },
          { repId: 'unassigned' },
        )
      ).orders,
    ).toHaveLength(1);
    expect(source.load).toHaveBeenCalledTimes(1);
    setAccess({ ownRepId: null, assignedRepIds: [] });
    await expect(service.list(principal, {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.list(principal, { repId: 'unassigned' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('offers the active roster in order within current permissions, including reps with no orders', async () => {
    const { service, source, setAccess } = setup();
    const ryan = 'rec2hIQlfPlBP0hKP';
    const milly = 'recXaDIHj1barJOUj';
    const ryanAli = 'recUtiyyBYSLybnhT';
    const inactiveOrder = order(a, [b]);
    source.load.mockResolvedValueOnce({
      reps: [
        { id: ryanAli, name: 'Ryan-Ali', email: null },
        { id: b, name: 'Ryan', email: null },
        { id: milly, name: 'Milly', email: null },
        { id: ryan, name: 'Renamed in Airtable', email: null },
      ],
      orders: [inactiveOrder],
      updatedAt: new Date().toISOString(),
    });

    const result = await service.list({ ...principal, role: 'admin' }, {});
    expect(result.repFilterOptions).toEqual([
      { id: ryan, name: 'Ryan' },
      { id: milly, name: 'Milly' },
      { id: ryanAli, name: 'Ryan - Ali' },
    ]);
    expect(result.reps).toContainEqual({ id: b, name: 'Ryan' });
    expect(result.orders).toEqual([inactiveOrder]);

    setAccess({ ownRepId: b, assignedRepIds: [ryanAli] });
    const staff = await service.list(principal, { window: 'week' });
    expect(staff.repFilterOptions).toEqual([
      { id: ryanAli, name: 'Ryan - Ali' },
    ]);
    expect(staff.orders).toEqual([inactiveOrder]);
    expect(source.load).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent refreshes and warns on stale fallback without widening permissions', async () => {
    const { service, source, setAccess } = setup();
    await Promise.all([
      service.list(principal, {}),
      service.list(principal, {}),
    ]);
    expect(source.load).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-17T18:06:00Z'));
    source.load.mockRejectedValue(new Error('provider unavailable'));
    setAccess({ ownRepId: b, assignedRepIds: [] });
    const result = await service.list(principal, {});
    expect(result.stale).toBe(true);
    expect(result.orders.map((o) => o.id)).toEqual([b, 'recDDDDDDDDDDDDDD']);
    const fresh = setup();
    fresh.source.load.mockRejectedValue(new Error('token must not leak'));
    await expect(fresh.service.list(principal, {})).rejects.toMatchObject({
      status: 503,
      message: 'Upcoming shipments could not be loaded',
    });
  });
  it('rejects arbitrary date windows, foreign reps and invalid assignments; email only suggests', async () => {
    const { service, repository } = setup();
    await expect(
      service.list(principal, { month: '2027-01' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.list(principal, { repId: b })).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (await service.accountAccess(principal.externalId)).suggestedRepIds,
    ).toEqual([a]);
    expect(repository.replace).not.toHaveBeenCalled();
    await expect(
      service.saveAccess(principal.externalId, {
        ownRepId: 'recZZZZZZZZZZZZZZ',
        assignedRepIds: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await service.saveAccess(principal.externalId, {
      ownRepId: null,
      assignedRepIds: [a, b, b],
    });
    expect(repository.replace).toHaveBeenCalledWith(1, {
      ownRepId: null,
      assignedRepIds: [a, b],
    });
  });
  it('rechecks assignments after a provider fetch', async () => {
    const { service, source, setAccess } = setup();
    source.load.mockImplementationOnce(async () => {
      setAccess({ ownRepId: null, assignedRepIds: [] });
      return {
        orders: [order(a, [a])],
        reps: [],
        updatedAt: new Date().toISOString(),
      };
    });
    await expect(service.list(principal, {})).rejects.toMatchObject({
      status: 403,
    });
  });
});

it('uses Chicago today, inclusive Sunday, and crosses the month only for the week window', () => {
  expect(upcomingWindow(new Date('2026-12-01T02:00:00Z'))).toMatchObject({
    from: '2026-11-30',
    monthEnd: '2026-11-30',
    weekEnd: '2026-12-06',
    through: '2026-12-06',
  });
  expect(upcomingWindow(new Date('2026-11-01T07:30:00Z'))).toMatchObject({
    from: '2026-11-01',
    weekEnd: '2026-11-01',
  });
});

it('keeps failed manual refresh warnings and does not extend provider cooldown on reads', async () => {
  const { service, source } = setup();
  await service.list(principal, {});
  vi.setSystemTime(new Date('2026-11-17T18:00:20Z'));
  source.load.mockRejectedValueOnce(new Error('unavailable'));
  expect((await service.list(principal, { refresh: 'true' })).stale).toBe(true);
  expect((await service.list(principal, {})).stale).toBe(true);
  vi.setSystemTime(new Date('2026-11-17T18:00:25Z'));
  expect((await service.list(principal, { refresh: 'true' })).stale).toBe(true);
  expect(source.load).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date('2026-11-17T18:00:31Z'));
  expect((await service.list(principal, { refresh: 'true' })).stale).toBe(
    false,
  );
  expect(source.load).toHaveBeenCalledTimes(3);
});

it('allows stored access to be read and removed during an Airtable outage', async () => {
  const { service, source } = setup();
  source.reps.mockRejectedValue(new Error('unavailable'));
  expect(await service.accountAccess(principal.externalId)).toMatchObject({
    ownRepId: a,
    directoryUnavailable: true,
  });
  await expect(
    service.saveAccess(principal.externalId, {
      ownRepId: null,
      assignedRepIds: [],
    }),
  ).resolves.toEqual({ ownRepId: null, assignedRepIds: [] });
});

it('does not label the old snapshot as a complete new month after midnight', async () => {
  const { service, source } = setup();
  vi.setSystemTime(new Date('2026-12-01T05:59:59Z'));
  source.load.mockImplementationOnce(async () => {
    vi.setSystemTime(new Date('2026-12-01T06:00:01Z'));
    return { orders: [], reps: [], updatedAt: new Date().toISOString() };
  });
  await expect(service.list(principal, {})).rejects.toMatchObject({
    status: 503,
  });
  expect(source.load).toHaveBeenCalledWith('2026-11-30', '2026-12-06');
});

describe('shipment DOCS access', () => {
  const record = {
    requestedShipOn: '2026-11-17',
    test: false,
    repIds: [a],
    files: [
      {
        id: 'attExample',
        filename: 'bol.pdf',
        type: 'application/pdf',
        size: 100,
        url: 'https://v5.airtableusercontent.com/fresh',
      },
    ],
  };
  it('fetches fresh links each time without the shared shipment cache', async () => {
    const { service, source } = setup();
    source.files.mockResolvedValue(record);
    expect(await service.files(principal, a)).toEqual({ files: record.files });
    await service.files(principal, a);
    expect(source.files).toHaveBeenCalledTimes(2);
    expect(source.load).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...record, repIds: [b] },
    { ...record, test: true },
    { ...record, requestedShipOn: null },
    { ...record, requestedShipOn: '2026-11-16' },
    { ...record, requestedShipOn: '2026-12-01' },
  ])('rejects unavailable or unauthorized records', async (value) => {
    const { service, source } = setup();
    source.files.mockResolvedValue(value);
    await expect(service.files(principal, a)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('rechecks assignment changes while fetching and sanitizes provider failures', async () => {
    const { service, source, setAccess } = setup();
    source.files.mockImplementation(async () => {
      setAccess({ ownRepId: b, assignedRepIds: [] });
      return record;
    });
    await expect(service.files(principal, a)).rejects.toMatchObject({
      status: 404,
    });
    source.files.mockRejectedValue(new Error('provider secret'));
    await expect(service.files(principal, a)).rejects.toThrow(
      'Shipment files could not be loaded',
    );
    await expect(service.files(principal, "bad'formula")).rejects.toMatchObject(
      { status: 400 },
    );
  });
});
