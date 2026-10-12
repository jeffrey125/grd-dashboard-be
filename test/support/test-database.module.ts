import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** HTTP/composition tests only. Database behavior is covered with PostgreSQL. */
@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useFactory: () => ({
        isInitialized: false,
        manager: {},
        query: async () => [{ '?column?': 1 }],
      }),
    },
  ],
  exports: [DataSource],
})
export class TestDatabaseModule {}
