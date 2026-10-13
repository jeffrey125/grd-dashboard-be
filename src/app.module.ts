import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '@config/config.module.js';
import { ApplicationCacheModule } from '@infrastructure/cache/application-cache.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { LoggingModule } from '@infrastructure/logging/logging.module.js';
import { HealthModule } from '@modules/health/health.module.js';
import { CarriersModule } from '@modules/carriers/carriers.module.js';
import { ShipmentsModule } from '@modules/shipments/shipments.module.js';

@Module({
  imports: [
    RuntimeConfigModule,
    LoggingModule.forRoot('api'),
    ApplicationCacheModule,
    DatabaseModule,
    HealthModule,
    CarriersModule,
    ShipmentsModule,
  ],
})
export class AppModule {}
