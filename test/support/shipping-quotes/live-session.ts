import type { Page } from 'playwright';
import { z } from 'zod';
import {
  ProviderAuthenticationChallenge,
  ProviderContractBlocker,
  type ProviderCode,
  type QuoteResult,
} from './provider-contracts.js';

const moneySchema = z.object({
  value: z.number().finite().nonnegative(),
  unit: z.string().length(3),
});
const offersSchema = z.object({
  clientStatus: z.object({ success: z.literal(true) }),
  response: z.object({
    offerList: z.array(
      z.object({
        totalOfferPrice: moneySchema,
        primaryVendor: z.object({ scac: z.string() }),
        expirationDate: z.string().optional(),
        offeredProductList: z
          .array(
            z.object({
              shopRQShipment: z.object({
                timeInTransit: z.object({
                  serviceDescription: z.string(),
                  transitDays: z.number().optional(),
                  estimatedDeliveryDate: z.string().optional(),
                }),
                handlingUnitList: z.array(
                  z.object({ quantity: z.number().int().positive() }),
                ),
              }),
            }),
          )
          .min(1),
      }),
    ),
  }),
});

/** An allowlisted projection: no account context, contact details, or raw body. */
export function summarizeQuote(provider: ProviderCode, result: QuoteResult) {
  const common = {
    status: result.status,
    endpointPath: result.endpointPath,
    requestHeaderNames: result.requestHeaderNames,
    dynamicIdentifierNames: Object.keys(result.identifiers).sort(),
  };
  if (provider === 'amazon') {
    const parsed = z
      .object({ totalCharge: moneySchema })
      .safeParse(result.body);
    return {
      ...common,
      chargeScope: 'single-package-estimate',
      serviceCount: parsed.success ? 1 : 0,
      total: parsed.success ? parsed.data.totalCharge : null,
      services: [],
    };
  }
  const parsed = offersSchema.safeParse(result.body);
  const services = parsed.success
    ? parsed.data.response.offerList.map((offer) => ({
        carrier: offer.primaryVendor.scac,
        service:
          offer.offeredProductList[0]!.shopRQShipment.timeInTransit
            .serviceDescription,
        total: offer.totalOfferPrice,
        packageCount: offer.offeredProductList.reduce(
          (sum, product) =>
            sum +
            product.shopRQShipment.handlingUnitList.reduce(
              (count, unit) => count + unit.quantity,
              0,
            ),
          0,
        ),
        expiresAt: offer.expirationDate,
      }))
    : [];
  return {
    ...common,
    chargeScope: 'whole-shipment-estimate',
    serviceCount: services.length,
    total: null,
    services,
  };
}

/** The user completes verification in this very browser page; no session export. */
export async function runWithInteractiveVerification<T>(
  page: Page,
  provider: ProviderCode,
  operation: () => Promise<T>,
  options?: { timeoutMs: number; onRequired: () => void },
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ProviderAuthenticationChallenge) || !options)
      throw error;
    options.onRequired();
    const origin =
      provider === 'amazon'
        ? 'https://ship.amazon.com'
        : 'https://www.myunishippers.com';
    const path =
      provider === 'amazon' ? '/getstarted/progress' : '/ship/small-package';
    try {
      await page.waitForURL(
        (url) => url.origin === origin && url.pathname === path,
        { timeout: options.timeoutMs },
      );
    } catch {
      throw new ProviderContractBlocker(
        provider,
        'interactive verification was not completed before the timeout',
      );
    }
    return operation();
  }
}
