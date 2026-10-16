import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module.js';
import { RuntimeConfigModule } from '@config/config.module.js';
import { ApplicationCacheModule } from '@infrastructure/cache/application-cache.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { LoggingModule } from '@infrastructure/logging/logging.module.js';
import { HealthModule } from '@modules/health/health.module.js';
import { CarriersModule } from '@modules/carriers/carriers.module.js';
import { ShipmentsModule } from '@modules/shipments/shipments.module.js';
import { TrackingHttpModule } from '@modules/tracking/tracking-http.module.js';
import { EventsModule } from '@modules/events/events.module.js';
import { DashboardModule } from '@modules/dashboard/dashboard.module.js';
import { SalesRepsModule } from '@modules/sales-reps/sales-reps.module.js';

@Module({
  imports: [
    RuntimeConfigModule,
    LoggingModule.forRoot('api'),
    ApplicationCacheModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    CarriersModule,
    ShipmentsModule,
    TrackingHttpModule,
    EventsModule,
    DashboardModule,
    SalesRepsModule,
  ],
})
export class AppModule {}
