import type { Principal } from '@modules/auth/auth.repository.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ShipmentsService } from './shipments.service.js';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';

@Controller('shipments')
@AuthPolicy('staff')
export class ShipmentsController {
  constructor(
    @Inject(ShipmentsService) private readonly shipments: ShipmentsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.shipments.list();
  }

  @Get('search')
  @Header('Cache-Control', 'no-store')
  search(@Query() query: unknown) {
    return this.shipments.search(query);
  }

  @Get(':externalId/history')
  @Header('Cache-Control', 'no-store')
  history(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Query() query: unknown,
  ) {
    return this.shipments.history(externalId, query);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.shipments.create(input, principal.id);

    response.status(result.outcome === 'created' ? 201 : 200);

    return result;
  }

  @Get(':externalId')
  @Header('Cache-Control', 'no-store')
  find(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
  ) {
    return this.shipments.find(externalId);
  }

  @Patch(':externalId')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.shipments.update(externalId, input, principal.id);
  }

  @Delete(':externalId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
  ) {
    return this.shipments.remove(externalId, principal.id);
  }

  @Post(':externalId/pause')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  pause(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.shipments.changeMonitoring(
      externalId,
      'pause',
      input,
      principal.id,
    );
  }

  @Post(':externalId/resume')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resume(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.shipments.changeMonitoring(
      externalId,
      'resume',
      input,
      principal.id,
    );
  }
}
