import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';
import type { Principal } from '@modules/auth/auth.repository.js';
import { TrackingHttpService } from './tracking-http.service.js';
import { TypeOrmTrackingHttpRepository } from './typeorm-tracking-http.repository.js';
import { TRACKING_HTTP_REPOSITORY } from './tracking-http.repository.js';

@Controller()
@AuthPolicy('staff')
class TrackingHttpController {
  constructor(
    @Inject(TrackingHttpService) private readonly tracking: TrackingHttpService,
  ) {}
  @Post('shipments/:externalId/refresh')
  @HttpCode(202)
  refresh(
    @Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.tracking.refresh(id, principal.id, body);
  }
  @Get('tracking-runs/:externalId')
  find(@Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.tracking.find(id);
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [TrackingHttpController],
  providers: [
    TrackingHttpService,
    {
      provide: TRACKING_HTTP_REPOSITORY,
      inject: [DataSource],
      useFactory: (source: DataSource) =>
        new TypeOrmTrackingHttpRepository(source),
    },
  ],
})
export class TrackingHttpModule {}
