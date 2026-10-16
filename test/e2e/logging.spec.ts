import {
  Controller,
  Get,
  Inject,
  Module,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RuntimeConfigModule } from '@config/config.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { LoggingModule } from '@infrastructure/logging/logging.module.js';
import { NestLoggerAdapter } from '@infrastructure/logging/nest-logger.adapter.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { HealthModule } from '@modules/health/health.module.js';
import { READINESS_DEPENDENCIES } from '@modules/health/readiness.service.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { configureApiRoutes } from '@runtime/api-routing.js';
import { testEnvironment } from '@test/support/environment.js';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

@Controller('logging-test')
class LoggingTestController {
  private readonly logger;

  constructor(@Inject(ProjectLogger) logger: ProjectLogger) {
    this.logger = logger.child({ component: 'logging-test' });
  }

  @Get('correlation')
  async correlation() {
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.logger.info('test.request.handled', 'Test request handled');

    return { status: 'ok' };
  }

  @Get('failure')
  failure() {
    throw new Error('CANARY_HTTP_ERROR');
  }
}

@Module({
  imports: [
    RuntimeConfigModule,
    LoggingModule.forRoot('api', {
      write: (chunk) => process.stdout.write(chunk),
    }),
    HealthModule,
  ],
  controllers: [LoggingTestController],
})
class LoggingTestModule {}

describe('API structured request logging', () => {
  let app: INestApplication | undefined;
  let output = '';

  beforeEach(() => {
    for (const [key, value] of Object.entries({
      ...testEnvironment,
      LOG_LEVEL: 'debug',
    })) {
      vi.stubEnv(key, value);
    }

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);

      return true;
    });
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('generates isolated request IDs and emits one safe completion per request', async () => {
    const module = await Test.createTestingModule({
      imports: [LoggingTestModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(READINESS_DEPENDENCIES)
      .useValue([
        {
          name: 'fixture',
          check: () => {
            throw new Error('CANARY_HEALTH_ERROR');
          },
        },
      ])
      .compile();

    app = module.createNestApplication();
    configureApiRoutes(app);
    app.useLogger(app.get(NestLoggerAdapter));
    await app.init();

    const server = app.getHttpServer() as Server;
    const responses = await Promise.all([
      request(server)
        .get('/api/v1/logging-test/correlation?token=CANARY_QUERY')
        .set('X-Request-ID', 'client-request-a')
        .set('Authorization', 'Bearer CANARY_AUTHORIZATION')
        .expect(200),
      request(server)
        .get('/api/v1/logging-test/correlation')
        .set('X-Request-ID', 'client-request-b')
        .expect(200),
    ]);

    await request(server).get('/api/v1/health/live').expect(200);
    await request(server).get('/api/v1/health/ready').expect(503);
    await request(server).get('/api/v1/missing').expect(404);
    await request(server).get('/api/v1/logging-test/failure').expect(500);

    const records = output
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const handled = records.filter(
      (record) => record.event === 'test.request.handled',
    );
    const completions = records.filter(
      (record) => record.event === 'api.request.completed',
    );
    const responseIds = responses.map(
      (response) => response.headers['x-request-id'] as string,
    );

    expect(responseIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(new Set(responseIds).size).toBe(2);
    expect(responseIds).not.toContain('client-request-a');
    expect(handled.map((record) => record.requestId).sort()).toEqual(
      [...responseIds].sort(),
    );
    expect(completions).toHaveLength(6);
    expect(
      completions.filter(
        (record) => record.route === '/api/v1/logging-test/correlation',
      ),
    ).toHaveLength(2);
    expect(completions).toContainEqual(
      expect.objectContaining({
        level: 'debug',
        route: '/api/v1/health/live',
        status: 200,
      }),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        route: '/api/v1/health/ready',
        status: 503,
      }),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        route: 'unmatched',
        status: 404,
      }),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({
        level: 'error',
        route: '/api/v1/logging-test/failure',
        status: 500,
      }),
    );
    expect(output).not.toContain('client-request-a');
    expect(output).not.toContain('client-request-b');
    expect(output).not.toContain('CANARY_QUERY');
    expect(output).not.toContain('CANARY_AUTHORIZATION');
    expect(output).not.toContain('CANARY_HEALTH_ERROR');
    expect(output).not.toContain('CANARY_HTTP_ERROR');
  });
});
