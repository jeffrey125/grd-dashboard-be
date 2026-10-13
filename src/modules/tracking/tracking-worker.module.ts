import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { carriersRepositoryProvider } from '@modules/carriers/typeorm-carriers.repository.js';
import { CarrierAdaptersModule } from '@modules/carriers/adapters/carrier-adapters.module.js';
import { TrackingModule } from './tracking.module.js';
import { trackingWorkRepositoryProvider } from './typeorm-tracking-work.repository.js';
import { TrackingExecutorService } from './tracking-executor.service.js';
import { TrackingSchedulerService } from './tracking-scheduler.service.js';

@Module({
  imports: [
    DatabaseModule,
    TrackingModule,
    CarrierAdaptersModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    carriersRepositoryProvider,
    trackingWorkRepositoryProvider,
    TrackingExecutorService,
    TrackingSchedulerService,
  ],
  exports: [TrackingSchedulerService],
})
export class TrackingWorkerModule {}
