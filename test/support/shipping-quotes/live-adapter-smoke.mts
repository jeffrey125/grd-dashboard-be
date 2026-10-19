import { UnishippersShippingAdapter } from '../../../dist/modules/shipping-quotes/unishippers-quote.adapter.js';
import type { LeasedQuote } from '../../../src/modules/shipping-quotes/quote-execution.repository.js';
import { BrowserSenderDefaults } from '../../../dist/modules/shipping-quotes/browser-sender-defaults.js';

// Opt-in only. The normal test projects never import this entry point or load .env.
if (!process.env.MYUNISHIPPERS_EMAIL || !process.env.MYUNISHIPPERS_PASSWORD) {
  console.error(
    'Configure MYUNISHIPPERS_EMAIL and MYUNISHIPPERS_PASSWORD in .env.',
  );
  process.exitCode = 1;
} else {
  const address = {
    ...(await new BrowserSenderDefaults().read('unishippers')),
    country: 'US' as const,
    name: 'Quote smoke',
    contactName: 'Quote Smoke',
    phone: '2025550147',
  };
  const shipDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));

  for (const mode of ['request', 'browser'] as const) {
    const quantity = 2;
    const job: LeasedQuote = {
      id: 'live-smoke',
      requestId: 'live-smoke',
      accountId: 1,
      owner: 'live-smoke',
      code: 'unishippers',
      mode,
      enabled: true,
      reloginCount: 0,
      sender: {
        code: 'unishippers',
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
            code: 'unishippers',
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
    const adapter = new UnishippersShippingAdapter();
    const deadline = AbortSignal.timeout(90_000);
    const closeOnAbort = () => {
      void adapter.close(job);
    };
    deadline.addEventListener('abort', closeOnAbort, { once: true });

    try {
      const result = await adapter.quote(job, deadline);
      console.log(
        JSON.stringify({
          provider: job.code,
          mode,
          requestedPackages: quantity,
          outcome: result.outcome,
          reason: result.reason,
          serviceCount: result.quotes.length,
          services: result.quotes.map((quote) => ({
            carrier: quote.carrier,
            service: quote.service,
            total: quote.total,
            currency: quote.currency,
          })),
        }),
      );
      if (result.outcome !== 'success' || !result.quotes.length)
        process.exitCode = 1;
    } finally {
      deadline.removeEventListener('abort', closeOnAbort);
      await adapter.close(job);
    }
  }
}
