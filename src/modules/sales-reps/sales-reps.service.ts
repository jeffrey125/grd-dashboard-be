import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SALES_REPS_REPOSITORY,
  type SalesRepsRepository,
} from './sales-reps.repository.js';
import {
  createSalesRepSchema,
  parseSalesRepInput,
  salesRepExternalIdSchema,
  updateSalesRepSchema,
} from './sales-reps.schemas.js';

@Injectable()
export class SalesRepsService {
  constructor(
    @Inject(SALES_REPS_REPOSITORY)
    private readonly repository: SalesRepsRepository,
  ) {}

  listActive() {
    return this.repository.listActive();
  }

  listAll() {
    return this.repository.listAll();
  }

  async filterOptions() {
    const reps = await this.repository.listAll();

    return reps
      .sort((a, b) => Number(b.active) - Number(a.active))
      .map(({ externalId, firstName, lastName, active }) => ({
        externalId,
        firstName,
        lastName,
        active,
      }));
  }

  async find(externalId: string) {
    const id = parseSalesRepInput(salesRepExternalIdSchema, externalId);
    const row = await this.repository.find(id, true);

    if (!row) throw new NotFoundException('Sales Rep not found');

    return row;
  }

  async findActive(externalId: string) {
    const id = parseSalesRepInput(salesRepExternalIdSchema, externalId);

    return this.repository.findActive(id);
  }

  async create(input: unknown, actorId: number) {
    return this.repository.create(
      parseSalesRepInput(createSalesRepSchema, input),
      actorId,
    );
  }

  async update(externalId: string, input: unknown, actorId: number) {
    const id = parseSalesRepInput(salesRepExternalIdSchema, externalId);
    const changes = parseSalesRepInput(updateSalesRepSchema, input);
    const row = await this.repository.update(id, changes, actorId);

    if (!row) throw new NotFoundException('Active Sales Rep not found');

    return row;
  }

  async remove(externalId: string, actorId: number) {
    const id = parseSalesRepInput(salesRepExternalIdSchema, externalId);

    if (!(await this.repository.remove(id, actorId)))
      throw new NotFoundException('Active Sales Rep not found');
  }

  async restore(externalId: string, actorId: number) {
    const id = parseSalesRepInput(salesRepExternalIdSchema, externalId);

    if (!(await this.repository.restore(id, actorId)))
      throw new ConflictException('Sales Rep is already active or missing');

    return this.repository.find(id, true);
  }
}
