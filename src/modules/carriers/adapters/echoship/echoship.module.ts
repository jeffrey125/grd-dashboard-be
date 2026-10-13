import { Module } from '@nestjs/common';
import axios from 'axios';
import {
  EchoShipAdapter,
  ECHOSHIP_BROWSER_LAUNCHER,
  ECHOSHIP_HTTP_ADAPTER,
} from './echoship.adapter.js';
import { EchoShipConfiguration } from './echoship.config.js';
import { launchEchoShipBrowser } from './echoship.browser.js';

@Module({
  providers: [
    {
      provide: EchoShipConfiguration,
      useFactory: () => new EchoShipConfiguration(process.env),
    },
    {
      provide: ECHOSHIP_HTTP_ADAPTER,
      useFactory: () => axios.getAdapter('http'),
    },
    { provide: ECHOSHIP_BROWSER_LAUNCHER, useValue: launchEchoShipBrowser },
    EchoShipAdapter,
  ],
  exports: [EchoShipAdapter],
})
export class EchoShipModule {}
