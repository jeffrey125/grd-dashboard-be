import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from './config/config.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [RuntimeConfigModule, HealthModule],
})
export class AppModule {}
