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
  createShipmentsEnvelopeSchema,
  invalidShipmentRows,
  monitoringCommandSchema,
  parseShipmentInput,
  shipmentSearchQuerySchema,
  shipmentExternalIdSchema,
  updateShipmentNotesSchema,
  type NewShipment,
  type ShipmentValidationDetail,
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

  async create(input: unknown, actorId: number | null = null) {
    const envelope = parseShipmentInput(createShipmentsEnvelopeSchema, input);
    const details: ShipmentValidationDetail[] = [];
    const normalized: NewShipment[] = [];

    for (const [index, item] of envelope.items.entries()) {
      const result = createShipmentSchema.safeParse(item);

      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0];

          details.push({
            row: index + 1,
            field:
              field === 'carrierExternalId' ||
              field === 'trackingReference' ||
              field === 'notes'
                ? field
                : 'item',
            message: 'Invalid field or unsupported input',
          });
        }

        continue;
      }

      const carrier = await this.carriers.find(result.data.carrierExternalId);

      if (!carrier?.isActive) {
        details.push({
          row: index + 1,
          field: 'carrierExternalId',
          message: 'Carrier is missing or disabled',
        });

        continue;
      }

      normalized.push({
        ...result.data,
        trackingReference: carrierReferencePolicy(carrier.code).normalize(
          result.data.trackingReference,
        ),
      });
    }

    if (details.length) invalidShipmentRows(details);

    const unique = new Map<string, NewShipment>();

    for (const item of normalized)
      unique.set(
        JSON.stringify([item.carrierExternalId, item.trackingReference]),
        item,
      );

    const result = await this.repository.createMany(
      [...unique.values()],
      actorId,
    );

    if (result.kind === 'unavailable') {
      // Revalidation under the database lock closes the Carrier-disable race.
      invalidShipmentRows(
        normalized.flatMap((item, index) =>
          result.carrierExternalIds.includes(item.carrierExternalId)
            ? [
                {
                  row: index + 1,
                  field: 'carrierExternalId' as const,
                  message: 'Carrier is missing or disabled',
                },
              ]
            : [],
        ),
      );
    }

    return { inserted: result.inserted, duplicates: result.duplicates };
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
