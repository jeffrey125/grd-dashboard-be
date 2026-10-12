import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { DatabaseReadiness } from '@infrastructure/database/database-readiness.js';
import {
  READINESS_DEPENDENCIES,
  ReadinessService,
} from './readiness.service.js';

@Module({
  imports: [DatabaseModule, TerminusModule.forRoot({ logger: false })],
  providers: [
    ReadinessService,
    DatabaseReadiness,
    {
      provide: READINESS_DEPENDENCIES,
      inject: [DatabaseReadiness],
      useFactory: (database: DatabaseReadiness) => [
        {
          name: 'database',
          check: (signal: AbortSignal) => database.check(signal),
        },
      ],
    },
  ],
  exports: [ReadinessService, READINESS_DEPENDENCIES],
})
export class ReadinessModule {}
