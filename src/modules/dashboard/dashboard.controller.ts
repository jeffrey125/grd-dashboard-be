import { Controller, Get, Header, Inject } from '@nestjs/common';
import { AuthPolicy } from '@modules/auth/auth.policy.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@AuthPolicy('staff')
export class DashboardController {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
  ) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview() {
    return this.dashboard.overview();
  }
}
