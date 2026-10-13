import { Inject, Injectable } from '@nestjs/common';
import {
  safeErrorFields,
  type SafeErrorFields,
} from '@infrastructure/logging/safe-error-fields.js';
import { CARRIER_ADAPTERS, type CarrierAdapter } from './carrier-adapter.js';

export class AdapterConfigurationError extends Error {
  constructor(
    readonly carrierCode: string,
    readonly reasonCode: string,
    message: string,
    readonly diagnostics?: SafeErrorFields,
  ) {
    super(message);
    this.name = 'AdapterConfigurationError';
  }
}

@Injectable()
export class CarrierAdapterRegistry {
  private readonly adapters = new Map<string, CarrierAdapter>();

  constructor(@Inject(CARRIER_ADAPTERS) adapters: readonly CarrierAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.code))
        throw new AdapterConfigurationError(
          adapter.code,
          'DUPLICATE_ADAPTER',
          'Duplicate Carrier adapter registration',
        );
      this.adapters.set(adapter.code, adapter);
    }
  }

  require(code: string): CarrierAdapter {
    const adapter = this.adapters.get(code);
    if (!adapter)
      throw new AdapterConfigurationError(
        code,
        'ADAPTER_MISSING',
        `Enabled Carrier has no registered adapter: ${code}`,
      );
    return adapter;
  }

  validate(code: string): CarrierAdapter {
    const adapter = this.require(code);
    try {
      if (
        !Number.isSafeInteger(adapter.minimumIntervalMinutes) ||
        adapter.minimumIntervalMinutes < 0
      )
        throw new Error('Invalid minimum interval');
      adapter.validateConfiguration();
    } catch (error) {
      // Never retain provider errors, configuration values or their causes.
      throw new AdapterConfigurationError(
        code,
        'ADAPTER_CONFIGURATION_INVALID',
        `Carrier adapter configuration is invalid: ${code}`,
        safeErrorFields(error),
      );
    }
    return adapter;
  }
}
