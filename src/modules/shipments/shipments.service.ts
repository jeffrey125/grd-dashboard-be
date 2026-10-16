import {
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
  type NewShipment,
} from './shipments.schemas.js';

@Injectable()
export class ShipmentsService {
  constructor(
    @Inject(SHIPMENTS_REPOSITORY)
    private readonly repository: ShipmentsRepository,
    @Inject(CARRIERS_REPOSITORY) private readonly carriers: CarriersRepository,
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
                : ('shipment' as const),
            message: 'Invalid field or unsupported input',
          };
        }),
      );

    const carrier = await this.carriers.find(parsed.data.carrierExternalId);

    if (!carrier?.isActive)
      invalidShipmentFields([
        {
          field: 'carrierExternalId',
          message: 'Carrier is missing or disabled',
        },
      ]);

    const normalized: NewShipment = {
      ...parsed.data,
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
