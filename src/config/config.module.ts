import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from './configuration.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      expandVariables: false,
      skipProcessEnv: true,
    }),
  ],
  exports: [ConfigModule],
})
export class RuntimeConfigModule {}
