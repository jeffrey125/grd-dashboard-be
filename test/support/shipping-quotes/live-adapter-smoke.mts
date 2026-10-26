import { parseArgs } from 'node:util';
import { AmazonShippingAdapter } from '../../../dist/modules/shipping-quotes/amazon-quote.adapter.js';
import { executeQuote } from '../../../dist/modules/shipping-quotes/quote-executor.js';
import { UnishippersShippingAdapter } from '../../../dist/modules/shipping-quotes/unishippers-quote.adapter.js';
import type { LeasedQuote } from '../../../src/modules/shipping-quotes/quote-execution.repository.js';
import { BrowserSenderDefaults } from '../../../dist/modules/shipping-quotes/browser-sender-defaults.js';

// Opt-in only. Normal test projects never import this entry point or load .env.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    provider: { type: 'string' },
    mode: { type: 'string' },
  },
});
if (values.provider && !['amazon', 'unishippers'].includes(values.provider))
  throw new Error('Provider must be amazon or unishippers');
if (values.mode && !['api', 'request', 'browser'].includes(values.mode))
  throw new Error('Mode must be api, request or browser');

const modes = {
  amazon: ['api'],
  unishippers: ['request', 'browser'],
} as const;
const amazonCredentialsAvailable = () =>
  Boolean(
    process.env.AMAZON_SP_API_CLIENT_ID &&
    process.env.AMAZON_SP_API_CLIENT_SECRET &&
    process.env.AMAZON_SP_API_REFRESH_TOKEN,
  );

for (const code of ['amazon', 'unishippers'] as const) {
  if (values.provider && values.provider !== code) continue;
  for (const mode of modes[code]) {
    if (values.mode && values.mode !== mode) continue;
    const credentialsAvailable =
      code === 'amazon'
        ? amazonCredentialsAvailable()
        : Boolean(
            process.env.MYUNISHIPPERS_EMAIL &&
            process.env.MYUNISHIPPERS_PASSWORD,
          );
    if (!credentialsAvailable) {
      console.log(
        JSON.stringify({
          provider: code,
          mode,
          outcome: 'blocked',
          reason: 'credentials_missing',
        }),
      );
      process.exitCode = 1;
      continue;
    }
    try {
      const address =
        code === 'amazon'
          ? {
              name: 'Quote smoke',
              street: '410 Terry Avenue North',
              city: 'Seattle',
              division: 'WA',
              postalCode: '98109',
              country: 'US' as const,
              contactName: 'Quote Smoke',
              phone: '2025550147',
            }
          : {
              ...(await new BrowserSenderDefaults().read('unishippers')),
              country: 'US' as const,
              name: 'Quote smoke',
              contactName: 'Quote Smoke',
              phone: '2025550147',
            };
      const shipDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
      }).format(
        new Date(
          Date.now() + (code === 'unishippers' ? 0 : 24 * 60 * 60 * 1000),
        ),
      );

      const quantity = 2;
      const job: LeasedQuote = {
        id: 'live-smoke',
        requestId: 'live-smoke',
        accountId: 1,
        owner: 'live-smoke',
        code,
        mode,
        enabled: true,
        reloginCount: 0,
        sender: {
          code,
          mode: 'explicit',
          retrievedAt: null,
          address,
        },
        input: {
          idempotencyKey: crypto.randomUUID(),
          shipDate,
          destination: {
            ...address,
            name: 'Quote destination',
            street: '350 Fifth Avenue',
            street2: '',
            city: 'New York',
            division: 'NY',
            postalCode: '10118',
          },
          providers: [
            {
              code,
              sender: { mode: 'explicit', address },
              options: { signature: 'none', insurance: null },
            },
          ],
          packageGroups: [
            {
              quantity,
              units: 'imperial',
              length: '10',
              width: '8',
              height: '6',
              weight: '5',
              customsItems: [],
            },
          ],
        },
      };
      const adapter =
        code === 'amazon'
          ? new AmazonShippingAdapter()
          : new UnishippersShippingAdapter();
      const result = await executeQuote(
        job,
        adapter,
        new AbortController().signal,
      );
      // Deliberately omit free-text provider strings, account context, addresses and raw errors.
      console.log(
        JSON.stringify({
          provider: code,
          mode,
          requestedPackages: quantity,
          outcome: result.outcome,
          reason: result.reason,
          relogins: result.relogins,
          serviceCount: result.quotes.length,
          rates: result.quotes.map((quote) => ({
            total: quote.total,
            currency: quote.currency,
            estimateMethod: quote.estimateMethod,
          })),
        }),
      );
      if (result.outcome !== 'success' || !result.quotes.length)
        process.exitCode = 1;
    } catch {
      console.log(
        JSON.stringify({
          provider: code,
          mode,
          outcome: 'blocked',
          reason: 'sender_or_login_unavailable',
        }),
      );
      process.exitCode = 1;
    }
  }
}
