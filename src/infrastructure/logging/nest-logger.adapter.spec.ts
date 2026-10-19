import { Writable } from 'node:stream';
import { Test, type TestingModule } from '@nestjs/testing';
import { Logger as NestPinoLogger, LoggerModule } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RuntimeConfiguration } from '@config/configuration.js';
import { NestLoggerAdapter } from './nest-logger.adapter.js';
import { createPinoHttpOptions } from './logging.options.js';
import { ProjectLogger } from './logging.types.js';
import { PinoLoggerService } from './pino-logger.service.js';

describe('NestLoggerAdapter', () => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const productionConfiguration: RuntimeConfiguration = {
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
  let projectLogger: ProjectLogger;
  let nativeLogger: NestPinoLogger;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [
            createPinoHttpOptions(productionConfiguration, 'api'),
            destination,
          ],
        }),
      ],
      providers: [
        PinoLoggerService,
        { provide: ProjectLogger, useExisting: PinoLoggerService },
      ],
    }).compile();
    projectLogger = module.get(ProjectLogger);
    nativeLogger = module.get(NestPinoLogger);
  });

  afterAll(async () => {
    await module.close();
  });

  it('keeps production errors safe and development diagnostics raw', () => {
    const error = Object.assign(new Error('CANARY_LOCAL_MESSAGE'), {
      name: 'ProviderError',
      code: 'PROVIDER_FAILED',
      status: 502,
    });

    error.stack = [
      'ProviderError: CANARY_LOCAL_STACK',
      '    at execute (src/modules/tracking/executor.ts:7:3)',
    ].join('\n');

    const production = new NestLoggerAdapter(
      projectLogger,
      nativeLogger,
      productionConfiguration,
    );

    production.log('Mapped {/api/v1/health/live, GET} route', 'RouterExplorer');
    production.error(error, 'ExceptionsHandler');

    const development = new NestLoggerAdapter(projectLogger, nativeLogger, {
      ...productionConfiguration,
      environment: 'development',
    });

    development.error(error, 'ExceptionsHandler');
    development.verbose('CANARY_LOCAL_VERBOSE', 'InstanceLoader');

    const records = lines
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records[0]).toMatchObject({
      level: 'info',
      component: 'nest',
      event: 'nest.lifecycle',
      nestContext: 'RouterExplorer',
      message: 'Mapped {/api/v1/health/live, GET} route',
    });
    expect(records[1]).toMatchObject({
      level: 'error',
      component: 'nest',
      event: 'nest.error',
      message: 'Nest framework operation failed',
      errorName: 'ProviderError',
      errorCode: 'PROVIDER_FAILED',
      errorStatus: 502,
      errorLocation: 'src/modules/tracking/executor.ts:7:3',
    });
    expect(JSON.stringify(records.slice(0, 2))).not.toContain('CANARY');
    expect(JSON.stringify(records[2])).toContain('CANARY_LOCAL_MESSAGE');
    expect(JSON.stringify(records[2])).toContain('CANARY_LOCAL_STACK');
    expect(records[3]).toMatchObject({
      level: 'debug',
      message: 'CANARY_LOCAL_VERBOSE',
    });
  });
});
