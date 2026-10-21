import { SellingPartnerApiAuth } from '@sp-api-sdk/auth';
import {
  ChannelType,
  GetRatesXAmznShippingBusinessIdEnum,
  ShippingApiClient,
  type Address as AmazonAddress,
  type GetRatesRequest,
} from '@sp-api-sdk/shipping-api-v2';
import axios from 'axios';
import { z } from 'zod';
import { QuoteDecimal, type Decimal } from './quote-decimal.js';
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
import { currencyCodeSchema } from './quote-standards.js';

const MAX_PHYSICAL_PACKAGES = 100;

const moneySchema = z.object({
  value: z.union([z.number().finite().nonnegative(), z.string().min(1)]),
  unit: currencyCodeSchema,
});

const rateSchema = z.object({
  rateId: z.string().min(1),
  carrierId: z.string().min(1),
  carrierName: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  totalCharge: moneySchema,
  promise: z.object({
    deliveryWindow: z
      .object({
        start: z.string().min(1).optional(),
        end: z.string().min(1).optional(),
      })
      .optional(),
    pickupWindow: z
      .object({
        start: z.string().min(1).optional(),
        end: z.string().min(1).optional(),
      })
      .optional(),
  }),
  requiresAdditionalInputs: z.boolean(),
});

const ratesPayloadSchema = z.object({
  requestToken: z.string().min(1),
  rates: z.array(rateSchema),
  ineligibleRates: z.array(z.unknown()).optional(),
});

const ratesResponseSchema = z.union([
  z.object({ payload: ratesPayloadSchema }),
  ratesPayloadSchema,
]);

type AmazonCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type AmazonAdapterOptions = {
  credentials?: () => AmazonCredentials;
  session?: AmazonApiSession;
};

type PhysicalPackage = {
  packageGroupPosition: number;
  packagePosition: number;
  request: GetRatesRequest['packages'][number];
};

type PackageRates = {
  packageGroupPosition: number;
  rates: z.infer<typeof rateSchema>[];
};

class AmazonAuthenticationFailed extends Error {}
class AmazonUnsupported extends Error {}
class AmazonValidationFailed extends Error {}

export interface AmazonApiSession {
  authenticate(): Promise<void>;
  getRates(body: GetRatesRequest, signal: AbortSignal): Promise<unknown>;
}

class AmazonSpApiSandboxSession implements AmazonApiSession {
  private readonly auth: SellingPartnerApiAuth;
  private readonly client: ShippingApiClient;

  constructor(credentials: AmazonCredentials) {
    this.auth = new SellingPartnerApiAuth(credentials);
    this.client = new ShippingApiClient({
      auth: this.auth,
      region: 'na',
      sandbox: true,
      userAgent: 'grd-dashboard/1.0 (Language=TypeScript)',
      rateLimiting: { retry: true },
    });
  }

  async authenticate(): Promise<void> {
    await this.auth.getAccessToken();
  }

  async getRates(body: GetRatesRequest, signal: AbortSignal): Promise<unknown> {
    const response = await this.client.getRates(
      {
        body,
        xAmznShippingBusinessId:
          GetRatesXAmznShippingBusinessIdEnum.AmazonShippingUs,
      },
      { signal },
    );

    return response.data;
  }
}

function parseMoney(value: unknown): Decimal {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new AmazonUnsupported();
  return new QuoteDecimal(text);
}

function credentialsFromEnvironment(): AmazonCredentials {
  const credentials = {
    clientId: process.env.AMAZON_SP_API_SANDBOX_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.AMAZON_SP_API_SANDBOX_CLIENT_SECRET ?? '',
    refreshToken: process.env.AMAZON_SP_API_SANDBOX_REFRESH_TOKEN ?? '',
  };
  if (
    !credentials.clientId ||
    !credentials.clientSecret ||
    !credentials.refreshToken
  )
    throw new AmazonAuthenticationFailed();
  return credentials;
}

function inputProvider(input: QuoteInput) {
  const provider = input.providers.find((entry) => entry.code === 'amazon');
  if (!provider) throw new AmazonUnsupported();
  if (provider.options.signature !== 'none' || provider.options.insurance)
    throw new AmazonUnsupported();
  return provider;
}

