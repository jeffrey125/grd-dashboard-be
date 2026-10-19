import { SenderDefaultsService } from './sender-defaults.service.js';
import {
  BadRequestException,
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
  async find(id: string) {
    const result = await this.repository.find(id);
    if (!result) throw new NotFoundException('Comparison not found');
    return result;
  }
  list(raw: unknown) {
    const parsed = z
      .strictObject({
        page: z.coerce.number().int().min(1).max(1000000).default(1),
      })
      .safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid page');
    return this.repository.list(parsed.data.page);
  }
}
