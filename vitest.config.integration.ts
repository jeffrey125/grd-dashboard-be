import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { tsconfigPaths: true },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['test/integration/**/*.spec.ts', 'src/**/*.integration.spec.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
