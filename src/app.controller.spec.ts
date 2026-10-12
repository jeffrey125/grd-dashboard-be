import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppController } from './app.controller.js';
import { AppModule } from './app.module.js';

describe('AppController', () => {
  let app: TestingModule;

  beforeEach(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns the greeting through the registered service', () => {
    const controller = app.get(AppController);

    expect(controller.getHello()).toBe('Hello World!');
  });
});
