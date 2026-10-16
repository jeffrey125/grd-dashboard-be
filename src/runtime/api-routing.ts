import type { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'api/v1';
export const API_BASE_PATH = `/${API_PREFIX}`;

export function configureApiRoutes(app: INestApplication) {
  app.setGlobalPrefix(API_PREFIX);
}
