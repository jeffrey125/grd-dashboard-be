import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  configuration,
  type RuntimeConfiguration,
} from '@config/configuration.js';
import { RuntimeConfigModule } from '@config/config.module.js';
import { AirtableUpcomingSource } from './airtable-upcoming.source.js';
import { UPCOMING_ACCESS, UPCOMING_SOURCE } from './upcoming.contracts.js';
import {
  UpcomingAccountsController,
  UpcomingController,
} from './upcoming.controller.js';
import { UpcomingService } from './upcoming.service.js';
import { TypeOrmUpcomingAccessRepository } from './typeorm-upcoming-access.repository.js';

@Module({
  imports: [RuntimeConfigModule],
  controllers: [UpcomingController, UpcomingAccountsController],
  providers: [
    UpcomingService,
    {
      provide: UPCOMING_SOURCE,
      inject: [configuration.KEY],
      useFactory: (config: RuntimeConfiguration) =>
        new AirtableUpcomingSource(config.upcomingShipments.token),
    },
    {
      provide: UPCOMING_ACCESS,
      inject: [DataSource],
      useFactory: (source: DataSource) =>
        new TypeOrmUpcomingAccessRepository(source),
    },
  ],
})
export class UpcomingModule {}
