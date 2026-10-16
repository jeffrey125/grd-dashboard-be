import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import {
  AdminSalesRepsController,
  SalesRepsController,
} from './sales-reps.controller.js';
import { SALES_REPS_REPOSITORY } from './sales-reps.repository.js';
import { SalesRepsService } from './sales-reps.service.js';
import { salesRepsRepositoryProvider } from './typeorm-sales-reps.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [SalesRepsController, AdminSalesRepsController],
  providers: [salesRepsRepositoryProvider, SalesRepsService],
  exports: [SALES_REPS_REPOSITORY, SalesRepsService],
})
export class SalesRepsModule {}
