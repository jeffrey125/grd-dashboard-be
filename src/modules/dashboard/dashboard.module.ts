import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { dashboardRepositoryProvider } from './typeorm-dashboard.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [DashboardController],
  providers: [dashboardRepositoryProvider, DashboardService],
})
export class DashboardModule {}
