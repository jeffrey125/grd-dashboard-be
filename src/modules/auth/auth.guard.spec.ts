import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AUTH_POLICY, type RoutePolicy } from './auth.policy.js';

function fixture(
  policy?: RoutePolicy,
  role: 'staff' | 'admin' = 'staff',
  mustChangePassword = false,
) {
  const handler = () => undefined;

  if (policy) Reflect.defineMetadata(AUTH_POLICY, policy, handler);

  const request = { headers: {} };
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const authenticate = vi.fn().mockResolvedValue({
    id: 1,
    externalId: 'employee',
    sessionId: 1,
    role,
    mustChangePassword,
  });

  return {
    guard: new AuthGuard(new Reflector(), {
      authenticate,
    } as unknown as AuthService),
    context,
    authenticate,
    request,
  };
}

describe('default-deny route policy', () => {
  it('denies handlers with no policy and keeps public handlers independent of sessions', async () => {
    const denied = fixture();

    await expect(
      denied.guard.canActivate(denied.context),
    ).rejects.toMatchObject({ status: 403 });

    const publicRoute = fixture('public');

    await expect(
      publicRoute.guard.canActivate(publicRoute.context),
    ).resolves.toBe(true);

    expect(publicRoute.authenticate).not.toHaveBeenCalled();
  });
  it('requires unrestricted admins for admin routes and accepts staff business access', async () => {
    const staff = fixture('admin');

    await expect(staff.guard.canActivate(staff.context)).rejects.toMatchObject({
      status: 403,
    });

    const restricted = fixture('staff', 'admin', true);

    await expect(
      restricted.guard.canActivate(restricted.context),
    ).rejects.toMatchObject({ status: 403 });

    for (const policy of ['session', 'staff', 'admin'] as const) {
      const allowed = fixture(policy, 'admin', policy === 'session');

      await expect(allowed.guard.canActivate(allowed.context)).resolves.toBe(
        true,
      );

      expect(allowed.request).toHaveProperty('principal.id', 1);
    }

    const employee = fixture('staff');

    await expect(employee.guard.canActivate(employee.context)).resolves.toBe(
      true,
    );
  });
});
