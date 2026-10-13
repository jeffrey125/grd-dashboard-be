import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { CarriersModule } from '@modules/carriers/carriers.module.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { SHIPMENTS_REPOSITORY } from './shipments.repository.js';
import { shipmentsRepositoryProvider } from './typeorm-shipments.repository.js';

@Module({
  imports: [DatabaseModule, CarriersModule],
  controllers: [ShipmentsController],
  providers: [shipmentsRepositoryProvider, ShipmentsService],
  exports: [SHIPMENTS_REPOSITORY, ShipmentsService],
})
export class ShipmentsModule {}
