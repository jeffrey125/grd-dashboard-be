import { describe, expect, it } from 'vitest';
import {
  executionModeSchema,
  providerExecutionModes,
} from './provider-execution-mode.js';

describe('shipping provider execution modes', () => {
  it('fixes Amazon to API while retaining request and browser for myUnishippers', () => {
    expect(executionModeSchema.parse('api')).toBe('api');
    expect(providerExecutionModes('amazon')).toEqual(['api']);
    expect(providerExecutionModes('unishippers')).toEqual([
      'request',
      'browser',
    ]);
  });
});
