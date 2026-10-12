import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { CarriersController } from './carriers.controller.js';
import { CARRIERS_REPOSITORY } from './carriers.repository.js';
import { CarriersService } from './carriers.service.js';
import { carriersRepositoryProvider } from './typeorm-carriers.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [CarriersController],
  providers: [carriersRepositoryProvider, CarriersService],
  exports: [CARRIERS_REPOSITORY, CarriersService],
})
export class CarriersModule {}
