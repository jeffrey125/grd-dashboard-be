import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { TrackingNotifications } from './tracking-notifications.js';

@Module({
  providers: [
    { provide: TrackingNotifications, useClass: NotificationsService },
  ],
  exports: [TrackingNotifications],
})
export class NotificationsModule {}
