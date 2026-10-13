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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ShipmentsService } from './shipments.service.js';

// V1-010 must enforce Shipment authorization before public deployment.
@Controller('shipments')
export class ShipmentsController {
  constructor(
    @Inject(ShipmentsService) private readonly shipments: ShipmentsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.shipments.list();
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.shipments.create(input);
    response.status(result.inserted.length ? 201 : 200);
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
  updateNotes(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input: unknown,
  ) {
    return this.shipments.updateNotes(externalId, input);
  }

  @Delete(':externalId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  remove(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
  ) {
    return this.shipments.remove(externalId);
  }

  @Post(':externalId/pause')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  pause(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input?: unknown,
  ) {
    return this.shipments.changeMonitoring(externalId, 'pause', input);
  }

  @Post(':externalId/resume')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resume(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    externalId: string,
    @Body() input?: unknown,
  ) {
    return this.shipments.changeMonitoring(externalId, 'resume', input);
  }
}
