import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { supportsFetchMode } from './carrier-fetch-mode.js';
import {
  CARRIERS_REPOSITORY,
  type CarriersRepository,
} from './carriers.repository.js';
import {
  carrierExternalIdSchema,
  parseCarrierInput,
  updateCarrierSchema,
} from './carriers.schemas.js';

@Injectable()
export class CarriersService {
  constructor(
    @Inject(CARRIERS_REPOSITORY)
    private readonly repository: CarriersRepository,
  ) {}

  list() {
    return this.repository.list();
  }

  listActive() {
    return this.repository.listActive();
  }

  async find(externalId: string) {
    const id = parseCarrierInput(carrierExternalIdSchema, externalId);
    const carrier = await this.repository.find(id);

    if (!carrier) throw new NotFoundException('Carrier not found');

    return carrier;
  }

  async update(
    externalId: string,
    input: unknown,
    actorId: number | null = null,
  ) {
    const id = parseCarrierInput(carrierExternalIdSchema, externalId);
    const changes = parseCarrierInput(updateCarrierSchema, input);

    const carrierBefore = await this.find(id);
    if (
      carrierBefore.code === 'other' &&
      Object.keys(changes).some((key) => key !== 'isActive')
    )
      throw new BadRequestException(
        'Other only supports enabling or disabling manual entries',
      );

    if (changes.fetchMode) {
      if (!supportsFetchMode(carrierBefore.code, changes.fetchMode))
        throw new BadRequestException(
          'Fetch mode is not supported by this Carrier',
        );
    }

    const carrier = await this.repository.update(id, changes, actorId);

    if (!carrier) throw new NotFoundException('Carrier not found');

    return carrier;
  }
}
