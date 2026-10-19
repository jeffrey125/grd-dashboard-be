import { SenderDefaultsService } from './sender-defaults.service.js';
import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';
import type { Principal } from '@modules/auth/auth.repository.js';
import { QuoteService } from './quote.service.js';

@Controller('quote-comparisons')
@AuthPolicy('staff')
export class QuoteController {
  constructor(
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(SenderDefaultsService)
    private readonly defaults: SenderDefaultsService,
  ) {}
  @Post('providers/:code/default-refresh')
  @Header('Cache-Control', 'no-store')
  refresh(
    @Param('code') code: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.defaults.refresh(code, principal.id);
  }
  @Get('providers') @Header('Cache-Control', 'no-store') providers() {
    return this.quotes.providers();
  }
  @Get() @Header('Cache-Control', 'no-store') list(@Query() query: unknown) {
    return this.quotes.list(query);
  }
  @Get(':externalId') @Header('Cache-Control', 'no-store') find(
    @Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.quotes.find(id);
  }
  @Post() @Header('Cache-Control', 'no-store') async create(
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.quotes.create(input, principal.id);
    response.status(result.outcome === 'created' ? 201 : 200);
    return result;
  }
}
