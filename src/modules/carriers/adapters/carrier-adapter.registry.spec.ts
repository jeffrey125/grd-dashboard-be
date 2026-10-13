import { describe, expect, it } from 'vitest';
import { CarrierAdapterRegistry } from './carrier-adapter.registry.js';
import type { CarrierAdapter } from './carrier-adapter.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';

describe('Carrier adapter registry', () => {
  it('refuses an enabled Carrier without an adapter using safe diagnostics', () => {
    const registry = new CarrierAdapterRegistry([]);
    expect(() => registry.require('ups')).toThrow(
      'Enabled Carrier has no registered adapter: ups',
    );
  });

  it('rejects invalid adapter configuration without exposing original secrets or causes', () => {
    const adapter: CarrierAdapter = {
      code: 'ups',
      minimumIntervalMinutes: 60,
      referencePolicy: carrierReferencePolicy('ups'),
      validateConfiguration() {
        throw new Error('SECRET_PASSWORD');
      },
      async openSession() {
        throw new Error('Must not open during validation');
      },
    };
    const registry = new CarrierAdapterRegistry([adapter]);
    let failure: unknown;
    try {
      registry.validate('ups');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      reasonCode: 'ADAPTER_CONFIGURATION_INVALID',
      carrierCode: 'ups',
    });
    expect(String(failure)).not.toContain('SECRET_PASSWORD');
    expect((failure as Error).cause).toBeUndefined();
    expect(() => new CarrierAdapterRegistry([adapter, adapter])).toThrow(
      'Duplicate Carrier adapter registration',
    );
  });
});
