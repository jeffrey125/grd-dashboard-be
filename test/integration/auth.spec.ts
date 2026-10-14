import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { createAuthEngine } from '@modules/auth/auth.engine.js';
import { TypeOrmAuthRepository } from '@modules/auth/typeorm-auth.repository.js';
import { AuthService } from '@modules/auth/auth.service.js';

describe('employee account lifecycle with PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let auth: AuthService;
  const origin = 'http://dashboard.example.test';
  const input = {
    firstName: 'Initial',
    lastName: 'Admin',
    email: 'ADMIN@example.test',
    password: 'initial password 123',
    role: 'admin',
  };

  beforeAll(async () => {
    db = await shipmentDatabase();
    auth = new AuthService(
      new TypeOrmAuthRepository(db.source),
      createAuthEngine(db.source, {
        secret: 'test-secret-'.repeat(4),
        baseURL: 'http://api.example.test',
        origins: [origin],
        secure: false,
        trustProxy: false,
      }),
    );
  });
  afterAll(async () => {
    await db?.close();
  });
  it('creates only one initial admin and restricts its issued password until replacement', async () => {
    const results = await Promise.allSettled([
      auth.bootstrap(input),
      auth.bootstrap(input),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);

    const login = await auth.signIn({
      email: input.email,
      password: input.password,
    });

    expect(login.user).toMatchObject({
      email: 'admin@example.test',
      role: 'admin',
      mustChangePassword: true,
    });
    expect(JSON.stringify(login.user)).not.toContain('token');

    const headers = new Headers({
      cookie: login.cookies.map((value) => value.split(';')[0]).join('; '),
    });
    const principal = await auth.authenticate(headers);

    expect(principal.mustChangePassword).toBe(true);

    await auth.changePassword(principal, {
      currentPassword: input.password,
      newPassword: 'employee chosen password 123',
    });
    await expect(auth.authenticate(headers)).rejects.toMatchObject({
      status: 401,
    });

    const fresh = await auth.signIn({
      email: input.email,
      password: 'employee chosen password 123',
    });

    expect(fresh.user.mustChangePassword).toBe(false);
  });

  const headersFor = (cookies: string[]) =>
    new Headers({
      cookie: cookies.map((value) => value.split(';')[0]).join('; '),
    });

  it('allows admins to provision staff, rejects staff administration, and revokes reset/deactivated sessions', async () => {
    const login = await auth.signIn({
      email: input.email,
      password: 'employee chosen password 123',
    });
    const admin = await auth.authenticate(headersFor(login.cookies));
    const staff = await auth.createAccount(admin, {
      firstName: 'Employee',
      lastName: 'One',
      email: 'staff@example.test',
      role: 'staff',
      password: 'issued staff password',
    });
    const staffLogin = await auth.signIn({
      email: staff.email,
      password: 'issued staff password',
    });
    const restricted = await auth.authenticate(headersFor(staffLogin.cookies));

    await expect(auth.listAccounts(restricted)).rejects.toMatchObject({
      status: 403,
    });
    await auth.changePassword(restricted, {
      currentPassword: 'issued staff password',
      newPassword: 'chosen staff password',
    });

    const first = await auth.signIn({
      email: staff.email,
      password: 'chosen staff password',
    });
    const second = await auth.signIn({
      email: staff.email,
      password: 'chosen staff password',
    });
    const staffPrincipal = await auth.authenticate(headersFor(first.cookies));

    await expect(
      auth.createAccount(staffPrincipal, {
        ...input,
        email: 'forged@example.test',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await auth.signOut(staffPrincipal, headersFor(first.cookies));
    await expect(
      auth.authenticate(headersFor(first.cookies)),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      auth.authenticate(headersFor(second.cookies)),
    ).resolves.toMatchObject({ role: 'staff' });
    await auth.resetPassword(admin, staff.externalId, {
      password: 'reset staff password',
    });
    await expect(
      auth.authenticate(headersFor(second.cookies)),
    ).rejects.toMatchObject({ status: 401 });

    const resetLogin = await auth.signIn({
      email: staff.email,
      password: 'reset staff password',
    });

    expect(resetLogin.user.mustChangePassword).toBe(true);

    await auth.updateAccount(admin, staff.externalId, { active: false });
    await expect(
      auth.authenticate(headersFor(resetLogin.cookies)),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      auth.signIn({ email: staff.email, password: 'reset staff password' }),
    ).rejects.toMatchObject({ status: 401 });

    expect(
      (await auth.listAccounts(admin)).find(
        (user) => user.externalId === staff.externalId,
      )?.active,
    ).toBe(false);

    await expect(
      auth.updateAccount(admin, admin.externalId, { active: false }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      auth.updateAccount(admin, admin.externalId, { role: 'staff' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('keeps fixed expiry, supports concurrent logins beyond pool size, and revokes on identity changes', async () => {
    const sessions = await Promise.all(
      Array.from({ length: 12 }, () =>
        auth.signIn({
          email: input.email,
          password: 'employee chosen password 123',
        }),
      ),
    );
    const headers = headersFor(sessions[0]!.cookies);
    const principal = await auth.authenticate(headers);
    const [before] = await db.source.query(
      'SELECT created_at, expires_at FROM auth_sessions WHERE id = $1',
      [principal.sessionId],
    );

    expect(
      before.expires_at.getTime() - before.created_at.getTime(),
    ).toBeCloseTo(86400000, -3);

    await auth.authenticate(headers);

    const [after] = await db.source.query(
      'SELECT expires_at FROM auth_sessions WHERE id = $1',
      [principal.sessionId],
    );

    expect(after.expires_at).toEqual(before.expires_at);

    await db.source.query(
      "UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE id = $1",
      [principal.sessionId],
    );
    await expect(auth.authenticate(headers)).rejects.toMatchObject({
      status: 401,
    });

    const admin = await auth.authenticate(headersFor(sessions[1]!.cookies));

    await expect(
      auth.createAccount(admin, { ...input, email: ' ADMIN@EXAMPLE.TEST ' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      auth.changePassword(admin, {
        currentPassword: 'wrong password',
        newPassword: 'different password 123',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      auth.changePassword(admin, {
        currentPassword: 'employee chosen password 123',
        newPassword: 'employee chosen password 123',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await auth.updateAccount(admin, admin.externalId, {
      email: 'renamed@example.test',
    });
    await expect(
      auth.authenticate(headersFor(sessions[1]!.cookies)),
    ).rejects.toMatchObject({ status: 401 });
    await auth.recoverAdmin('renamed@example.test', {
      password: 'operator recovery password',
    });

    const recovered = await auth.signIn({
      email: 'renamed@example.test',
      password: 'operator recovery password',
    });

    expect(recovered.user.mustChangePassword).toBe(true);

    await expect(
      auth.recoverAdmin('staff@example.test', {
        password: 'operator recovery password',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await auth.changePassword(
      await auth.authenticate(headersFor(recovered.cookies)),
      {
        currentPassword: 'operator recovery password',
        newPassword: 'new administrator password',
      },
    );
  });
  it('serializes login against reset and emits secure host-only production cookies', async () => {
    const login = await auth.signIn({
      email: 'renamed@example.test',
      password: 'new administrator password',
    });
    const admin = await auth.authenticate(headersFor(login.cookies));
    const account = await auth.createAccount(admin, {
      ...input,
      role: 'staff',
      email: 'race@example.test',
    });
    const results = await Promise.allSettled([
      auth.signIn({ email: account.email, password: input.password }),
      auth.resetPassword(admin, account.externalId, {
        password: 'reset race password',
      }),
    ]);

    if (results[0].status === 'fulfilled')
      await expect(
        auth.authenticate(headersFor(results[0].value.cookies)),
      ).rejects.toMatchObject({ status: 401 });

    expect(results[1].status).toBe('fulfilled');

    await expect(
      auth.signIn({ email: account.email, password: input.password }),
    ).rejects.toMatchObject({ status: 401 });

    const secureAuth = new AuthService(
      new TypeOrmAuthRepository(db.source),
      createAuthEngine(db.source, {
        secret: 'test-secret-'.repeat(4),
        baseURL: 'https://api.example.test',
        origins: ['https://dashboard.example.test'],
        secure: true,
        trustProxy: false,
      }),
    );
    const secureLogin = await secureAuth.signIn({
      email: account.email,
      password: 'reset race password',
    });

    expect(secureLogin.cookies.join(';')).toContain('Secure');
    expect(secureLogin.cookies.join(';')).toContain('HttpOnly');
    expect(secureLogin.cookies.join(';')).not.toMatch(/Domain=/i);
  });
  it('serializes mutual administrator demotions and preserves audit references', async () => {
    const login = await auth.signIn({
      email: 'renamed@example.test',
      password: 'new administrator password',
    });
    const first = await auth.authenticate(headersFor(login.cookies));
    const secondUser = await auth.createAccount(first, {
      ...input,
      email: 'second-admin@example.test',
    });
    const issued = await auth.signIn({
      email: secondUser.email,
      password: input.password,
    });

    await auth.changePassword(
      await auth.authenticate(headersFor(issued.cookies)),
      {
        currentPassword: input.password,
        newPassword: 'second chosen password',
      },
    );

    const secondLogin = await auth.signIn({
      email: secondUser.email,
      password: 'second chosen password',
    });
    const second = await auth.authenticate(headersFor(secondLogin.cookies));
    const results = await Promise.allSettled([
      auth.updateAccount(first, second.externalId, { role: 'staff' }),
      auth.updateAccount(second, first.externalId, { role: 'staff' }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await db.source.query(
        "SELECT id FROM auth_users WHERE active AND role = 'admin'",
      ),
    ).toHaveLength(1);

    await expect(
      db.source.query('DELETE FROM auth_users WHERE id = $1', [first.id]),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await expect(
      db.source.query(
        'UPDATE auth_users SET external_id = gen_random_uuid() WHERE id = $1',
        [first.id],
      ),
    ).rejects.toThrow();
  });
});
