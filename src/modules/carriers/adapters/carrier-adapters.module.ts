import { Module } from '@nestjs/common';
import { CARRIER_ADAPTERS } from './carrier-adapter.js';
import { CarrierAdapterRegistry } from './carrier-adapter.registry.js';

@Module({
  providers: [
    { provide: CARRIER_ADAPTERS, useValue: [] },
    CarrierAdapterRegistry,
  ],
  exports: [CarrierAdapterRegistry],
})
export class CarrierAdaptersModule {}
