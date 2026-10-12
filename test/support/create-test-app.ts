import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import {
  READINESS_DEPENDENCIES,
  type ReadinessDependency,
} from '../../src/modules/health/readiness.service.js';

export async function createTestApp(dependencies: ReadinessDependency[] = []) {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  })
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
