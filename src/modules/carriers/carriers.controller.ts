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

@Controller('carriers')
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

  // V1-010 must enforce the approved admin-only policy before public deployment.
  @Patch(':externalId')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input: unknown,
  ) {
    return this.carriers.update(externalId, input);
  }
}
