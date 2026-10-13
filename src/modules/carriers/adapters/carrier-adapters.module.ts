import { Module } from '@nestjs/common';
import { CARRIER_ADAPTERS } from './carrier-adapter.js';
import { CarrierAdapterRegistry } from './carrier-adapter.registry.js';
import { UpsModule } from '@modules/carriers/adapters/ups/ups.module.js';
import { UpsAdapter } from '@modules/carriers/adapters/ups/ups.adapter.js';
import { EchoShipModule } from './echoship/echoship.module.js';
import { EchoShipAdapter } from './echoship/echoship.adapter.js';

@Module({
  imports: [UpsModule, EchoShipModule],
  providers: [
    {
      provide: CARRIER_ADAPTERS,
      inject: [UpsAdapter, EchoShipAdapter],
      useFactory: (ups: UpsAdapter, echoShip: EchoShipAdapter) => [
        ups,
        echoShip,
      ],
    },
    CarrierAdapterRegistry,
  ],
  exports: [CarrierAdapterRegistry],
})
export class CarrierAdaptersModule {}
