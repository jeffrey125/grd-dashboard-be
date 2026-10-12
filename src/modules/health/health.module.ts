import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { ReadinessModule } from './readiness.module.js';

@Module({ imports: [ReadinessModule], controllers: [HealthController] })
export class HealthModule {}
