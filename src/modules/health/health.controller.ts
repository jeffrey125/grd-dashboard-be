import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ReadinessService } from './readiness.service.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  ready() {
    return this.readiness.check();
  }
}
