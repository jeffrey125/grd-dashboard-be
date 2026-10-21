import {
  Body,
  Controller,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { AuthPolicy, CurrentPrincipal } from '@modules/auth/auth.policy.js';
import { AuthService } from '@modules/auth/auth.service.js';
import type { Principal } from '@modules/auth/auth.repository.js';
import { QuoteService } from './quote.service.js';
import { AmazonVerificationBridge } from './amazon-verification.bridge.js';
import {
  VerificationError,
  verificationActionSchema,
} from './amazon-verification.contract.js';

const inputSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('start') }),
  z.strictObject({ operation: z.literal('poll'), id: z.string().uuid() }),
  z.strictObject({ operation: z.literal('cancel'), id: z.string().uuid() }),
  z.strictObject({
    operation: z.literal('action'),
    id: z.string().uuid(),
    action: verificationActionSchema,
  }),
]);

@Controller('quote-comparisons')
@AuthPolicy('staff')
export class AmazonVerificationController {
  constructor(
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(AmazonVerificationBridge)
    private readonly bridge: AmazonVerificationBridge,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post(':externalId/attempts/:attemptId/amazon-verification')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async operate(
    @Param('externalId', new ParseUUIDPipe({ version: '4' }))
    comparisonId: string,
    @Param('attemptId', new ParseUUIDPipe({ version: '4' })) attemptId: string,
    @Body() raw: unknown,
    @CurrentPrincipal() principal: Principal,
    @Req() request: Request,
  ) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException('Invalid verification action');
    const comparison = await this.quotes.find(comparisonId.toLowerCase());
    const attempt = comparison.attempts.find(
      (entry) => entry.externalId === attemptId.toLowerCase(),
    );
    if (
      !attempt ||
      attempt.provider !== 'amazon' ||
      attempt.reasonCode !== 'verification_required' ||
      attempt.status !== 'failed'
    )
      throw new ConflictException(
        'Amazon verification is not required for this attempt',
      );
    if (parsed.data.operation === 'start' && attempt.retryBlockedReason)
      throw new ConflictException('This quote cannot be retried');
    const identity = {
      owner: `${principal.externalId}:${principal.sessionId}`,
      actorExternalId: principal.externalId,
      comparisonId: comparisonId.toLowerCase(),
      attemptId: attemptId.toLowerCase(),
    };
    try {
      const view = await this.bridge.send({ ...identity, ...parsed.data });
      // A revoked/restricted session cannot receive a frame after a long worker operation.
      try {
        const current = await this.auth.authenticate(
          fromNodeHeaders(request.headers),
        );
        if (
          current.sessionId !== principal.sessionId ||
          current.externalId !== principal.externalId ||
          current.mustChangePassword ||
          !['staff', 'admin'].includes(current.role)
        )
          throw new VerificationError('owner_required');
        await this.quotes.find(comparisonId.toLowerCase());
      } catch (error) {
        await this.bridge
          .send({ ...identity, operation: 'cancel', id: view.id })
          .catch(() => undefined);
        throw error;
      }
      return view;
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
      const body = {
        message: 'Amazon verification could not continue',
        verificationCode: error.code,
      };
      if (error.code === 'unavailable')
        throw new ServiceUnavailableException(body);
      throw new ConflictException(body);
    }
  }
}
