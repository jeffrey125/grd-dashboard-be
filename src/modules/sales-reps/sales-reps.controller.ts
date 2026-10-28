import type { Principal } from '@modules/auth/auth.repository.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';
import { SalesRepsService } from './sales-reps.service.js';

@Controller('sales-reps')
@AuthPolicy('staff')
export class SalesRepsController {
  constructor(private readonly salesReps: SalesRepsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  listActive() {
    return this.salesReps.listActive();
  }

  @Get('filter-options')
  @Header('Cache-Control', 'no-store')
  filterOptions() {
    return this.salesReps.filterOptions();
  }
}

@Controller('admin/sales-reps')
@AuthPolicy('admin')
export class AdminSalesRepsController {
  constructor(private readonly salesReps: SalesRepsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.salesReps.listAll();
  }

  @Get(':externalId')
  @Header('Cache-Control', 'no-store')
  find(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
  ) {
    return this.salesReps.find(externalId);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.salesReps.create(input, principal.id);
  }

  @Patch(':externalId')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.salesReps.update(externalId, input, principal.id);
  }

  @Delete(':externalId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  remove(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.salesReps.remove(externalId, principal.id);
  }

  @Post(':externalId/restore')
  @Header('Cache-Control', 'no-store')
  restore(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.salesReps.restore(externalId, principal.id);
  }
}
