import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import { z } from 'zod';
import type {
  ExecutionResult,
  LeasedQuote,
} from './quote-execution.repository.js';
import { quoteFailure, type QuoteAdapter } from './quote-executor.js';
import type {
  Address,
  QuoteCharge,
  QuoteGroupContribution,
  QuoteInput,
} from './quote.schemas.js';

const LOGIN_TIMEOUT_MS = 30_000;
const RATE_TIMEOUT_MS = 30_000;
const MONEY_SCALE = 1_000_000n;
const PACKAGE_CHARGE_CODES = new Set([
  'BASE_CHARGE',
  'DELIVERY_AREA_SURCHARGE',
  'FUEL_SURCHARGE',
  'RESIDENTIAL_SURCHARGE',
  'PEAK_SURCHARGE',
  'REMOTE_AREA_SURCHARGE',
  'SIGNATURE_CHARGE',
  'ADDITIONAL_HANDLING',
]);
const SHIPMENT_CHARGE_CODES = new Set([
  'SHIPMENT_FEE',
  'ORDER_FEE',
  'TRANSACTION_FEE',
]);
const PICKUP_CHARGE_CODES = new Set(['PICKUP_FEE']);

const moneySchema = z.object({
  unit: z.string().regex(/^[A-Z]{3}$/),
  value: z.union([z.number().finite().nonnegative(), z.string().min(1)]),
});

const responseSchema = z.object({
  totalCharge: moneySchema,
  shippingCharges: z
    .array(
      z.object({
        chargeCode: z.string().min(1),
        chargeCodeType: z.string().optional(),
        charge: moneySchema.optional(),
        value: z
          .union([z.number().finite().nonnegative(), z.string().min(1)])
          .optional(),
        unit: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
      }),
    )
    .default([]),
  carrier: z.string().min(1).optional(),
  deliveringCarrier: z.string().min(1).optional(),
  service: z.string().min(1).optional(),
  serviceName: z.string().min(1).optional(),
  transitDescription: z.string().min(1).optional(),
  estimatedDeliveryDate: z.string().min(1).optional(),
  expiresAt: z.string().min(1).optional(),
});

type AmazonSession = {
  merchantId: string;
  proposalId: string;
  xsrfToken: string;
};

type AmazonRate = {
  carrier: string;
  service: string;
  total: string;
  currency: string;
  transitDescription: string | null;
  expiresAt: string | null;
  charges: QuoteCharge[];
};

type AmazonGroup = {
  packageGroupPosition: number;
  quantity: number;
};

export type AmazonRateBatch = {
  rate: AmazonRate;
  groups: AmazonGroup[];
};

export class AmazonAuthenticationExpired extends Error {
  constructor() {
    super('amazon authentication expired');
    this.name = 'AmazonAuthenticationExpired';
  }
}

export class AmazonAuthenticationFailed extends Error {
  constructor() {
    super('amazon authentication failed');
    this.name = 'AmazonAuthenticationFailed';
  }
}

export class AmazonUnsupported extends Error {
  constructor() {
    super('amazon quote capability is unsupported or unverified');
    this.name = 'AmazonUnsupported';
  }
}

export class AmazonChargeScopeUnknown extends Error {
  constructor() {
    super('amazon charge scope is unknown');
    this.name = 'AmazonChargeScopeUnknown';
  }
}

function parseMoney(value: unknown): bigint {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new AmazonUnsupported();
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * MONEY_SCALE + BigInt(fraction.padEnd(6, '0'));
}

