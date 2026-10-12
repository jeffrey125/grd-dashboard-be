import { describe, expect, it } from 'vitest';
import { safeErrorFields } from './safe-error-fields.js';

describe('safeErrorFields', () => {
  it('keeps only allowlisted diagnostics from an Error', () => {
    const error = Object.assign(new Error('CANARY_ERROR_MESSAGE'), {
      name: 'ProviderTimeoutError',
      code: 'PROVIDER_TIMEOUT',
      status: 503,
      cause: new Error('CANARY_CAUSE'),
      response: { headers: { authorization: 'CANARY_AUTHORIZATION' } },
    });
    error.stack = [
      'ProviderTimeoutError: CANARY_STACK_MESSAGE',
      '    at execute (src/modules/tracking/executor.ts:42:7)',
      '    at dependency (node_modules/provider/index.js:9:2)',
    ].join('\n');

    const fields = safeErrorFields(error);

    expect(fields).toEqual({
      errorName: 'ProviderTimeoutError',
      errorCode: 'PROVIDER_TIMEOUT',
      errorStatus: 503,
      errorLocation: 'src/modules/tracking/executor.ts:42:7',
    });
    expect(JSON.stringify(fields)).not.toContain('CANARY');
  });

  it('projects unknown and unsafe thrown values deterministically', () => {
    expect(
      safeErrorFields({
        password: 'CANARY_PASSWORD',
        response: { body: 'CANARY_BODY' },
      }),
    ).toEqual({ errorName: 'UnknownError' });

    const error = Object.assign(new Error('CANARY_MESSAGE'), {
      name: 'CANARY NAME WITH SPACES',
      code: 'CANARY CODE WITH SPACES',
      httpStatus: 999,
    });
    error.stack = 'Error: CANARY\n    at dependency (node_modules/x.js:1:1)';
    expect(safeErrorFields(error)).toEqual({ errorName: 'Error' });
  });
});
