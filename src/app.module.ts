import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from './config/config.module.js';
import { LoggingModule } from './infrastructure/logging/logging.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [RuntimeConfigModule, LoggingModule.forRoot('api'), HealthModule],
})
export class AppModule {}