function apiAddress(address: Address): AmazonAddress {
  const apiName = address.contactName?.trim() || address.name;
  if (
    address.name.length > 50 ||
    apiName.length > 50 ||
    address.street.length > 60 ||
    (address.street2?.length ?? 0) > 60
  )
    throw new AmazonValidationFailed();

  return {
    name: apiName,
    companyName: address.name,
    addressLine1: address.street,
    ...(address.street2 ? { addressLine2: address.street2 } : {}),
    city: address.city,
    stateOrRegion: address.division,
    postalCode: address.postalCode,
    countryCode: address.country,
    ...(address.phone ? { phoneNumber: address.phone } : {}),
  };
}

function physicalPackages(job: LeasedQuote): PhysicalPackage[] {
  const packages: PhysicalPackage[] = [];
  let packageCount = 0;
  for (const [groupPosition, group] of job.input.packageGroups.entries()) {
    if (
      group.customsItems.length ||
      !group.length ||
      !group.width ||
      !group.height
    )
      throw new AmazonUnsupported();
    packageCount += group.quantity;
    if (packageCount > MAX_PHYSICAL_PACKAGES) throw new AmazonUnsupported();

    for (
      let packagePosition = 0;
      packagePosition < group.quantity;
      packagePosition += 1
    ) {
      packages.push({
        packageGroupPosition: groupPosition,
        packagePosition,
        request: {
          dimensions: {
            length: Number(group.length),
            width: Number(group.width),
            height: Number(group.height),
            unit: group.units === 'imperial' ? 'INCH' : 'CENTIMETER',
          },
          weight: {
            value: Number(group.weight),
            unit: group.units === 'imperial' ? 'POUND' : 'KILOGRAM',
          },
          insuredValue: { value: 0, unit: 'USD' },
          items: [
            {
              quantity: 1,
              weight: {
                value: Number(group.weight),
                unit: group.units === 'imperial' ? 'POUND' : 'KILOGRAM',
              },
            },
          ],
          packageClientReferenceId: `${job.id}-${groupPosition + 1}-${packagePosition + 1}`,
        },
      });
    }
  }
  if (!packages.length) throw new AmazonUnsupported();
  return packages;
}

function ratesPayload(body: unknown) {
  const parsed = ratesResponseSchema.safeParse(body);
  if (!parsed.success) throw new AmazonUnsupported();
  return 'payload' in parsed.data ? parsed.data.payload : parsed.data;
}

function rateKey(rate: z.infer<typeof rateSchema>): string {
  return [rate.carrierId, rate.serviceId, rate.totalCharge.unit].join(':');
}

export function aggregateAmazonApiRates(
  packages: PackageRates[],
): ExecutionResult['quotes'] {
  if (!packages.length || packages.some((entry) => !entry.rates.length))
    throw new AmazonUnsupported();

  const common = new Map(
    packages[0]!.rates.map((rate) => [rateKey(rate), [rate]]),
  );
  for (const entry of packages.slice(1)) {
    const rates = new Map(entry.rates.map((rate) => [rateKey(rate), rate]));
    for (const [key, matched] of common) {
      const rate = rates.get(key);
      if (!rate) common.delete(key);
      else matched.push(rate);
    }
  }
  if (!common.size) throw new AmazonUnsupported();

  return Array.from(common.values()).map((rates) => {
    const first = rates[0]!;
    const groupTotals = new Map<number, Decimal>();
    const groupQuantities = new Map<number, number>();
    let total = new QuoteDecimal(0);
    for (const [index, rate] of rates.entries()) {
      const amount = parseMoney(rate.totalCharge.value);
      const group = packages[index]!.packageGroupPosition;
      total = total.plus(amount);
      groupTotals.set(
        group,
        (groupTotals.get(group) ?? new QuoteDecimal(0)).plus(amount),
      );
      groupQuantities.set(group, (groupQuantities.get(group) ?? 0) + 1);
    }

    const groupContributions: QuoteGroupContribution[] = Array.from(
      groupTotals,
      ([packageGroupPosition, subtotal]) => ({
        packageGroupPosition,
        quantity: groupQuantities.get(packageGroupPosition)!,
        subtotal: subtotal.toFixed(6),
      }),
    ).sort(
      (left, right) => left.packageGroupPosition - right.packageGroupPosition,
    );
    const charges: QuoteCharge[] = groupContributions.map((contribution) => ({
      description: 'Amazon Shipping package total',
      amount: contribution.subtotal,
      scope: 'package',
      packageGroupPosition: contribution.packageGroupPosition,
    }));
    const deliveryEnds = new Set(
      rates.map((rate) => rate.promise.deliveryWindow?.end ?? null),
    );

    return {
      platform: 'Amazon Shipping',
      carrier: first.carrierName,
      service: first.serviceName,
      total: total.toFixed(6),
      currency: first.totalCharge.unit,
      estimateMethod: packages.length === 1 ? 'native' : 'calculated',
      transitDescription:
        deliveryEnds.size === 1
          ? (deliveryEnds.values().next().value ?? null)
          : null,
      expiresAt: null,
      optionCoverage: 'included',
      dutyStatus: 'unknown',
      taxStatus: 'unknown',
      clearanceStatus: 'unknown',
      charges,
      groupContributions,
    };
  });
}

