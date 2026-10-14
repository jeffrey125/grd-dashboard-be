import { Inject, Injectable } from '@nestjs/common';
import type {
  CarrierAdapter,
  TrackingSession,
} from '@modules/carriers/adapters/carrier-adapter.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import { UpsClient } from './ups.client.js';
import { UpsConfiguration } from './ups.config.js';
import { UpsTokenProvider } from './ups-token.provider.js';
import { mapUpsResponse } from './ups.mapper.js';
import axios from 'axios';
import { UpsFailure, upsHttpFailure } from './ups.failure.js';

@Injectable()
export class UpsAdapter implements CarrierAdapter {
  readonly code = 'ups';
  readonly referencePolicy = carrierReferencePolicy('ups');

  constructor(
    @Inject(UpsConfiguration) private readonly configuration: UpsConfiguration,
    @Inject(UpsClient) private readonly client: UpsClient,
    @Inject(UpsTokenProvider) private readonly tokens: UpsTokenProvider,
  ) {}

  get minimumIntervalMinutes(): number {
    return this.configuration.minimumIntervalMinutes;
  }

  validateConfiguration(): void {
    this.configuration.read();
  }

  async openSession(options: {
    signal: AbortSignal;
    rateLimitPerMinute: number | null;
  }): Promise<TrackingSession> {
    options.signal.throwIfAborted();
    await this.client.configureRateLimit(options.rateLimitPerMinute);

    const closed = new AbortController();

    return {
      read: async (reference, readSignal) => {
        const signal = AbortSignal.any([
          options.signal,
          readSignal,
          closed.signal,
        ]);

        signal.throwIfAborted();

        try {
          try {
            reference = this.referencePolicy.normalize(reference);
          } catch {
            throw new UpsFailure(
              'INVALID_TRACKING_REFERENCE',
              false,
              'UPS tracking reference is invalid.',
            );
          }

          if (reference.length < 7 || reference.length > 34)
            throw new UpsFailure(
              'INVALID_TRACKING_REFERENCE',
              false,
              'UPS tracking numbers must be 7 to 34 characters.',
            );

          this.client.assertAvailable();

          const token = await this.tokens.token(signal);
          let body: unknown;

          try {
            body = await this.client.track(reference, token, signal);
          } catch (error) {
            if (!axios.isAxiosError(error) || error.response?.status !== 401)
              throw error;

            const refreshed = await this.tokens.token(signal, token);

            body = await this.client.track(reference, refreshed, signal);
          }

          return mapUpsResponse(body, reference);
        } catch (error) {
          signal.throwIfAborted();

          let failure = error;

          try {
            this.client.assertAvailable();
          } catch (cooldown) {
            failure = cooldown;
          }

          if (failure instanceof UpsFailure) return failure.result();

          const status = axios.isAxiosError(failure)
            ? failure.response?.status
            : undefined;

          if (status === 404) return { outcome: 'not_found', sourceData: null };

          return upsHttpFailure(failure).result();
        }
      },
      close: async () => {
        closed.abort();
      },
    };
  }
}
