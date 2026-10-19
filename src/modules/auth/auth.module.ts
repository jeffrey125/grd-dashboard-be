import {
  Inject,
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { APP_GUARD, HttpAdapterHost } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthService } from './auth.service.js';
import {
  AUTH_CONFIGURATION,
  authConfiguration,
  type AuthConfiguration,
} from './auth.config.js';
import { AUTH_ENGINE, createAuthEngine } from './auth.engine.js';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { TypeOrmAuthRepository } from './typeorm-auth.repository.js';
import { AuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AccountsController } from './accounts.controller.js';
import { AuthBrowserMiddleware } from './auth-browser.middleware.js';
import { AUTH_RATE_SCOPE } from './auth.policy.js';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Module({
  imports: [
    DatabaseModule,
    ThrottlerModule.forRoot([
      {
        name: 'login-ip',
        ttl: 60000,
        limit: 60,
        skipIf: (context) =>
          Reflect.getMetadata(AUTH_RATE_SCOPE, context.getHandler()) !==
          'login',
      },
      {
        name: 'login-email',
        ttl: 60000,
        limit: 5,
        skipIf: (context) =>
          Reflect.getMetadata(AUTH_RATE_SCOPE, context.getHandler()) !==
          'login',
        getTracker: (request) =>
          digest(
            typeof request.body?.email === 'string'
              ? request.body.email.trim().toLowerCase().slice(0, 254)
              : 'invalid',
          ),
      },
      {
        name: 'password',
        ttl: 60000,
        limit: 5,
        skipIf: (context) =>
          Reflect.getMetadata(AUTH_RATE_SCOPE, context.getHandler()) !==
          'password',
        getTracker: (request) => String(request.principal.id),
        generateKey: (_context, tracker) => digest(`password:${tracker}`),
      },
    ]),
  ],
  controllers: [AuthController, AccountsController],
  providers: [
    {
      provide: AUTH_CONFIGURATION,
      useFactory: () => authConfiguration(process.env),
    },
    {
      provide: AUTH_ENGINE,
      inject: [DataSource, AUTH_CONFIGURATION],
      useFactory: createAuthEngine,
    },
    {
      provide: AUTH_REPOSITORY,
      inject: [DataSource],
      useFactory: (source: DataSource) => new TypeOrmAuthRepository(source),
    },
    AuthService,
    AuthBrowserMiddleware,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AuthService],
})
export class AuthModule implements NestModule, OnApplicationBootstrap {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
    @Inject(AUTH_CONFIGURATION) private readonly config: AuthConfiguration,
  ) {}

  configure(consumer: MiddlewareConsumer) {
    this.adapter.httpAdapter?.enableCors({
      origin: this.config.origins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      // The origin policy must still validate preflight requests.
      preflightContinue: true,
    });
    consumer.apply(AuthBrowserMiddleware).forRoutes('{*path}');
  }

  onApplicationBootstrap() {
    // An application context (e.g. bootstrap CLI) has no HTTP adapter.
    this.adapter.httpAdapter
      ?.getInstance()
      .set('trust proxy', this.config.trustProxy);
  }
}
