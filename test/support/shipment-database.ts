import { MonitoringSafeguards1793318400000 } from '@infrastructure/database/migrations/1793318400000-MonitoringSafeguards.js';
import { ProviderWeightLimits1793232000000 } from '@infrastructure/database/migrations/1793232000000-ProviderWeightLimits.js';
import { ProviderAdministration1793059200000 } from '@infrastructure/database/migrations/1793059200000-ProviderAdministration.js';
import { AmazonApiMode1793145600000 } from '@infrastructure/database/migrations/1793145600000-AmazonApiMode.js';
import { QUOTE_ENTITIES } from '@modules/shipping-quotes/quote.entities.js';
import { QuoteHistoryRetry1792972800000 } from '@infrastructure/database/migrations/1792972800000-QuoteHistoryRetry.js';
import { QuoteExecution1792627200000 } from '@infrastructure/database/migrations/1792627200000-QuoteExecution.js';
import { AmazonQuoteBreakdown1792713600000 } from '@infrastructure/database/migrations/1792713600000-AmazonQuoteBreakdown.js';
import { OptionalPackageDimensions1792800000000 } from '@infrastructure/database/migrations/1792800000000-OptionalPackageDimensions.js';
import { InternationalQuoteOptions1792886400000 } from '@infrastructure/database/migrations/1792886400000-InternationalQuoteOptions.js';
import { QuoteComparisons1792540800000 } from '@infrastructure/database/migrations/1792540800000-QuoteComparisons.js';
import { TrackingReadProjection1792281600000 } from '@infrastructure/database/migrations/1792281600000-TrackingReadProjection.js';
import { TrackingChangeEvents1792368000000 } from '@infrastructure/database/migrations/1792368000000-TrackingChangeEvents.js';
import { AUTH_ENTITIES } from '@modules/auth/auth.entities.js';
import { TrackingEvents1792195200000 } from '@infrastructure/database/migrations/1792195200000-TrackingEvents.js';
import { EmployeeAuth1792108800000 } from '@infrastructure/database/migrations/1792108800000-EmployeeAuth.js';
import { DataSource } from 'typeorm';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import { InitialSchema1791849600000 } from '@infrastructure/database/migrations/1791849600000-InitialSchema.js';
import { CarrierFetchMode1791936000000 } from '@infrastructure/database/migrations/1791936000000-CarrierFetchMode.js';
import { FfeRequestMode1792022400000 } from '@infrastructure/database/migrations/1792022400000-FfeRequestMode.js';
import { SalesRepsAndShipmentFollowUp1792454400000 } from '@infrastructure/database/migrations/1792454400000-SalesRepsAndShipmentFollowUp.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { SalesRepEntity } from '@modules/sales-reps/sales-rep.entity.js';
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
  // Feature integration fixtures exercise quote routes/workers. Production still
  // defaults to tracking-only; explicit disabled-mode tests override this value.
  const environment = {
    ...postgresqlEnvironment(container),
    QUOTE_COMPARISON_ENABLED: 'true',
  };
  const source = new DataSource({
    ...createDatabaseOptions(createConfiguration(environment)),
    entities: [
      ...AUTH_ENTITIES,
      ...QUOTE_ENTITIES,
      CarrierEntity,
      SalesRepEntity,
      ShipmentEntity,
      ShipmentTrackingSnapshotEntity,
      TrackingRunEntity,
      TrackingAttemptEntity,
    ],
    migrations: [
      InitialSchema1791849600000,
      CarrierFetchMode1791936000000,
      FfeRequestMode1792022400000,
      EmployeeAuth1792108800000,
      TrackingEvents1792195200000,
      TrackingReadProjection1792281600000,
      TrackingChangeEvents1792368000000,
      SalesRepsAndShipmentFollowUp1792454400000,
      QuoteComparisons1792540800000,
      QuoteExecution1792627200000,
      AmazonQuoteBreakdown1792713600000,
      OptionalPackageDimensions1792800000000,
      InternationalQuoteOptions1792886400000,
      QuoteHistoryRetry1792972800000,
      ProviderAdministration1793059200000,
      AmazonApiMode1793145600000,
      ProviderWeightLimits1793232000000,
      MonitoringSafeguards1793318400000,
    ],
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
