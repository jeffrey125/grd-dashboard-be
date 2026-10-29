import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

export const API_PREFIX = 'api/v1';
export const API_BASE_PATH = `/${API_PREFIX}`;

export function configureApiRoutes(app: INestApplication) {
  // A bounded 10,000-entry review list is sent as JSON rather than URL parameters.
  (app as NestExpressApplication).useBodyParser('json', { limit: '512kb' });
  app.setGlobalPrefix(API_PREFIX);
}
