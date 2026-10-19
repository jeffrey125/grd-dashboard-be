import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthPolicy } from '@modules/auth/auth.policy.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { EventsSource } from '@modules/events/events.source.js';
import { eventStream } from '@modules/events/event-stream.js';
import { QuoteService } from './quote.service.js';

@Controller('quote-comparisons')
@AuthPolicy('staff')
export class QuoteEventsController {
  constructor(
    @Inject(EventsSource) private readonly events: EventsSource,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(QuoteService) private readonly quotes: QuoteService,
  ) {}

  @Get(':externalId/events')
  async stream(
    @Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    // Shared staff history is intentional; deleted/missing comparisons are inaccessible.
    const comparisonId = id.toLowerCase();

    await this.quotes.find(comparisonId);
    const headers = fromNodeHeaders(request.headers);
    eventStream(
      response,
      this.events,
      async () => {
        const principal = await this.auth.authenticate(headers);
        if (
          principal.mustChangePassword ||
          !['staff', 'admin'].includes(principal.role)
        )
          return false;
        await this.quotes.find(comparisonId);
        return true;
      },
      (event) =>
        event.type === 'resync' ||
        event.type === 'heartbeat' ||
        (event.type === 'quote.changed' && event.externalId === comparisonId),
    );
  }
}
