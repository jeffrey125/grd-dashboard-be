import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import {
  READINESS_DEPENDENCIES,
  ReadinessService,
} from './readiness.service.js';

@Module({
  imports: [TerminusModule.forRoot({ logger: false })],
  providers: [
    ReadinessService,
    { provide: READINESS_DEPENDENCIES, useValue: [] },
  ],
  exports: [ReadinessService, READINESS_DEPENDENCIES],
})
export class ReadinessModule {}
