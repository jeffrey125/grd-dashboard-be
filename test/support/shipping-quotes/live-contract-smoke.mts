import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import {
  AmazonContractHarness,
  UnishippersContractHarness,
} from './playwright-harness.js';
import {
  availableProviders,
  readProviderCredentials,
  safePath,
  ProviderAuthenticationChallenge,
  ProviderContractBlocker,
  PROVIDERS,
  type ProviderCode,
  type QuoteInput,
} from './provider-contracts.js';
import {
  runWithInteractiveVerification,
  summarizeQuote,
} from './live-session.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    provider: { type: 'string' },
    interactive: { type: 'boolean', default: false },
  },
});
if (values.provider && !PROVIDERS.includes(values.provider as ProviderCode))
  throw new Error('Provider must be amazon or unishippers');

const domesticInput: QuoteInput = {
  originZip: '53125',
  destinationZip: '10118',
  length: 10,
  width: 8,
  height: 6,
  weight: 5,
  quantity: 2,
  country: 'US',
};
const canadaInput: QuoteInput = {
  ...domesticInput,
  destinationZip: 'H2Y 1C6',
  quantity: 1,
  country: 'CA',
};

function safeError(error: unknown) {
  return {
    error: error instanceof Error ? error.name : 'UnknownError',
    reason:
      error instanceof ProviderAuthenticationChallenge ||
      error instanceof ProviderContractBlocker
        ? error.message
        : 'Provider operation failed; raw diagnostic withheld',
  };
}

async function verifyProvider(provider: ProviderCode) {
  const harness =
    provider === 'amazon'
      ? new AmazonContractHarness()
      : new UnishippersContractHarness();
  const credentials = readProviderCredentials(provider);
  const browser = await chromium.launch({ headless: !values.interactive });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const interactive = values.interactive
    ? {
        timeoutMs: 300_000,
        onRequired: () =>
          console.error(
            JSON.stringify({
              provider,
              status: 'verification-required',
              path: safePath(page.url()),
              instruction:
                'Complete verification in the open Chromium window; this same session will resume automatically.',
            }),
          ),
      }
    : undefined;
  const guarded = <T,>(operation: () => Promise<T>) =>
    runWithInteractiveVerification(page, provider, operation, interactive);
  let failed = false;
  try {
    try {
      await guarded(() => harness.login(page, credentials));
    } catch (error) {
      console.log(
        JSON.stringify({
          provider,
          stage: 'login',
          path: safePath(page.url()),
          ...safeError(error),
        }),
      );
      return false;
    }
    // Keep independent mode results even if an optional international attempt fails.
    for (const attempt of [
      {
        stage: 'request-domestic',
        input:
          provider === 'amazon'
            ? { ...domesticInput, quantity: 1 }
            : domesticInput,
        mode: 'requestQuote',
      },
      { stage: 'request-canada', input: canadaInput, mode: 'requestQuote' },
      {
        stage: 'browser-domestic',
        input: { ...domesticInput, quantity: 1 },
        mode: 'browserQuote',
      },
    ] as const) {
      if (provider === 'amazon' && attempt.stage === 'request-canada') {
        console.log(
          JSON.stringify({
            provider,
            stage: attempt.stage,
            status: 'skipped',
            reason:
              'The native Amazon estimator exposes no country/customs input; the international contract is unverified.',
          }),
        );
        continue;
      }
      try {
        const result = await guarded(() =>
          harness[attempt.mode](page, attempt.input, credentials),
        );
        const summary = summarizeQuote(provider, result);
        const success = result.status === 200 && summary.serviceCount > 0;
        const quantityMatches =
          provider !== 'unishippers' ||
          summary.services.every(
            (service) => service.packageCount === attempt.input.quantity,
          );
        if (
          attempt.stage !== 'request-canada' &&
          (!success || !quantityMatches)
        )
          failed = true;
        console.log(
          JSON.stringify({
            provider,
            stage: attempt.stage,
            requestedPackages: attempt.input.quantity,
            success: success && quantityMatches,
            ...summary,
          }),
        );
      } catch (error) {
        if (attempt.stage !== 'request-canada') failed = true;
        console.log(
          JSON.stringify({
            provider,
            stage: attempt.stage,
            path: safePath(page.url()),
            ...safeError(error),
          }),
        );
      }
    }
    return !failed;
  } finally {
    await context.close();
    await browser.close();
  }
}

const providers = availableProviders().filter(
  (provider) => !values.provider || provider === values.provider,
);
if (providers.length === 0) {
  console.log(
    JSON.stringify({
      status: 'skipped',
      reason:
        'Credentials for the selected provider were not supplied through the documented environment variables',
    }),
  );
  process.exitCode = 1;
} else {
  for (const provider of providers) {
    if (!(await verifyProvider(provider))) process.exitCode = 1;
  }
}
