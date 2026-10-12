import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { tsconfigPaths: true },
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['test/e2e/**/*.spec.ts', 'src/**/*.e2e.spec.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
