import { Module } from '@nestjs/common';
import axios from 'axios';
import {
  FfeAdapter,
  FFE_BROWSER_LAUNCHER,
  FFE_HTTP_ADAPTER,
} from './ffe.adapter.js';
import { FfeConfiguration } from './ffe.config.js';
import { launchFfeBrowser } from './ffe.browser.js';

@Module({
  providers: [
    {
      provide: FfeConfiguration,
      useFactory: () => new FfeConfiguration(process.env),
    },
    {
      provide: FFE_HTTP_ADAPTER,
      useFactory: () => axios.getAdapter('http'),
    },
    { provide: FFE_BROWSER_LAUNCHER, useValue: launchFfeBrowser },
    FfeAdapter,
  ],
  exports: [FfeAdapter],
})
export class FfeModule {}
