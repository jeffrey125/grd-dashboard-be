import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';
import type { Principal } from '@modules/auth/auth.repository.js';
import { UpcomingService } from './upcoming.service.js';

@Controller('upcoming-shipments')
@AuthPolicy('staff')
export class UpcomingController {
  constructor(private readonly service: UpcomingService) {}

  @Get('access')
  @Header('Cache-Control', 'no-store')
  access(@CurrentPrincipal() principal: Principal) {
    return this.service.access(principal);
  }

  @Get(':orderId/files')
  @Header('Cache-Control', 'no-store')
  files(
    @CurrentPrincipal() principal: Principal,
    @Param('orderId') orderId: string,
  ) {
    return this.service.files(principal, orderId);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentPrincipal() principal: Principal, @Query() query: unknown) {
    return this.service.list(principal, query);
  }
}

@Controller('admin/accounts/:externalId/upcoming-shipments')
@AuthPolicy('admin')
export class UpcomingAccountsController {
  constructor(private readonly service: UpcomingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.accountAccess(id);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  save(
    @Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    return this.service.saveAccess(id, input);
  }
}
