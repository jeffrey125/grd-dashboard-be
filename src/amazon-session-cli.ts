import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { z } from 'zod';
import { AmazonShippingAdapter } from './modules/shipping-quotes/amazon-quote.adapter.js';
import {
  amazonAuthenticationState,
  amazonSessionStore,
} from './modules/shipping-quotes/amazon-session.store.js';

async function checkPort(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

export async function runAmazonSessionCli(command: string | undefined) {
  const store = amazonSessionStore();
  if (!store)
    throw new Error(
      'Configure AMAZON_SESSION_DIRECTORY, AMAZON_SESSION_KEY_FILE and AMAZON_SHIPPING_EMAIL first.',
    );

  if (command === 'init') {
    await store.initialize();
    console.info(
      'Amazon session key initialized. Existing keys are never replaced.',
    );
    return;
  }
  if (command === 'revoke') {
    await store.revoke();
    console.info(
      'Amazon saved session revoked. An already-running quote may finish.',
    );
    return;
  }
  if (command !== 'connect')
    throw new Error('Usage: amazon-session-cli.js init|connect|revoke');
  if (!process.stdin.isTTY)
    throw new Error('Reconnect requires an interactive operator terminal.');

  const port = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(process.env.AMAZON_SESSION_DEBUG_PORT ?? '9222');
  await checkPort(port);
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
    ],
  });
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const abort = new AbortController();
  const stop = () => abort.abort();
  const timeout = setTimeout(stop, 15 * 60 * 1000);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const closeBrowser = () => {
    void browser.close().catch(() => undefined);
  };
  abort.signal.addEventListener('abort', closeBrowser, { once: true });

  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      storageState: await store.load(),
    });
    const page = await context.newPage();
    await page.goto('https://ship.amazon.com/getstarted/progress?show=rates', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.info(
      `Forward VM loopback port ${port} over SSH. Open chrome://inspect/#devices, configure localhost:${port}, and inspect the Amazon page. Enable its screencast to interact.`,
    );
    console.info(
      'Sign in with the configured Amazon Shipping account and complete verification yourself. This window closes after 15 minutes.',
    );
    const adapter = new AmazonShippingAdapter({
      context,
      manualAuthentication: true,
    });

    while (!abort.signal.aborted) {
      const answer = await input.question(
        'Type save after reaching the rates calculator, or quit: ',
        { signal: abort.signal },
      );
      if (answer.trim() === 'quit') return;
      if (answer.trim() !== 'save') continue;
      try {
        await adapter.verifySession();
      } catch {
        console.info(
          'Not saved: the authenticated rates calculator could not be verified. Complete Amazon verification/setup, then try save again.',
        );
        continue;
      }
      abort.signal.throwIfAborted();
      await store.save(amazonAuthenticationState(await context.storageState()));
      console.info(
        'Amazon session saved securely for at most 12 hours. Session verification did not request a quote, label or shipment.',
      );
      return;
    }
  } finally {
    clearTimeout(timeout);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    abort.signal.removeEventListener('abort', closeBrowser);
    input.close();
    await browser.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runAmazonSessionCli(process.argv[2]).catch(() => {
    console.error(
      'Amazon session operation did not complete. Check the command, private storage/key configuration, available loopback port and manual verification. No credentials are printed.',
    );
    process.exitCode = 1;
  });
}
