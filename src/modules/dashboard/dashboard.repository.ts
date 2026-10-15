import type { z } from 'zod';
import type { dashboardOverviewResponseSchema } from './dashboard.schemas.js';

export type DashboardOverview = z.infer<typeof dashboardOverviewResponseSchema>;

export interface DashboardRepository {
  overview(): Promise<DashboardOverview>;
}

export const DASHBOARD_REPOSITORY = Symbol('DASHBOARD_REPOSITORY');
