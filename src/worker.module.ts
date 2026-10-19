import { SenderDefaultsWorkerModule } from '@modules/shipping-quotes/sender-defaults-worker.module.js';
import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '@config/config.module.js';
import { ApplicationCacheModule } from '@infrastructure/cache/application-cache.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { LoggingModule } from '@infrastructure/logging/logging.module.js';
import { ReadinessModule } from '@modules/health/readiness.module.js';
import { TrackingWorkerModule } from '@modules/tracking/tracking-worker.module.js';

@Module({
  imports: [
    RuntimeConfigModule,
    LoggingModule.forRoot('worker'),
    ApplicationCacheModule,
    DatabaseModule,
    ReadinessModule,
    TrackingWorkerModule,
    SenderDefaultsWorkerModule,
  ],
})
export class WorkerModule {}
