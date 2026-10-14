import type { Principal } from '@modules/auth/auth.repository.js';
import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CarriersService } from './carriers.service.js';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';

@Controller('carriers')
@AuthPolicy('staff')
export class CarriersController {
  constructor(
    @Inject(CarriersService) private readonly carriers: CarriersService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.carriers.list();
  }

  @Get(':externalId')
  @Header('Cache-Control', 'no-store')
  find(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
  ) {
    return this.carriers.find(externalId);
  }

  @AuthPolicy('admin')
  @Patch(':externalId')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.carriers.update(externalId, input, principal.id);
  }
}
