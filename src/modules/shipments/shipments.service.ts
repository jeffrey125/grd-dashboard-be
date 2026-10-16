import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CARRIERS_REPOSITORY,
  type CarriersRepository,
} from '@modules/carriers/carriers.repository.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import {
  SHIPMENTS_REPOSITORY,
  type MonitoringCommand,
  type ShipmentsRepository,
} from './shipments.repository.js';
import {
  createShipmentSchema,
  invalidShipmentFields,
  monitoringCommandSchema,
  parseShipmentInput,
  shipmentHistoryQuerySchema,
  shipmentSearchQuerySchema,
  shipmentExternalIdSchema,
  updateShipmentNotesSchema,
  updateShipmentSchema,
  type NewShipment,
} from './shipments.schemas.js';
import { SalesRepsService } from '@modules/sales-reps/sales-reps.service.js';

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function businessToday(): string {
  const parts = Object.fromEntries(
    businessDateFormatter
      .formatToParts(new Date())
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

@Injectable()
export class ShipmentsService {
  constructor(
    @Inject(SHIPMENTS_REPOSITORY)
    private readonly repository: ShipmentsRepository,
    @Inject(CARRIERS_REPOSITORY) private readonly carriers: CarriersRepository,
    private readonly salesReps: SalesRepsService,
  ) {}

  list() {
    return this.repository.list();
  }

  search(query: unknown) {
    return this.repository.search(
      parseShipmentInput(shipmentSearchQuerySchema, query),
    );
  }

  async history(externalId: string, query: unknown) {
    const id = parseShipmentInput(shipmentExternalIdSchema, externalId);
    const pagination = parseShipmentInput(shipmentHistoryQuerySchema, query);
    const result = await this.repository.history(id, pagination);

    if (!result) throw new NotFoundException('Shipment not found');

    return result;
  }

  async create(input: unknown, actorId: number | null = null) {
    const parsed = createShipmentSchema.safeParse(input);

    if (!parsed.success)
      invalidShipmentFields(
        parsed.error.issues.map((issue) => {
          const field = issue.path[0];

          return {
            field:
              field === 'carrierExternalId' ||
              field === 'trackingReference' ||
              field === 'notes'
                ? field
                : field === 'salesRepExternalId' || field === 'followUpOn'
                  ? field
                  : ('shipment' as const),
            message: 'Invalid field or unsupported input',
          };
        }),
      );

    const carrier = await this.carriers.find(parsed.data.carrierExternalId);

    if (parsed.data.followUpOn && parsed.data.followUpOn < businessToday())
      invalidShipmentFields([
        {
          field: 'followUpOn',
          message: 'Follow-up date cannot be in the past',
        },
      ]);

    if (
      parsed.data.salesRepExternalId &&
      !(await this.salesReps.findActive(parsed.data.salesRepExternalId))
    )
      invalidShipmentFields([
        { field: 'salesRepExternalId', message: 'Sales Rep is unavailable' },
      ]);

    if (!carrier?.isActive)
      invalidShipmentFields([
        {
          field: 'carrierExternalId',
          message: 'Carrier is missing or disabled',
        },
      ]);

    const normalized: NewShipment = {
      ...parsed.data,
      salesRepExternalId: parsed.data.salesRepExternalId ?? null,
      followUpOn: parsed.data.followUpOn ?? null,
      trackingReference: carrierReferencePolicy(carrier.code).normalize(
        parsed.data.trackingReference,
      ),
    };
    const result = await this.repository.createMany([normalized], actorId);

    if (result.kind === 'unavailable') {
      // Revalidation under the database lock closes the Carrier-disable race.
      invalidShipmentFields([
        {
          field: 'carrierExternalId',
          message: 'Carrier is missing or disabled',
        },
      ]);
    }

    if (result.kind === 'sales_rep_unavailable')
      invalidShipmentFields([
        { field: 'salesRepExternalId', message: 'Sales Rep is unavailable' },
      ]);

    const shipment = result.inserted[0] ?? result.duplicates[0];

    if (!shipment)
      throw new ConflictException('Shipment creation could not be resolved');

    return {
      outcome: result.inserted.length
        ? ('created' as const)
        : ('existing' as const),
      shipment,
    };
  }

  async find(externalId: string) {
    const result = await this.repository.find(
      parseShipmentInput(shipmentExternalIdSchema, externalId),
    );

    if (!result) throw new NotFoundException('Shipment not found');

    return result;
  }

  async updateNotes(
    externalId: string,
    input: unknown,
    actorId: number | null = null,
  ) {
    const id = parseShipmentInput(shipmentExternalIdSchema, externalId);
    const { notes } = parseShipmentInput(updateShipmentNotesSchema, input);
    const result = await this.repository.updateNotes(id, notes, actorId);

    if (!result) throw new NotFoundException('Shipment not found');

    return result;
  }

  async update(
    externalId: string,
    input: unknown,
    actorId: number | null = null,
  ) {
    const id = parseShipmentInput(shipmentExternalIdSchema, externalId);
    const changes = parseShipmentInput(updateShipmentSchema, input);

    if (changes.followUpOn && changes.followUpOn < businessToday()) {
      const current = await this.repository.find(id);

      if (!current) throw new NotFoundException('Shipment not found');

      if (current.followUpOn !== changes.followUpOn)
        throw new BadRequestException('Follow-up date cannot be in the past');
    }

    if (
      changes.salesRepExternalId &&
      !(await this.salesReps.findActive(changes.salesRepExternalId))
    )
      throw new BadRequestException('Sales Rep is unavailable');

    const result = await this.repository.update(id, changes, actorId);

    if (!result) throw new NotFoundException('Shipment not found');

    return result;
  }

  async remove(externalId: string, actorId: number | null = null) {
    if (
      !(await this.repository.remove(
        parseShipmentInput(shipmentExternalIdSchema, externalId),
        actorId,
      ))
    )
      throw new NotFoundException('Shipment not found');
  }

  async changeMonitoring(
    externalId: string,
    command: MonitoringCommand,
    input: unknown = {},
    actorId: number | null = null,
  ) {
    const id = parseShipmentInput(shipmentExternalIdSchema, externalId);

    parseShipmentInput(monitoringCommandSchema, input);

    const result = await this.repository.changeMonitoring(id, command, actorId);

    if (result.kind === 'missing')
      throw new NotFoundException('Shipment not found');

    if (result.kind === 'conflict')
      throw new ConflictException(
        'Shipment monitoring transition is not permitted',
      );

    return result.shipment;
  }
}
