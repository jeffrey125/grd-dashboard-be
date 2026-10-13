import { Module } from '@nestjs/common';
import axios from 'axios';
import { UpsAdapter } from './ups.adapter.js';
import { UpsClient, UPS_HTTP_ADAPTER } from './ups.client.js';
import { UpsConfiguration } from './ups.config.js';
import { UpsTokenProvider } from './ups-token.provider.js';

@Module({
  providers: [
    {
      provide: UpsConfiguration,
      useFactory: () => new UpsConfiguration({ ...process.env }),
    },
    { provide: UPS_HTTP_ADAPTER, useFactory: () => axios.getAdapter('http') },
    UpsClient,
    UpsTokenProvider,
    UpsAdapter,
  ],
  exports: [UpsAdapter],
})
export class UpsModule {}
