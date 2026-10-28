import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Module,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthPolicy, AuthRateLimit } from '@modules/auth/auth.policy.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';

const route = z
  .string()
  .max(160)
  .regex(/^\/(?:[a-z-]+|:id)?(?:\/(?:[a-z-]+|:id))*$/);
export const frontendEventSchema = z.strictObject({
  kind: z.enum(['browser', 'react', 'unhandled-rejection', 'api']),
  page: route,
  release: z.string().regex(/^(?:[a-f0-9]{40}|development)$/),
  errorName: z.enum([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'URIError',
    'EvalError',
    'AggregateError',
    'UnknownError',
    'ApiError',
  ]),
  frames: z
    .array(
      z
        .string()
        .max(180)
        .regex(/^assets\/[A-Za-z0-9_.-]+\.js:\d{1,8}:\d{1,8}$/),
    )
    .max(8),
  method: z
    .enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])
    .optional(),
  route: route.optional(),
  status: z.number().int().min(0).max(599).optional(),
  failedRequestId: z.uuid().optional(),
});

@Controller('telemetry/frontend')
@AuthPolicy('session')
export class FrontendTelemetryController {
  constructor(@Inject(ProjectLogger) private readonly logger: ProjectLogger) {}

  @Post()
  @HttpCode(204)
  @AuthRateLimit('telemetry')
  report(@Body() input: unknown) {
    const result = frontendEventSchema.safeParse(input);

    if (!result.success)
      throw new BadRequestException('Invalid frontend event');

    this.logger
      .child({ component: 'frontend' })
      .warn('frontend.error', 'Frontend error reported', result.data);
  }
}

@Module({ controllers: [FrontendTelemetryController] })
export class FrontendTelemetryModule {}
