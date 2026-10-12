import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';

export async function createTestApp() {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();

  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
