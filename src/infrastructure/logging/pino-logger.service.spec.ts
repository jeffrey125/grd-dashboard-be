import { Writable } from 'node:stream';
import { Test, type TestingModule } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RuntimeConfiguration } from '@config/configuration.js';
import { createPinoHttpOptions } from './logging.options.js';
import type { LogFields } from './logging.types.js';
import { PinoLoggerService } from './pino-logger.service.js';

describe('PinoLoggerService', () => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const configuration: RuntimeConfiguration = {
    environment: 'production',
    quoteDemo: false,
    quoteScenarios: { amazon: 'success', unishippers: 'success' },
    logLevel: 'debug',
    port: 3000,
    database: {
      host: '127.0.0.1',
      port: 5432,
      database: 'logging_test',
      username: 'logging_test',
      password: 'fixture-password',
      sslMode: 'disable',
      sslCaFile: undefined,
    },
  };
  let module: TestingModule;
  let logger: PinoLoggerService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [createPinoHttpOptions(configuration, 'api'), destination],
        }),
      ],
      providers: [PinoLoggerService],
    }).compile();
    logger = module.get(PinoLoggerService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('emits stable JSON, filters levels, carries child fields, and redacts canaries', () => {
    logger.debug('logger.debug.enabled', 'Debug logging is enabled');

    expect(() =>
      logger.info(
        'Invalid Event' as `${string}.${string}`,
        'Invalid event should not be written',
      ),
    ).toThrow('Log event must be a lowercase dot-separated identifier');

    logger
      .child({
        component: 'scheduler',
        carrierCode: 'ups',
        event: 'Invalid Child Event',
      } as unknown as LogFields)
      .info('tracking.run.started', 'Tracking run started', {
        runExternalId: 'run-external-1',
        shipmentExternalId: 'shipment-external-1',
        trigger: 'scheduled',
        outcome: 'success',
        durationMs: 42,
        retryable: false,
        reasonCode: 'completed',
        candidateCount: 3,
        selectedCount: 2,
        attemptedCount: 2,
        succeededCount: 2,
        failedCount: 0,
      });

    const canaries = {
      password: 'CANARY_PASSWORD',
      currentPassword: 'CANARY_CURRENT_PASSWORD',
      newPassword: 'CANARY_NEW_PASSWORD',
      passwordHash: 'CANARY_PASSWORD_HASH',
      token: 'CANARY_TOKEN',
      secret: 'CANARY_SECRET',
      apiKey: 'CANARY_API_KEY',
      authorization: 'CANARY_AUTHORIZATION',
      proxyAuthorization: 'CANARY_PROXY_AUTHORIZATION',
      cookie: 'CANARY_COOKIE',
      setCookie: 'CANARY_SET_COOKIE',
      csrfToken: 'CANARY_CSRF_TOKEN',
      sessionId: 'CANARY_SESSION_ID',
      credentials: 'CANARY_CREDENTIALS',
      requestBody: 'CANARY_REQUEST_BODY',
      responsePayload: 'CANARY_RESPONSE_PAYLOAD',
      trackingReference: 'CANARY_TRACKING_REFERENCE',
      contact: 'CANARY_CONTACT',
      person: 'CANARY_PERSON',
      email: 'CANARY_EMAIL',
      phone: 'CANARY_PHONE',
      address: 'CANARY_ADDRESS',
      sourceData: 'CANARY_SOURCE_DATA',
      rawProviderData: 'CANARY_RAW_PROVIDER_DATA',
      providerResponse: 'CANARY_PROVIDER_RESPONSE',
      browserState: 'CANARY_BROWSER_STATE',
      browserArtifact: 'CANARY_BROWSER_ARTIFACT',
    };

    logger.error('logger.redaction.checked', 'Redaction checked', {
      event: 'Invalid Call Event',
      password: canaries.password,
      currentPassword: canaries.currentPassword,
      newPassword: canaries.newPassword,
      passwordHash: canaries.passwordHash,
      secret: canaries.secret,
      apiKey: canaries.apiKey,
      csrfToken: canaries.csrfToken,
      sessionId: canaries.sessionId,
      nested: {
        token: canaries.token,
        credentials: canaries.credentials,
      },
      request: {
        headers: {
          authorization: canaries.authorization,
          cookie: canaries.cookie,
        },
        body: canaries.requestBody,
      },
      responsePayload: canaries.responsePayload,
      trackingReference: canaries.trackingReference,
      contact: canaries.contact,
      person: canaries.person,
      email: canaries.email,
      phone: canaries.phone,
      address: canaries.address,
      source_data: canaries.sourceData,
      rawProviderData: canaries.rawProviderData,
      providerResponse: canaries.providerResponse,
      browserState: canaries.browserState,
      browserArtifacts: canaries.browserArtifact,
      'proxy-authorization': canaries.proxyAuthorization,
      'set-cookie': canaries.setCookie,
      deep: {
        provider: {
          response: {
            metadata: {
              password: canaries.password,
            },
          },
        },
      },
    } as unknown as LogFields);

    logger.setLevel('error');
    logger.warn('logger.warn.filtered', 'This warning is filtered');
    logger.error('logger.error.enabled', 'This error is enabled');

    const output = lines.join('');
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      level: 'debug',
      service: 'grd-dashboard-be',
      environment: 'production',
      runtime: 'api',
      component: 'application',
      event: 'logger.debug.enabled',
      message: 'Debug logging is enabled',
    });
    expect(records[0]?.timestamp).toEqual(expect.any(String));
    expect(records[0]).not.toHaveProperty('pid');
    expect(records[0]).not.toHaveProperty('hostname');
    expect(records[1]).toMatchObject({
      event: 'tracking.run.started',
      component: 'scheduler',
      carrierCode: 'ups',
      runExternalId: 'run-external-1',
      shipmentExternalId: 'shipment-external-1',
      trigger: 'scheduled',
      outcome: 'success',
      durationMs: 42,
      retryable: false,
      reasonCode: 'completed',
      candidateCount: 3,
      selectedCount: 2,
      attemptedCount: 2,
      succeededCount: 2,
      failedCount: 0,
    });
    expect(records[3]).toMatchObject({
      level: 'error',
      event: 'logger.error.enabled',
    });
    expect(records[2]).toMatchObject({ event: 'logger.redaction.checked' });

    for (const canary of Object.values(canaries))
      expect(output).not.toContain(canary);

    expect(output).toContain('[Redacted]');
  });
});
