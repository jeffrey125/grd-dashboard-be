import { AUTH_ENGINE } from '@modules/auth/auth.engine.js';
import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import {
  READINESS_DEPENDENCIES,
  type ReadinessDependency,
} from '@modules/health/readiness.service.js';
import { TestDatabaseModule } from './test-database.module.js';

export async function createTestApp(dependencies: ReadinessDependency[] = []) {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideModule(DatabaseModule)
    .useModule(TestDatabaseModule)
    .overrideProvider(AUTH_ENGINE)
    .useValue({})
    .overrideProvider(READINESS_DEPENDENCIES)
    .useValue(dependencies)
    .compile();
  const app = module.createNestApplication();

  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
