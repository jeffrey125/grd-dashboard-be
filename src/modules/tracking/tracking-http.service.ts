import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  TRACKING_HTTP_REPOSITORY,
  type TrackingHttpRepository,
} from './tracking-http.repository.js';

@Injectable()
export class TrackingHttpService {
  constructor(
    @Inject(TRACKING_HTTP_REPOSITORY)
    private readonly repository: TrackingHttpRepository,
  ) {}

  async refresh(externalId: string, actorId: number, body: unknown) {
    if (
      !z
        .object({})
        .strict()
        .safeParse(body ?? {}).success
    )
      throw new BadRequestException('Refresh accepts an empty body only');

    const result = await this.repository.queue(externalId, actorId);

    if (result.kind === 'missing')
      throw new NotFoundException('Shipment not found');

    if (result.kind === 'unavailable')
      throw new ConflictException(
        'Shipment or Carrier is unavailable for refresh',
      );

    if (result.kind === 'accepted') return result.run;
  }

  async find(externalId: string) {
    const run = await this.repository.find(externalId);

    if (!run) throw new NotFoundException('Tracking run not found');

    return run;
  }
}
