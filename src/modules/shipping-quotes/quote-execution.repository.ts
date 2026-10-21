import type {
  ProviderCode,
  QuoteInput,
  QuoteCharge,
  QuoteGroupContribution,
  SenderSnapshot,
} from './quote.schemas.js';
import type { ExecutionMode } from './provider-execution-mode.js';

export interface LeasedQuote {
  id: string;
  requestId: string;
  accountId: number;
  owner: string;
  code: ProviderCode;
  mode: ExecutionMode;
  enabled: boolean;
  input: QuoteInput;
  sender: SenderSnapshot;
  conversionSnapshot?: Record<string, unknown>;
  reloginCount: 0 | 1;
}

export type QuoteOutcome =
  | 'success'
  | 'validation_failed'
  | 'unsupported'
  | 'timeout'
  | 'authentication_failed'
  | 'failed';

export type QuoteReason =
  | 'validation_failed'
  | 'sender_company_too_long'
  | 'contact_details_required'
  | 'unsupported'
  | 'timeout'
  | 'authentication_failed'
  | 'provider_setup_required'
  | 'verification_required'
  | 'provider_failed'
  | 'adapter_unavailable'
  | 'provider_disabled'
  | 'recovery_exhausted';

export interface ExecutionResult {
  outcome: QuoteOutcome;
  reason: QuoteReason | null;
  simulated: boolean;
  relogins: 0 | 1;
  quotes: Array<{
    platform?: string;
    carrier: string;
    service: string;
    total: string;
    currency: string;
    estimateMethod: 'native' | 'calculated';
    transitDescription?: string | null;
    expiresAt?: string | null;
    optionCoverage?: 'included' | 'unsupported' | 'unverified';
    dutyStatus?: 'included' | 'excluded' | 'unknown';
    taxStatus?: 'included' | 'excluded' | 'unknown';
    clearanceStatus?: 'included' | 'excluded' | 'unknown';
    charges?: QuoteCharge[];
    groupContributions?: QuoteGroupContribution[];
  }>;
}

export abstract class QuoteExecutionRepository {
  abstract claim(leaseMs: number): Promise<LeasedQuote | null>;
  abstract finish(job: LeasedQuote, result: ExecutionResult): Promise<boolean>;
  abstract reserveRelogin(job: LeasedQuote): Promise<boolean>;
}
