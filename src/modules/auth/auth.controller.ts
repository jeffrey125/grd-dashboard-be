import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthService } from './auth.service.js';
import {
  AuthPolicy,
  AuthRateLimit,
  CurrentPrincipal,
  type AuthenticatedRequest,
} from './auth.policy.js';
import type { Principal } from './auth.repository.js';
import { emptySchema, parseAuth } from './auth.schemas.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('sign-in')
  @HttpCode(200)
  @AuthPolicy('public')
  @AuthRateLimit('login')
  async signIn(
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.signIn(input);

    response.setHeader('Set-Cookie', result.cookies);

    return result.user;
  }

  @Get('me')
  @AuthPolicy('session')
  current(@CurrentPrincipal() principal: Principal) {
    return this.auth.current(principal);
  }

  @Post('sign-out')
  @HttpCode(204)
  @AuthPolicy('session')
  async signOut(
    @CurrentPrincipal() principal: Principal,
    @Req() request: AuthenticatedRequest,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    parseAuth(emptySchema, input ?? {});
    response.setHeader(
      'Set-Cookie',
      await this.auth.signOut(principal, fromNodeHeaders(request.headers)),
    );
  }

  @Post('change-password')
  @HttpCode(204)
  @AuthPolicy('session')
  @AuthRateLimit('password')
  changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body() input: unknown,
  ) {
    return this.auth.changePassword(principal, input);
  }
}
