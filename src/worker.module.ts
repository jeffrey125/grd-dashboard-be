import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from './config/config.module.js';
import { ReadinessModule } from './modules/health/readiness.module.js';
import { WorkerLifetimeService } from './runtime/worker-lifetime.service.js';

@Module({
  imports: [RuntimeConfigModule, ReadinessModule],
  providers: [WorkerLifetimeService],
})
export class WorkerModule {}
