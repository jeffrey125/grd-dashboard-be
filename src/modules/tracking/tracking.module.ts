import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { TRACKING_REPOSITORY } from './tracking.repository.js';
import { TrackingService } from './tracking.service.js';
import { trackingRepositoryProvider } from './typeorm-tracking.repository.js';
import { NotificationsModule } from '@modules/notifications/notifications.module.js';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  providers: [trackingRepositoryProvider, TrackingService],
  exports: [TRACKING_REPOSITORY, TrackingService],
})
export class TrackingModule {}
