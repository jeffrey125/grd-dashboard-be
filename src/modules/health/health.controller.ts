import { Controller, Get, Header, Inject } from '@nestjs/common';
import { AuthPolicy } from '@modules/auth/auth.policy.js';
import { ReadinessService } from './readiness.service.js';

@Controller('health')
@AuthPolicy('public')
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
