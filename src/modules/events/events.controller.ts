import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthPolicy } from '@modules/auth/auth.policy.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { EventsSource, type LiveEvent } from './events.source.js';

function eventData(event: LiveEvent) {
  if (event.type === 'tracking.changed')
    return {
      externalId: event.externalId,
      snapshotExternalId: event.snapshotExternalId,
      observedAt: event.observedAt.toISOString(),
    };

  return 'externalId' in event ? { externalId: event.externalId } : {};
}

@Controller('events')
@AuthPolicy('staff')
export class EventsController {
  constructor(
    @Inject(EventsSource) private readonly events: EventsSource,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  stream(@Req() request: Request, @Res() response: Response) {
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    const headers = fromNodeHeaders(request.headers);
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
      if (closed) return;

      if (++queued > 100 || response.writableLength > 65536) {
        close();

        return;
      }

      pending = pending
        .then(async () => {
          if (closed) return;

          const principal = await this.auth.authenticate(headers);

          if (
            principal.mustChangePassword ||
            !['staff', 'admin'].includes(principal.role)
          ) {
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
    const subscription = this.events.events.subscribe({
      next: send,
      complete: () => queueMicrotask(close),
    });

    response.on('close', close);
    send({ type: 'resync' });
    this.events.start();
  }
}
