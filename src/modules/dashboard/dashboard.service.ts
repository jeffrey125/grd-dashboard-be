import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DASHBOARD_REPOSITORY,
  type DashboardRepository,
} from './dashboard.repository.js';
import { dashboardOverviewQuerySchema } from './dashboard.schemas.js';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DASHBOARD_REPOSITORY)
    private readonly repository: DashboardRepository,
  ) {}

  overview(query: unknown = {}, actorId?: number) {
    const parsed = dashboardOverviewQuerySchema.safeParse(query);

    if (!parsed.success)
      throw new BadRequestException('Invalid overview input');
    if (parsed.data.scope === 'mine' && actorId === undefined)
      throw new BadRequestException('Mine requires an authenticated account');

    return this.repository.overview(
      parsed.data.scope === 'mine' ? actorId : undefined,
    );
  }
}
