import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthModule } from '@modules/auth/auth.module.js';
import { EventsSource } from './events.source.js';
import { TypeOrmEventsSource } from './typeorm-events.source.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [{ provide: EventsSource, useClass: TypeOrmEventsSource }],
  controllers: [EventsController],
  exports: [EventsSource],
})
export class EventsModule {}