export class AmazonShippingAdapter implements QuoteAdapter {
  readonly simulated = true;
  private session?: AmazonApiSession;

  constructor(private readonly options: AmazonAdapterOptions = {}) {
    this.session = options.session;
  }

  private get credentials() {
    return this.options.credentials?.() ?? credentialsFromEnvironment();
  }

  private get apiSession(): AmazonApiSession {
    this.session ??= new AmazonSpApiSandboxSession(this.credentials);
    return this.session;
  }

  private async authenticate(): Promise<void> {
    try {
      await this.apiSession.authenticate();
    } catch {
      throw new AmazonAuthenticationFailed();
    }
  }

  private async packageRates(
    job: LeasedQuote,
    physicalPackage: PhysicalPackage,
    signal: AbortSignal,
  ): Promise<PackageRates> {
    const body: GetRatesRequest = {
      shipTo: apiAddress(job.input.destination),
      shipFrom: apiAddress(job.sender.address),
      shipDate: `${job.input.shipDate}T12:00:00Z`,
      packages: [physicalPackage.request],
      channelDetails: { channelType: ChannelType.External },
    };
    try {
      signal.throwIfAborted();
      const response = await this.apiSession.getRates(body, signal);

      return {
        packageGroupPosition: physicalPackage.packageGroupPosition,
        rates: ratesPayload(response).rates,
      };
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      )
        throw new AmazonAuthenticationFailed();
      if (axios.isAxiosError(error) && error.response?.status === 400)
        throw new AmazonValidationFailed();
      if (
        error instanceof AmazonAuthenticationFailed ||
        error instanceof AmazonValidationFailed ||
        error instanceof AmazonUnsupported
      )
        throw error;
      throw new Error('amazon provider failed');
    }
  }

  async readiness(mode: LeasedQuote['mode']): Promise<void> {
    if (mode !== 'api') throw new AmazonUnsupported();
    await this.authenticate();
  }

  async quote(job: LeasedQuote, signal: AbortSignal): Promise<ExecutionResult> {
    try {
      signal.throwIfAborted();
      if (
        job.mode !== 'api' ||
        job.input.destination.country !== 'US' ||
        job.sender.address.country !== 'US'
      )
        throw new AmazonUnsupported();
      inputProvider(job.input);
      const packages = physicalPackages(job);
      await this.authenticate();
      const rates: PackageRates[] = [];
      for (const physicalPackage of packages) {
        signal.throwIfAborted();
        rates.push(await this.packageRates(job, physicalPackage, signal));
      }
      return {
        outcome: 'success',
        reason: null,
        simulated: true,
        relogins: 0,
        quotes: aggregateAmazonApiRates(rates),
      };
    } catch (error) {
      if (error instanceof AmazonAuthenticationFailed)
        return quoteFailure('authentication_failed', true);
      if (error instanceof AmazonValidationFailed)
        return quoteFailure('validation_failed', true);
      if (error instanceof AmazonUnsupported)
        return quoteFailure('unsupported', true);
      return quoteFailure('provider_failed', true);
    }
  }

  async relogin(_job: LeasedQuote, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.options.session) this.session = undefined;
    await this.authenticate();
  }

  async close(_job?: LeasedQuote): Promise<void> {}
}
