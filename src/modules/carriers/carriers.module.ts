import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { CarriersController } from './carriers.controller.js';
import { CarriersService } from './carriers.service.js';
import { TypeOrmCarriersRepository } from './typeorm-carriers.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [CarriersController],
  providers: [TypeOrmCarriersRepository, CarriersService],
  exports: [TypeOrmCarriersRepository, CarriersService],
})
export class CarriersModule {}
