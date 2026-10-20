import { SenderDefaultsService } from './sender-defaults.service.js';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { QUOTE_REPOSITORY, type QuoteRepository } from './quote.repository.js';
import { createQuoteSchema, type SenderSnapshot } from './quote.schemas.js';
import { canQueueProvider } from './quote-provider-eligibility.js';

function hasBlankDimensions(input: z.infer<typeof createQuoteSchema>) {
  return input.packageGroups.some((group) => group.length === '');
}

@Injectable()
export class QuoteService {
  constructor(
    @Inject(QUOTE_REPOSITORY) private readonly repository: QuoteRepository,
    @Inject(SenderDefaultsService)
    private readonly defaults: SenderDefaultsService,
  ) {}
  providers() {
    return this.repository.providers();
  }
  async create(raw: unknown, actorId: number) {
    const parsed = createQuoteSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Invalid comparison inputs',
        fields: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    const input = parsed.data;
    const existing = await this.repository.existing(input, actorId);
    if (existing) return { outcome: 'existing' as const, comparison: existing };
    if (hasBlankDimensions(input)) {
      const configurations = await this.repository.providers();
      const selected = new Set(
        input.providers.map((provider) => provider.code),
      );
      const selectedConfigurations = configurations.filter((provider) =>
        selected.has(provider.code),
      );
      const queueableConfigurations = selectedConfigurations.filter(
        (configuration) => canQueueProvider(input, configuration),
      );
      const blankDimensionsSupported = queueableConfigurations.every(
        (provider) =>
          provider.code === 'unishippers' &&
          provider.executionMode === 'request',
      );
      if (!blankDimensionsSupported)
        throw new BadRequestException({
          message: 'Invalid comparison inputs',
          fields: input.packageGroups.flatMap((group, index) =>
            group.length === ''
              ? [
                  {
                    field: `packageGroups.${index}`,
                    message:
                      'Dimensions are required for the selected provider or execution mode',
                  },
                ]
              : [],
          ),
        });
    }
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (input.shipDate < today)
      throw new BadRequestException(
        'Ship date cannot be in the past (America/New_York)',
      );
    const senders: SenderSnapshot[] = input.providers.map((provider) => {
      if (provider.sender.mode === 'account_default')
        return this.defaults.resolve(
          provider.sender.refreshId,
          provider.code,
          actorId,
        );
      return {
        code: provider.code,
        address: provider.sender.address,
        mode: 'explicit',
        retrievedAt: null,
      };
    });
    return this.repository.create(input, actorId, senders);
  }
  retry(id: string, attemptId: string) {
    return this.repository.retry(id.toLowerCase(), attemptId.toLowerCase());
  }
  setDeleted(id: string, deleted: boolean, actorId: number) {
    return this.repository.setDeleted(id, deleted, actorId);
  }
  async find(id: string, includeDeleted = false) {
    const result = await this.repository.find(id, includeDeleted);
    if (!result) throw new NotFoundException('Comparison not found');
    return result;
  }
  list(raw: unknown, admin = false) {
    const parsed = z
      .strictObject({
        page: z.coerce.number().int().min(1).max(1000000).default(1),
        deleted: z.enum(['true', 'false']).default('false'),
      })
      .safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid page');
    if (parsed.data.deleted === 'true' && !admin)
      throw new ForbiddenException('Deleted history is admin-only');
    return this.repository.list(
      parsed.data.page,
      parsed.data.deleted === 'true',
    );
  }
}
