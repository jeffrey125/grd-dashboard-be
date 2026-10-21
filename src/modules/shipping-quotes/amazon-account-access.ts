import { VerificationError } from './amazon-verification.contract.js';
import type { QuoteAdapter } from './quote-executor.js';
import { quoteFailure } from './quote-executor.js';
import type { ReadinessAdapter } from './provider-readiness.worker.js';

/** The v1 worker owns the single Amazon account, including human verification. */
export class AmazonAccountAccess {
  private owner?: symbol;

  acquire() {
    if (this.owner) throw new VerificationError('busy');
    const owner = Symbol();
    this.owner = owner;
    return () => {
      if (this.owner === owner) this.owner = undefined;
    };
  }

  quote(adapter: QuoteAdapter): QuoteAdapter {
    let release: (() => void) | undefined;
    return {
      simulated: adapter.simulated,
      quote: async (job, signal) => {
        try {
          release ??= this.acquire();
        } catch {
          return quoteFailure('verification_required');
        }
        return adapter.quote(job, signal);
      },
      relogin: async (job, signal) => {
        release ??= this.acquire();
        return adapter.relogin(job, signal);
      },
      close: async (job) => {
        try {
          await adapter.close(job);
        } finally {
          release?.();
          release = undefined;
        }
      },
    };
  }

  readiness(adapter: ReadinessAdapter): ReadinessAdapter {
    let release: (() => void) | undefined;
    return {
      readiness: async (mode) => {
        release = this.acquire();
        await adapter.readiness(mode);
      },
      close: async () => {
        try {
          await adapter.close();
        } finally {
          release?.();
          release = undefined;
        }
      },
    };
  }
}
