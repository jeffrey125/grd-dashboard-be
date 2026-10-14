import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@modules/auth/auth.service.js';

/** Real credentials and sessions for existing business-route regression tests. */
export async function administratorCookie(app: INestApplication) {
  const auth = app.get(AuthService);
  const email = 'fixture@example.test';

  await auth.bootstrap({
    firstName: 'Fixture',
    lastName: 'Admin',
    email,
    role: 'admin',
    password: 'issued fixture password',
  });

  const issued = await auth.signIn({
    email,
    password: 'issued fixture password',
  });
  const cookie = (values: string[]) =>
    values.map((value) => value.split(';')[0]).join('; ');
  const principal = await auth.authenticate(
    new Headers({ cookie: cookie(issued.cookies) }),
  );

  await auth.changePassword(principal, {
    currentPassword: 'issued fixture password',
    newPassword: 'chosen fixture password',
  });

  return cookie(
    (await auth.signIn({ email, password: 'chosen fixture password' })).cookies,
  );
}
