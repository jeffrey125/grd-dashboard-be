import type { Response } from 'express';
import type { MessageEvent } from '@nestjs/common';
import {
  EMPTY,
  catchError,
  concatMap,
  defer,
  endWith,
  filter,
  ignoreElements,
  interval,
  map,
  merge,
  of,
  takeUntil,
  takeWhile,
  tap,
} from 'rxjs';
import type { EventsSource, LiveEvent } from './events.source.js';

function eventData(event: LiveEvent) {
  if (event.type === 'tracking.changed')
    return {
      externalId: event.externalId,
      snapshotExternalId: event.snapshotExternalId,
      observedAt: event.observedAt.toISOString(),
    };

  return 'externalId' in event ? { externalId: event.externalId } : {};
}

/** Bounded serialized frames with fresh authorization, shared by both SSE routes. */
export function eventStream(
  response: Response,
  events: EventsSource,
  authorize: () => Promise<boolean>,
  accepts: (event: LiveEvent) => boolean,
) {
  return defer(() => {
    let queued = 0;

    events.start();

    return merge(
      of<LiveEvent>({ type: 'resync' }),
      events.events,
      interval(15000).pipe(map((): LiveEvent => ({ type: 'heartbeat' }))),
    ).pipe(
      filter(accepts),
      tap(() => {
        // Application limits, independent of Nest's transport buffering.
        if (++queued > 100 || response.writableLength > 65536)
          throw new Error('Live event capacity exceeded');
      }),
      concatMap((event) =>
        defer(async () => ({ event, allowed: await authorize() })),
      ),
      takeWhile(({ allowed }) => allowed),
      map(({ event }): MessageEvent => {
        queued--;
        return { type: event.type, data: eventData(event) };
      }),
      takeUntil(events.events.pipe(ignoreElements(), endWith(true))),
      // Authentication failures close silently; never serialize their diagnostics.
      catchError(() => EMPTY),
    );
  });
}
