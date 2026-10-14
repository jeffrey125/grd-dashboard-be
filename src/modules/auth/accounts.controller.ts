import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthPolicy, AuthRateLimit, CurrentPrincipal } from './auth.policy.js';
import type { Principal } from './auth.repository.js';

@Controller('admin/accounts')
@AuthPolicy('admin')
export class AccountsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get()
  list(@CurrentPrincipal() principal: Principal) {
    return this.auth.listAccounts(principal);
  }
  @Get(':externalId')
  find(
    @CurrentPrincipal() principal: Principal,
    @Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.auth.account(principal, id);
  }
  @Post()
  create(@CurrentPrincipal() principal: Principal, @Body() input: unknown) {
    return this.auth.createAccount(principal, input);
  }
  @Patch(':externalId')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    return this.auth.updateAccount(principal, id, input);
  }
  @Post(':externalId/password')
  @HttpCode(204)
  @AuthRateLimit('password')
  resetPassword(
    @CurrentPrincipal() principal: Principal,
    @Param('externalId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    return this.auth.resetPassword(principal, id, input);
  }
}
