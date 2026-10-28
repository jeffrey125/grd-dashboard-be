import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from './auth.repository.js';

export const AUTH_POLICY = Symbol('AUTH_POLICY');
export const AUTH_RATE_SCOPE = Symbol('AUTH_RATE_SCOPE');

export type RoutePolicy = 'public' | 'session' | 'staff' | 'admin';

export const AuthPolicy = (policy: RoutePolicy) =>
  SetMetadata(AUTH_POLICY, policy);
export const AuthRateLimit = (scope: 'login' | 'password' | 'telemetry') =>
  SetMetadata(AUTH_RATE_SCOPE, scope);

export type AuthenticatedRequest = Request & { principal: Principal };

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);