function formatMoney(value: bigint): string {
  const whole = value / MONEY_SCALE;
  const fraction = (value % MONEY_SCALE).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function addMoney(left: bigint, right: bigint): bigint {
  return left + right;
}

function multiplyMoney(value: bigint, quantity: number): bigint {
  return value * BigInt(quantity);
}

function chargeScope(code: string): QuoteCharge['scope'] | undefined {
  const normalized = code.toUpperCase();
  if (PICKUP_CHARGE_CODES.has(normalized)) return 'pickup';
  if (SHIPMENT_CHARGE_CODES.has(normalized)) return 'shipment';
  if (PACKAGE_CHARGE_CODES.has(normalized)) return 'package';
  return undefined;
}

function responseText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).serviceDescription;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeExpiry(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value))
    return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeAmazonRate(body: unknown): AmazonRate {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new AmazonUnsupported();
  const total = parseMoney(parsed.data.totalCharge.value);
  const currency = parsed.data.totalCharge.unit;
  const charges: QuoteCharge[] = [];

  for (const line of parsed.data.shippingCharges) {
    const scope = chargeScope(line.chargeCode);
    if (!scope) throw new AmazonChargeScopeUnknown();
    const money =
      line.charge ??
      (line.value === undefined
        ? undefined
        : { value: line.value, unit: line.unit ?? currency });
    if (!money || money.unit !== currency) throw new AmazonUnsupported();
    charges.push({
      description: line.chargeCode,
      amount: formatMoney(parseMoney(money.value)),
      scope,
      packageGroupPosition: null,
    });
  }

  return {
    carrier:
      parsed.data.deliveringCarrier ?? parsed.data.carrier ?? 'Not provided',
    service: parsed.data.serviceName ?? parsed.data.service ?? 'Not provided',
    total: formatMoney(total),
    currency,
    transitDescription:
      parsed.data.transitDescription ??
      parsed.data.estimatedDeliveryDate ??
      responseText(body),
    expiresAt: normalizeExpiry(parsed.data.expiresAt),
    charges,
  };
}

function packageAmount(rate: AmazonRate): bigint {
  const nonPackage = rate.charges
    .filter((charge) => charge.scope !== 'package')
    .reduce((sum, charge) => addMoney(sum, parseMoney(charge.amount)), 0n);
  const result = parseMoney(rate.total) - nonPackage;
  if (result < 0n) throw new AmazonUnsupported();
  return result;
}

export function aggregateAmazonRates(
  batches: AmazonRateBatch[],
): ExecutionResult['quotes'] {
  if (!batches.length) throw new AmazonUnsupported();
  const first = batches[0]!.rate;
  if (batches.some((batch) => batch.rate.currency !== first.currency))
    throw new AmazonUnsupported();
  if (
    batches.some(
      (batch) =>
        batch.rate.carrier !== first.carrier ||
        batch.rate.service !== first.service,
    )
  )
    throw new AmazonUnsupported();

  const charges: QuoteCharge[] = [];
  const groupTotals = new Map<number, bigint>();
  let packageTotal = 0n;
  const nonPackage = new Map<string, { charge: QuoteCharge; amount: bigint }>();

  for (const batch of batches) {
    const perBox = packageAmount(batch.rate);
    for (const group of batch.groups) {
      const subtotal = multiplyMoney(perBox, group.quantity);
      packageTotal = addMoney(packageTotal, subtotal);
      groupTotals.set(
        group.packageGroupPosition,
        addMoney(groupTotals.get(group.packageGroupPosition) ?? 0n, subtotal),
      );
      for (const charge of batch.rate.charges.filter(
        (line) => line.scope === 'package',
      ))
        charges.push({
          ...charge,
          amount: formatMoney(
            multiplyMoney(parseMoney(charge.amount), group.quantity),
          ),
          packageGroupPosition: group.packageGroupPosition,
        });
    }
    for (const charge of batch.rate.charges.filter(
      (line) => line.scope !== 'package',
    )) {
      const key = `${charge.scope}:${charge.description}:${first.currency}`;
      const existing = nonPackage.get(key);
      if (existing && existing.amount !== parseMoney(charge.amount))
        throw new AmazonUnsupported();
      if (!existing)
        nonPackage.set(key, { charge, amount: parseMoney(charge.amount) });
    }
  }

  for (const { charge, amount } of nonPackage.values())
    charges.push({
      ...charge,
      amount: formatMoney(amount),
      packageGroupPosition: null,
    });

  const contributions: QuoteGroupContribution[] = Array.from(
    groupTotals.entries(),
  )
    .sort(([left], [right]) => left - right)
    .map(([packageGroupPosition, subtotal]) => ({
      packageGroupPosition,
      quantity: batches
        .flatMap((batch) => batch.groups)
        .filter((group) => group.packageGroupPosition === packageGroupPosition)
        .reduce((sum, group) => sum + group.quantity, 0),
      subtotal: formatMoney(subtotal),
    }));

  const total = addMoney(
    packageTotal,
    Array.from(nonPackage.values()).reduce(
      (sum, entry) => addMoney(sum, entry.amount),
      0n,
    ),
  );
  const calculated =
    batches.some((batch) => batch.groups.some((group) => group.quantity > 1)) ||
    batches.length > 1 ||
    batches.some((batch) => batch.groups.length > 1);
  if (
    calculated &&
    batches.some((batch) => {
      const lineTotal = batch.rate.charges.reduce(
        (sum, charge) => addMoney(sum, parseMoney(charge.amount)),
        0n,
      );
      return (
        batch.rate.charges.length === 0 ||
        lineTotal !== parseMoney(batch.rate.total)
      );
    })
  )
    throw new AmazonUnsupported();

  return [
    {
      carrier: first.carrier,
      service: first.service,
      total: formatMoney(total),
      currency: first.currency,
      estimateMethod: calculated ? 'calculated' : 'native',
      transitDescription: first.transitDescription,
      expiresAt: first.expiresAt,
      optionCoverage: 'unverified',
      dutyStatus: 'unknown',
      taxStatus: 'unknown',
      clearanceStatus: 'unknown',
      charges,
      groupContributions: contributions,
    },
  ];
}

