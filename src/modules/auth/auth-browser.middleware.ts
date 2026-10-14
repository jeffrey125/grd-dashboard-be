import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AUTH_CONFIGURATION, type AuthConfiguration } from './auth.config.js';

@Injectable()
export class AuthBrowserMiddleware implements NestMiddleware {
  constructor(
    @Inject(AUTH_CONFIGURATION) private readonly config: AuthConfiguration,
  ) {}

  use(request: Request, response: Response, next: NextFunction) {
    const origin = request.get('origin');
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);

    response.setHeader('Cache-Control', 'no-store');
    response.vary('Origin');

    if (
      (origin && !this.config.origins.includes(origin)) ||
      (!safe && !origin)
    ) {
      response
        .status(403)
        .json({ statusCode: 403, message: 'Origin not allowed' });

      return;
    }

    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (request.method === 'OPTIONS') {
      if (!origin) {
        response.status(403).end();

        return;
      }

      response.setHeader(
        'Access-Control-Allow-Methods',
        'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      );
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.status(204).end();

      return;
    }

    next();
  }
}
