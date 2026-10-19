import type { Response } from 'express';
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
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();

  let closed = false;
  let queued = 0;
  let pending = Promise.resolve();

  const close = () => {
    if (closed) return;

    closed = true;
    clearInterval(timer);
    subscription.unsubscribe();
    response.off('close', close);
    response.end();
  };

  const send = (event: LiveEvent) => {
    if (closed || !accepts(event)) return;

    if (++queued > 100 || response.writableLength > 65536) {
      close();

      return;
    }

    pending = pending
      .then(async () => {
        if (closed) return;

        if (!(await authorize())) {
          close();

          return;
        }

        if (!closed)
          response.write(
            `event: ${event.type}\ndata: ${JSON.stringify(eventData(event))}\n\n`,
          );
      })
      .catch(close)
      .finally(() => {
        queued--;
      });
  };

  const timer = setInterval(() => send({ type: 'heartbeat' }), 15000);
  const subscription = events.events.subscribe({
    next: send,
    complete: () => queueMicrotask(close),
  });

  response.on('close', close);
  send({ type: 'resync' });
  events.start();
}
