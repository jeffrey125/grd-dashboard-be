import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeFeatures,
  RuntimeFeaturesModule,
} from '@config/runtime-features.module.js';
import { RuntimeFeaturesHttpModule } from '@runtime/runtime-features-http.module.js';
import { configureApiRoutes } from '@runtime/api-routing.js';
import { testEnvironment } from '@test/support/environment.js';
import { QuoteController } from '@modules/shipping-quotes/quote.controller.js';
import { QuoteEventsController } from '@modules/shipping-quotes/quote-events.controller.js';
import { ProviderAdminController } from '@modules/shipping-quotes/provider-admin.controller.js';
import { QuoteService } from '@modules/shipping-quotes/quote.service.js';
import { SenderDefaultsService } from '@modules/shipping-quotes/sender-defaults.service.js';
import { ProviderAdminRepository } from '@modules/shipping-quotes/provider-admin.repository.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { EventsSource } from '@modules/events/events.source.js';
import { HealthController } from '@modules/health/health.controller.js';
import { ReadinessService } from '@modules/health/readiness.service.js';

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('runtime quote feature HTTP boundary', () => {
  it.each([false, true])(
    'enforces enabled=%s on real quote controllers',
    async (quoteComparisonEnabled) => {
      for (const [key, value] of Object.entries(testEnvironment))
        vi.stubEnv(key, value);
      vi.stubEnv('QUOTE_COMPARISON_ENABLED', String(quoteComparisonEnabled));
      const providers = vi.fn(() => []);
      const settings = vi.fn(() => []);
      const module = await Test.createTestingModule({
        imports: [RuntimeFeaturesHttpModule, RuntimeFeaturesModule],
        controllers: [
          QuoteController,
          QuoteEventsController,
          ProviderAdminController,
          HealthController,
        ],
        providers: [
          { provide: QuoteService, useValue: { providers } },
          { provide: SenderDefaultsService, useValue: {} },
          { provide: ProviderAdminRepository, useValue: { settings } },
          { provide: AuthService, useValue: {} },
          { provide: EventsSource, useValue: {} },
          {
            provide: ReadinessService,
            useValue: { check: () => ({ status: 'ok' }) },
          },
        ],
      }).compile();
      app = module.createNestApplication();
      configureApiRoutes(app);
      await app.init();
      expect(module.get(RuntimeFeatures).quoteComparisonEnabled).toBe(
        quoteComparisonEnabled,
      );
      const server = app.getHttpServer() as Server;

      await request(server)
        .get('/api/v1/features')
        .expect(200)
        .expect('Cache-Control', 'no-store')
        .expect({ quoteComparisonEnabled });
      await request(server).get('/api/v1/health/live').expect(200);
      await request(server).get('/api/v1/health/ready').expect(200);
      await request(server)
        .get('/api/v1/quote-comparisons/providers')
        .expect(quoteComparisonEnabled ? 200 : 404);
      await request(server)
        .get('/api/v1/admin/shipping-providers')
        .expect(quoteComparisonEnabled ? 200 : 404);
      expect(providers).toHaveBeenCalledTimes(quoteComparisonEnabled ? 1 : 0);
      expect(settings).toHaveBeenCalledTimes(quoteComparisonEnabled ? 1 : 0);

      if (!quoteComparisonEnabled) {
        const id = '00000000-0000-4000-8000-000000000001';
        await request(server).get('/api/v1/quote-comparisons').expect(404);
        await request(server)
          .post('/api/v1/quote-comparisons')
          .send({})
          .expect(404);
        await request(server)
          .delete(`/api/v1/quote-comparisons/${id}`)
          .expect(404);
        await request(server)
          .get(`/api/v1/quote-comparisons/${id}/events`)
          .expect(404);
        await request(server)
          .patch('/api/v1/admin/shipping-providers/amazon')
          .send({})
          .expect(404);
        await request(server)
          .post('/api/v1/admin/shipping-providers/amazon/connection-tests')
          .send({})
          .expect(404);
      }
    },
  );
});
