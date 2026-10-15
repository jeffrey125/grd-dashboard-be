import { Inject, Injectable } from '@nestjs/common';
import {
  DASHBOARD_REPOSITORY,
  type DashboardRepository,
} from './dashboard.repository.js';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DASHBOARD_REPOSITORY)
    private readonly repository: DashboardRepository,
  ) {}

  overview() {
    return this.repository.overview();
  }
}
