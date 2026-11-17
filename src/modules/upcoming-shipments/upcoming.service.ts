import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { z } from 'zod';
import type { Principal } from '@modules/auth/auth.repository.js';
import {
  UPCOMING_ACCESS,
  UPCOMING_SOURCE,
  type UpcomingAccessRepository,
  type AirtableRep,
  type UpcomingSnapshot,
  type UpcomingSource,
} from './upcoming.contracts.js';
import { upcomingWindow } from './upcoming.dates.js';

const repId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);
const querySchema = z
  .object({
    window: z.enum(['week', 'month']).default('month'),
    repId: z.union([repId, z.literal('unassigned')]).optional(),
    refresh: z.enum(['true', 'false']).optional(),
  })
  .strict();
const assignmentSchema = z
  .object({
    ownRepId: repId.nullable(),
    assignedRepIds: z
      .array(repId)
      .max(100)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();
const freshMs = 5 * 60_000;

@Injectable()
export class UpcomingService {
  private inFlight?: { key: string; promise: Promise<UpcomingSnapshot> };
  private retryAfter = 0;
  private failedWindow: string | undefined;

  constructor(
    @Inject(UPCOMING_SOURCE) private readonly source: UpcomingSource,
    @Inject(UPCOMING_ACCESS)
    private readonly repository: UpcomingAccessRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async access(principal: Principal) {
    const access = await this.repository.get(principal.id);
    const repIds = [
      ...new Set([
        ...(access.ownRepId ? [access.ownRepId] : []),
        ...access.assignedRepIds,
      ]),
    ];
    return {
      enabled:
        this.source.configured &&
        (principal.role === 'admin' || repIds.length > 0),
      administrator: principal.role === 'admin',
      repIds,
      ...upcomingWindow(),
    };
  }

  private async snapshot(
    refresh: boolean,
    window: ReturnType<typeof upcomingWindow>,
  ) {
    const key = `upcoming:${window.from}:${window.through}`;
    const previous = await this.cache.get<UpcomingSnapshot>(key);
    const age = previous
      ? Date.now() - Date.parse(previous.updatedAt)
      : Infinity;
    if (previous && age < (refresh ? 10_000 : freshMs))
      return { ...previous, stale: this.failedWindow === key };
    if (Date.now() < this.retryAfter) {
      if (previous) return { ...previous, stale: true };
      throw new ServiceUnavailableException(
        'Upcoming shipments could not be loaded',
      );
    }
    try {
      if (this.inFlight?.key !== key) {
        const promise = this.source
          .load(window.from, window.through)
          .then(async (snapshot) => {
            await this.cache.set(key, snapshot, 24 * 60 * 60_000);
            if (this.failedWindow === key) this.failedWindow = undefined;
            return snapshot;
          });
        this.inFlight = { key, promise };
        void promise
          .finally(() => {
            if (this.inFlight?.promise === promise) this.inFlight = undefined;
          })
          .catch(() => undefined);
      }
      return { ...(await this.inFlight!.promise), stale: false };
    } catch {
      this.retryAfter = Date.now() + 10_000;
      this.failedWindow = key;
      if (previous) return { ...previous, stale: true };
      throw new ServiceUnavailableException(
        'Upcoming shipments could not be loaded',
      );
    }
  }

  async list(principal: Principal, input: unknown) {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Invalid upcoming shipment query');
    let access = await this.access(principal);
    if (!access.enabled)
      throw new ForbiddenException('Upcoming shipments are not assigned');
    const query = parsed.data;
    if (
      !access.administrator &&
      query.repId &&
      !access.repIds.includes(query.repId)
    )
      throw new ForbiddenException();
    const from = access.from;
    const snapshot = await this.snapshot(query.refresh === 'true', access);
    access = await this.access(principal);
    if (access.from !== from)
      throw new ServiceUnavailableException(
        'The shipment date window changed. Refresh to load the new day.',
      );
    if (
      !access.enabled ||
      (!access.administrator &&
        query.repId &&
        !access.repIds.includes(query.repId))
    )
      throw new ForbiddenException();
    // Permissions are read on every request, including cache hits and stale fallback.
    const permitted = new Set(access.repIds);
    const through = query.window === 'week' ? access.weekEnd : access.monthEnd;
    const orders = snapshot.orders.filter(
      (order) =>
        order.requestedShipOn >= access.from &&
        order.requestedShipOn <= through &&
        (access.administrator ||
          order.repIds.some((id) => permitted.has(id))) &&
        (!query.repId ||
          (query.repId === 'unassigned'
            ? order.repIds.length === 0
            : order.repIds.includes(query.repId))),
    );
    return {
      ...access,
      window: query.window,
      through,
      updatedAt: snapshot.updatedAt,
      stale: snapshot.stale,
      reps: snapshot.reps
        .filter((rep) => access.administrator || permitted.has(rep.id))
        .map(({ id, name }) => ({ id, name })),
      total: orders.length,
      orders,
    };
  }

  async files(principal: Principal, orderId: string) {
    if (!repId.safeParse(orderId).success)
      throw new BadRequestException('Invalid shipment ID');
    if (!(await this.access(principal)).enabled) throw new ForbiddenException();
    let record;
    try {
      record = await this.source.files(orderId);
    } catch {
      throw new ServiceUnavailableException(
        'Shipment files could not be loaded',
      );
    }
    const access = await this.access(principal);
    if (!access.enabled) throw new ForbiddenException();
    if (
      !record ||
      record.test ||
      !record.requestedShipOn ||
      record.requestedShipOn < access.from ||
      record.requestedShipOn > access.through ||
      (!access.administrator &&
        !record.repIds.some((id) => access.repIds.includes(id)))
    ) {
      throw new NotFoundException('Shipment files are not available');
    }
    return { files: record.files };
  }

  async accountAccess(externalId: string) {
    const account = await this.repository.account(externalId);
    if (!account) throw new NotFoundException();
    const access = await this.repository.get(account.id);
    let reps: AirtableRep[] = [];
    let directoryUnavailable = false;
    try {
      reps = this.source.configured ? await this.source.reps() : [];
    } catch {
      directoryUnavailable = true;
    }
    return {
      configured: this.source.configured,
      directoryUnavailable,
      ...access,
      reps,
      suggestedRepIds: reps
        .filter((rep) => rep.email === account.email.trim().toLowerCase())
        .map((rep) => rep.id),
    };
  }

  async saveAccess(externalId: string, input: unknown) {
    const parsed = assignmentSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Invalid representative assignments');
    const account = await this.repository.account(externalId);
    if (!account) throw new NotFoundException();
    const current = await this.repository.get(account.id);
    const existing = new Set([
      ...current.assignedRepIds,
      ...(current.ownRepId ? [current.ownRepId] : []),
    ]);
    const assigned = [
      ...parsed.data.assignedRepIds,
      ...(parsed.data.ownRepId ? [parsed.data.ownRepId] : []),
    ];
    // Revocations must not depend on Airtable availability. Validate only new grants.
    if (assigned.some((id) => !existing.has(id))) {
      let reps;
      try {
        reps = await this.source.reps();
      } catch {
        throw new ServiceUnavailableException(
          'Airtable representatives could not be loaded',
        );
      }
      const valid = new Set(reps.map((rep) => rep.id));
      if (assigned.some((id) => !existing.has(id) && !valid.has(id)))
        throw new BadRequestException('Unknown Airtable representative');
    }
    await this.repository.replace(account.id, parsed.data);
    return this.repository.get(account.id);
  }
}
