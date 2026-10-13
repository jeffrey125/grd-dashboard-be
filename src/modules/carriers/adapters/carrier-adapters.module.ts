import { Module } from '@nestjs/common';
import { CARRIER_ADAPTERS } from './carrier-adapter.js';
import { CarrierAdapterRegistry } from './carrier-adapter.registry.js';
import { UpsModule } from '@modules/carriers/adapters/ups/ups.module.js';
import { UpsAdapter } from '@modules/carriers/adapters/ups/ups.adapter.js';

@Module({
  imports: [UpsModule],
  providers: [
    {
      provide: CARRIER_ADAPTERS,
      inject: [UpsAdapter],
      useFactory: (ups: UpsAdapter) => [ups],
    },
    CarrierAdapterRegistry,
  ],
  exports: [CarrierAdapterRegistry],
})
export class CarrierAdaptersModule {}
