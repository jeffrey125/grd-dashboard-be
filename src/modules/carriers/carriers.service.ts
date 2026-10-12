import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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

  async update(externalId: string, input: unknown) {
    const id = parseCarrierInput(carrierExternalIdSchema, externalId);
    const changes = parseCarrierInput(updateCarrierSchema, input);
    const carrier = await this.repository.update(id, changes);
    if (!carrier) throw new NotFoundException('Carrier not found');
    return carrier;
  }
}
