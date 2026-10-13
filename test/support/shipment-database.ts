import { DataSource } from 'typeorm';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import { InitialSchema1791849600000 } from '@infrastructure/database/migrations/1791849600000-InitialSchema.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { ShipmentEntity } from '@modules/shipments/shipment.entity.js';
import { ShipmentTrackingSnapshotEntity } from '@modules/tracking/shipment-tracking-snapshot.entity.js';
import { TrackingRunEntity } from '@modules/tracking/tracking-run.entity.js';
import { TrackingAttemptEntity } from '@modules/tracking/tracking-attempt.entity.js';
import {
  postgresqlEnvironment,
  startPostgresqlContainer,
} from './postgresql-container.js';

export async function shipmentDatabase() {
  const container = await startPostgresqlContainer();
  const environment = postgresqlEnvironment(container);
  const source = new DataSource({
    ...createDatabaseOptions(createConfiguration(environment)),
    entities: [
      CarrierEntity,
      ShipmentEntity,
      ShipmentTrackingSnapshotEntity,
      TrackingRunEntity,
      TrackingAttemptEntity,
    ],
    migrations: [InitialSchema1791849600000],
  });
  try {
    await source.initialize();
    await source.runMigrations();
  } catch (error) {
    if (source.isInitialized) await source.destroy();
    await container.stop();
    throw error;
  }
  return {
    source,
    environment,
    async close() {
      try {
        if (source.isInitialized) await source.destroy();
      } finally {
        await container.stop();
      }
    },
  };
}
