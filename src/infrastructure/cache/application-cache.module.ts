import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { applicationCacheOptions } from './cache.config.js';

@Global()
@Module({
  imports: [CacheModule.register(applicationCacheOptions)],
  exports: [CacheModule],
})
export class ApplicationCacheModule {}