function toProviderNumber(
  value: string,
  units: 'imperial' | 'metric',
  kind: 'length' | 'weight',
): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new AmazonUnsupported();
  const converted =
    units === 'imperial'
      ? number
      : kind === 'length'
        ? number / 2.54
        : number / 0.45359237;
  return Number(converted.toFixed(6));
}

function inputProvider(input: QuoteInput) {
  const provider = input.providers.find((entry) => entry.code === 'amazon');
  if (!provider) throw new AmazonUnsupported();
  if (provider.options.signature !== 'none' || provider.options.insurance)
    throw new AmazonUnsupported();
  return provider;
}

function packageSignature(
  input: QuoteInput,
  provider: ReturnType<typeof inputProvider>,
  group: QuoteInput['packageGroups'][number],
  origin: Address,
): string {
  return JSON.stringify({
    origin,
    destination: input.destination,
    shipDate: input.shipDate,
    length: toProviderNumber(group.length, group.units, 'length'),
    width: toProviderNumber(group.width, group.units, 'length'),
    height: toProviderNumber(group.height, group.units, 'length'),
    weight: toProviderNumber(group.weight, group.units, 'weight'),
    options: provider.options,
    customsItems: group.customsItems,
  });
}

type AmazonAdapterOptions = {
  origin?: string;
  launch?: () => Promise<Browser>;
  context?: BrowserContext;
  credentials?: () => { email: string; password: string };
};

export class AmazonShippingAdapter implements QuoteAdapter {
  readonly simulated = false;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private session?: AmazonSession;

  constructor(private readonly options: AmazonAdapterOptions = {}) {}

  private get origin() {
    return this.options.origin ?? 'https://ship.amazon.com';
  }

  private get credentials() {
    const credentials = this.options.credentials?.() ?? {
      email: process.env.AMAZON_SHIPPING_EMAIL?.trim() ?? '',
      password: process.env.AMAZON_SHIPPING_PASSWORD ?? '',
    };
    if (!credentials.email || !credentials.password)
      throw new AmazonAuthenticationFailed();
    return credentials;
  }

  private async getPage(): Promise<Page> {
    if (this.page) return this.page;
    if (this.options.context) {
      this.context = this.options.context;
    } else {
      this.browser = await (
        this.options.launch ?? (() => chromium.launch({ headless: true }))
      )();
      this.context = await this.browser.newContext({ serviceWorkers: 'block' });
    }
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(LOGIN_TIMEOUT_MS);
    return this.page;
  }

  private loginEmail(page: Page): Locator {
    return page
      .locator(
        'input#ap_email:visible, input[type="email"]:visible, input[name="email"]:visible',
      )
      .first();
  }

  private async waitForEntry(page: Page): Promise<void> {
    const entry = page
      .getByLabel(/origin.*postal/i)
      .or(page.getByRole('button', { name: /^view$/i }))
      .or(page.getByRole('button', { name: /^calculate rates$/i }))
      .or(this.loginEmail(page))
      .first();
    await entry.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
    const body = (await page.locator('body').innerText()).toLowerCase();
    if (
      /captcha|verify (?:that )?you are human|one-time password|multi-factor/.test(
        body,
      )
    )
      throw new AmazonAuthenticationFailed();
  }

