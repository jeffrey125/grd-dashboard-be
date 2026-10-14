import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthService } from './auth.service.js';
import {
  AUTH_POLICY,
  type AuthenticatedRequest,
  type RoutePolicy,
} from './auth.policy.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const policy = this.reflector.getAllAndOverride<RoutePolicy | undefined>(
      AUTH_POLICY,
      [context.getHandler(), context.getClass()],
    );

    if (!policy) throw new ForbiddenException('Route has no access policy');

    if (policy === 'public') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.auth.authenticate(
      fromNodeHeaders(request.headers),
    );

    request.principal = principal;

    if (policy === 'session') return true;

    if (principal.mustChangePassword)
      throw new ForbiddenException('Password change required');

    if (policy === 'admin' && principal.role !== 'admin')
      throw new ForbiddenException();

    if (principal.role !== 'admin' && principal.role !== 'staff')
      throw new ForbiddenException();

    return true;
  }
}
