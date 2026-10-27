import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIP } from 'node:net';
import type { Request } from 'express';
import { AUTH_CONFIGURATION, type AuthConfiguration } from './auth.config.js';

@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  @Inject(AUTH_CONFIGURATION)
  private readonly config!: AuthConfiguration;

  protected override getTracker(request: Request): Promise<string> {
    if (this.config.trustProxy !== 'digitalocean')
      return super.getTracker(request);

    // Only opt in behind App Platform's ingress. Do not use X-Forwarded-For:
    // it represents the ingress server there, not the visitor.
    const address = request.headers['do-connecting-ip'];

    if (
      typeof address !== 'string' ||
      address.includes('%') ||
      !isIP(address)
    ) {
      throw new BadRequestException('Invalid client IP header');
    }

    // Reuse the installed throttler's canonicalization and IPv6 /64 grouping.
    return super.getTracker({ ip: address });
  }
}
