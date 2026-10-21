import { z } from 'zod';

export const PROVIDERS = ['unishippers'] as const;
export type ProviderCode = (typeof PROVIDERS)[number];

export const EXECUTION_MODES = ['request', 'browser'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const FIXTURE_SCENARIOS = [
  'domestic-success',
  'validation-error',
  'authentication-expiry',
  'unsupported-route',
] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

const fixtureRequestSchema = z.object({
  method: z.string().regex(/^[A-Z]+$/),
  path: z.string().startsWith('/'),
  headerNames: z.array(z.string().min(1)),
  payload: z.unknown(),
});

const fixtureResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  outcome: z.enum(['success', 'validation-error', 'expired', 'unsupported']),
  summary: z.record(z.string(), z.unknown()),
});

export const contractFixtureSchema = z.object({
  provider: z.enum(PROVIDERS),
  scenario: z.enum(FIXTURE_SCENARIOS),
  mode: z.enum(EXECUTION_MODES),
  request: fixtureRequestSchema,
  response: fixtureResponseSchema,
  identifiers: z.record(z.string(), z.literal('<resolved-at-runtime>')),
});

export type ContractFixture = z.infer<typeof contractFixtureSchema>;

export const capabilityValueSchema = z.enum([
  'supported',
  'unsupported',
  'partially-verified',
  'unverified',
]);

export const capabilityMatrixRowSchema = z.object({
  provider: z.enum(PROVIDERS),
  domestic: capabilityValueSchema,
  international: capabilityValueSchema,
  accountDefaults: capabilityValueSchema,
  units: z.string().min(1),
  packageQuantity: z.string().min(1),
  signature: capabilityValueSchema,
  insuranceDeclaredValue: capabilityValueSchema,
  dutyTax: capabilityValueSchema,
  chargeScope: z.string().min(1),
  transitData: capabilityValueSchema,
  quoteExpiry: capabilityValueSchema,
  requestMode: capabilityValueSchema,
  browserMode: capabilityValueSchema,
});

export type CapabilityMatrixRow = z.infer<typeof capabilityMatrixRowSchema>;

export const providerCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type ProviderCredentials = z.infer<typeof providerCredentialsSchema>;

export const CREDENTIAL_ENV: Record<
  ProviderCode,
  { email: string; password: string }
> = {
  unishippers: {
    email: 'MYUNISHIPPERS_EMAIL',
    password: 'MYUNISHIPPERS_PASSWORD',
  },
};

export function readProviderCredentials(
  provider: ProviderCode,
  environment: NodeJS.ProcessEnv = process.env,
): ProviderCredentials {
  const names = CREDENTIAL_ENV[provider];
  const email = environment[names.email]?.trim();
  const password = environment[names.password];

  if (!email || !password)
    throw new Error(
      `Missing ${names.email} or ${names.password}; values are intentionally not included`,
    );

  return providerCredentialsSchema.parse({ email, password });
}

export function availableProviders(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderCode[] {
  return PROVIDERS.filter((provider) => {
    const names = CREDENTIAL_ENV[provider];
    return Boolean(environment[names.email] && environment[names.password]);
  });
}

const sensitiveKey =
  /^(?:password|cookie|authorization|sessionToken|secret|credential)$/i;

/**
 * Checks a fixture tree without inspecting or printing secret values.
 * Header names such as `cookie` and `authorization` are allowed because the
 * contract records names, never their values.
 */
export function assertSanitizedFixture(value: unknown): void {
  const visit = (current: unknown, path: string) => {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }

    if (!current || typeof current !== 'object') return;

    for (const [key, entry] of Object.entries(current)) {
      if (sensitiveKey.test(key) && key !== 'headerNames')
        throw new Error(`Sensitive fixture key at ${path}.${key}`);
      visit(entry, `${path}.${key}`);
    }
  };

  visit(value, '$');
}

export function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

export function safeHeaderNames(
  headers: Headers | Record<string, string>,
): string[] {
  return Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
}

export class ProviderAuthenticationChallenge extends Error {
  constructor(readonly provider: ProviderCode) {
    super(`${provider} authentication challenge detected`);
    this.name = 'ProviderAuthenticationChallenge';
  }
}

export class ProviderAuthenticationExpired extends Error {
  constructor(readonly provider: ProviderCode) {
    super(`${provider} authentication expired`);
    this.name = 'ProviderAuthenticationExpired';
  }
}

export class ProviderContractBlocker extends Error {
  constructor(
    readonly provider: ProviderCode,
    message: string,
  ) {
    super(`${provider} contract blocker: ${message}`);
    this.name = 'ProviderContractBlocker';
  }
}

export type QuoteInput = {
  originZip: string;
  destinationZip: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity: number;
  country: string;
};

export type QuoteResult = {
  status: number;
  body: unknown;
  endpointPath: string;
  requestHeaderNames: string[];
  identifiers: Record<string, string>;
};
