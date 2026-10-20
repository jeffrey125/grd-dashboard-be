import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';
import type { Principal } from '@modules/auth/auth.repository.js';
import {
  ProviderAdminRepository,
  providerSettingsInput,
  readinessInput,
} from './provider-admin.repository.js';
import { providerCode } from './quote.schemas.js';

@Controller('admin/shipping-providers')
@AuthPolicy('admin')
export class ProviderAdminController {
  constructor(
    @Inject(ProviderAdminRepository)
    private readonly repository: ProviderAdminRepository,
  ) {}

  private code(raw: string) {
    const parsed = providerCode.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Unknown provider');
    return parsed.data;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  settings() {
    return this.repository.settings();
  }

  @Patch(':code')
  @Header('Cache-Control', 'no-store')
  async save(
    @Param('code') raw: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    const input = providerSettingsInput.safeParse(body);
    if (!input.success)
      throw new BadRequestException('Invalid provider settings');
    await this.repository.save(this.code(raw), input.data, principal.id);
    return this.repository.settings();
  }

  @Post(':code/connection-tests')
  @Header('Cache-Control', 'no-store')
  test(
    @Param('code') raw: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
  ) {
    const input = readinessInput.safeParse(body);
    if (!input.success) throw new BadRequestException('Invalid execution mode');
    return this.repository.enqueue(
      this.code(raw),
      input.data.executionMode,
      principal.id,
    );
  }

  @Get(':code/connection-tests/:id')
  @Header('Cache-Control', 'no-store')
  result(
    @Param('code') raw: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.repository.result(this.code(raw), id, principal.id);
  }
}
