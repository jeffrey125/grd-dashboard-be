import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import type { Principal } from '@modules/auth/auth.repository.js';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@AuthPolicy('staff')
export class DashboardController {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
  ) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview(@Query() query: unknown, @CurrentPrincipal() principal: Principal) {
    return this.dashboard.overview(query, principal.id);
  }
}
