import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthPolicy } from '@modules/auth/auth.policy.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { EventsSource } from './events.source.js';
import { eventStream } from './event-stream.js';

@Controller('events')
@AuthPolicy('staff')
export class EventsController {
  constructor(
    @Inject(EventsSource) private readonly events: EventsSource,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  stream(@Req() request: Request, @Res() response: Response) {
    const headers = fromNodeHeaders(request.headers);
    eventStream(
      response,
      this.events,
      async () => {
        const principal = await this.auth.authenticate(headers);
        return (
          !principal.mustChangePassword &&
          ['staff', 'admin'].includes(principal.role)
        );
      },
      (event) => event.type !== 'quote.changed',
    );
  }
}