  private captureBootstrap(page: Page): Promise<AmazonSession> {
    this.session = undefined;
    return page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === this.origin &&
            url.pathname === '/hz/getLatestProposalSharedWithShipper'
          );
        },
        { timeout: LOGIN_TIMEOUT_MS },
      )
      .then(async (response) => {
        if (response.status() === 401 || response.status() === 403)
          throw new AmazonAuthenticationExpired();
        if (!response.ok()) throw new AmazonAuthenticationFailed();
        const body = (await response.json()) as {
          rateCardProposal?: {
            merchantId?: unknown;
            simulatedShipperId?: unknown;
          };
        };
        const merchantId = body.rateCardProposal?.merchantId;
        const proposalId = body.rateCardProposal?.simulatedShipperId;
        const xsrf = response.request().headers()['x-xsrf-token'];
        if (
          typeof merchantId !== 'string' ||
          !merchantId ||
          typeof proposalId !== 'string' ||
          !proposalId ||
          !xsrf
        )
          throw new AmazonAuthenticationFailed();
        const session = { merchantId, proposalId, xsrfToken: xsrf };
        this.session = session;
        return session;
      });
  }

  private async openCalculator(page: Page): Promise<void> {
    const origin = page.getByLabel(/origin.*postal/i).first();
    if (await origin.isVisible()) return;
    const view = page.getByRole('button', { name: /^view$/i }).first();
    if (await view.isVisible()) await view.click();
    const calculate = page
      .getByRole('button', { name: /^calculate rates$/i })
      .first();
    if (!(await origin.isVisible())) {
      await calculate.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
      await calculate.click();
    }
    await origin.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
  }

  private async login(force = false): Promise<void> {
    const page = await this.getPage();
    // Every quote action reloads the protected entry page and obtains a fresh
    // proposal/XSRF context. The in-memory context keeps the authenticated
    // browser session, but a cached session object is never trusted on its own.
    if (force) this.session = undefined;
    const bootstrap = this.captureBootstrap(page);
    const navigation = await page.goto(
      `${this.origin}/getstarted/progress?show=rates`,
      {
        waitUntil: 'domcontentloaded',
        timeout: LOGIN_TIMEOUT_MS,
      },
    );
    if (navigation && navigation.status() >= 400) {
      if (navigation.status() === 401 || navigation.status() === 403)
        throw new AmazonAuthenticationExpired();
      throw new AmazonAuthenticationFailed();
    }
    await this.waitForEntry(page);
    const email = this.loginEmail(page);
    if (await email.isVisible()) {
      await email.fill(this.credentials.email);
      await page
        .getByRole('button', { name: /continue/i })
        .first()
        .click();
      const password = page
        .locator(
          'input#ap_password, input[type="password"], input[name="password"]',
        )
        .first();
      await password.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS });
      await password.fill(this.credentials.password);
      await page
        .getByRole('button', { name: /sign in|log in/i })
        .first()
        .click();
      await page.waitForURL(
        (url) =>
          url.origin === this.origin &&
          (url.pathname === '/getstarted/progress' ||
            url.pathname.startsWith('/ap/cvf/')),
        { timeout: LOGIN_TIMEOUT_MS },
      );
      await this.waitForEntry(page);
    }
    await this.openCalculator(page);
    await bootstrap;
  }

  private async requestRate(
    page: Page,
    input: {
      originZip: string;
      destinationZip: string;
      length: number;
      width: number;
      height: number;
      weight: number;
    },
  ): Promise<unknown> {
    const session = this.session;
    if (!session) throw new AmazonAuthenticationFailed();
    const response = await page.evaluate(
      async ({ input, session }) => {
        const endpoint = new URL('/shipping-rates/getRates', location.origin);
        endpoint.searchParams.set('merchantId', session.merchantId);
        endpoint.searchParams.set('simulatedShipperId', session.proposalId);
        const result = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-xsrf-token': session.xsrfToken,
          },
          body: JSON.stringify({ ...input, serviceCode: 'swa-us-mfn' }),
        });
        return { status: result.status, body: await result.text() };
      },
      { input, session },
    );
    if (response.status === 401 || response.status === 403)
      throw new AmazonAuthenticationExpired();
    if (response.status === 400) throw new Error('validation_failed');
    if (response.status === 422) throw new AmazonUnsupported();
    if (response.status < 200 || response.status >= 300)
      throw new Error('provider_failed');
    try {
      return JSON.parse(response.body);
    } catch {
      throw new AmazonUnsupported();
    }
  }

  private async browserRate(
    page: Page,
    input: {
      originZip: string;
      destinationZip: string;
      length: number;
      width: number;
      height: number;
      weight: number;
    },
  ): Promise<unknown> {
    const session = this.session;
    if (!session) throw new AmazonAuthenticationFailed();
    await this.openCalculator(page);
    await page
      .getByLabel(/origin.*postal/i)
      .first()
      .fill(input.originZip);
    await page
      .getByLabel(/destination.*postal/i)
      .first()
      .fill(input.destinationZip);
    await page
      .getByLabel(/^length/i)
      .first()
      .fill(String(input.length));
    await page
      .getByLabel(/^width/i)
      .first()
      .fill(String(input.width));
    await page
      .getByLabel(/^height/i)
      .first()
      .fill(String(input.height));
    await page
      .getByLabel(/^weight/i)
      .first()
      .fill(String(input.weight));
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) => {
          const url = new URL(candidate.url());
          const request = candidate.request();
          if (
            url.origin === this.origin &&
            url.pathname === '/shipping-rates/getRates' &&
            request.method() === 'POST' &&
            url.searchParams.get('merchantId') === session.merchantId &&
            url.searchParams.get('simulatedShipperId') === session.proposalId
          ) {
            try {
              const body = request.postDataJSON() as Record<string, unknown>;
              return (
                String(body.originZip) === input.originZip &&
                String(body.destinationZip) === input.destinationZip &&
                String(body.length) === String(input.length) &&
                String(body.width) === String(input.width) &&
                String(body.height) === String(input.height) &&
                String(body.weight) === String(input.weight) &&
                body.serviceCode === 'swa-us-mfn'
              );
            } catch {
              return false;
            }
          }
          return false;
        },
        { timeout: RATE_TIMEOUT_MS },
      ),
      page.getByRole('button', { name: /estimate rate/i }).click(),
    ]);
    if (response.status() === 401 || response.status() === 403)
      throw new AmazonAuthenticationExpired();
    if (response.status() === 400) throw new Error('validation_failed');
    if (response.status() === 422) throw new AmazonUnsupported();
    if (!response.ok()) throw new Error('provider_failed');
    try {
      return await response.json();
    } catch {
      throw new AmazonUnsupported();
    }
  }

  async quote(job: LeasedQuote, signal: AbortSignal): Promise<ExecutionResult> {
    try {
      signal.throwIfAborted();
      const input = job.input;
      if (input.destination.country !== 'US')
        return quoteFailure('unsupported');
      const provider = inputProvider(input);
      if (job.sender.address.country !== 'US')
        return quoteFailure('unsupported');
      const page = await this.getPage();
      await this.login();
      const groups = new Map<string, AmazonRateBatch>();
      for (const [position, group] of input.packageGroups.entries()) {
        if (group.customsItems.length) throw new AmazonUnsupported();
        const signature = packageSignature(
          input,
          provider,
          group,
          job.sender.address,
        );
        const current = groups.get(signature);
        const normalizedGroup = {
          packageGroupPosition: position,
          quantity: group.quantity,
        };
        if (current) current.groups.push(normalizedGroup);
        else {
          const values = {
            originZip: job.sender.address.postalCode,
            destinationZip: input.destination.postalCode,
            length: toProviderNumber(group.length, group.units, 'length'),
            width: toProviderNumber(group.width, group.units, 'length'),
            height: toProviderNumber(group.height, group.units, 'length'),
            weight: toProviderNumber(group.weight, group.units, 'weight'),
          };
          const body =
            job.mode === 'request'
              ? await this.requestRate(page, values)
              : await this.browserRate(page, values);
          groups.set(signature, {
            rate: normalizeAmazonRate(body),
            groups: [normalizedGroup],
          });
        }
        signal.throwIfAborted();
      }
      return {
        outcome: 'success',
        reason: null,
        simulated: false,
        relogins: 0,
        quotes: aggregateAmazonRates(Array.from(groups.values())),
      };
    } catch (error) {
      if (
        error instanceof AmazonAuthenticationExpired ||
        error instanceof AmazonAuthenticationFailed
      )
        return quoteFailure('authentication_failed');
      if (
        error instanceof AmazonUnsupported ||
        error instanceof AmazonChargeScopeUnknown
      )
        return quoteFailure('unsupported');
      if (error instanceof Error && error.message === 'validation_failed')
        return quoteFailure('validation_failed');
      return quoteFailure('provider_failed');
    }
  }

  async relogin(_job: LeasedQuote, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.session = undefined;
    await this.login(true);
  }

  async close(_job: LeasedQuote): Promise<void> {
    this.session = undefined;
    this.page = undefined;
    this.context = undefined;
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close();
  }
}
