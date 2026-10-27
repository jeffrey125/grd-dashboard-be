import { z } from 'zod';

export function authConfiguration(environment: Record<string, unknown>) {
  const origin = z.url().refine((value) => {
    if (!URL.canParse(value)) return false;

    const url = new URL(value);

    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      !url.hostname.includes('*') &&
      (environment.NODE_ENV !== 'production' || url.protocol === 'https:')
    );
  });
  const parsed = z
    .object({
      AUTH_SECRET: z.string().min(32),
      AUTH_BASE_URL: origin,
      AUTH_TRUSTED_ORIGINS: z
        .string()
        .transform((value) => value.split(',').map((item) => item.trim()))
        .pipe(z.array(origin).min(1)),
      AUTH_TRUST_PROXY: z
        .enum(['false', 'loopback', 'digitalocean'])
        .default('false'),
    })
    .safeParse(environment);

  if (!parsed.success) throw new Error('Invalid auth configuration');

  return {
    secret: parsed.data.AUTH_SECRET,
    baseURL: new URL(parsed.data.AUTH_BASE_URL).origin,
    origins: parsed.data.AUTH_TRUSTED_ORIGINS.map(
      (value) => new URL(value).origin,
    ),
    secure: environment.NODE_ENV === 'production',
    trustProxy:
      parsed.data.AUTH_TRUST_PROXY === 'false'
        ? (false as const)
        : parsed.data.AUTH_TRUST_PROXY,
  };
}

export type AuthConfiguration = ReturnType<typeof authConfiguration>;

export const AUTH_CONFIGURATION = Symbol('AUTH_CONFIGURATION');
