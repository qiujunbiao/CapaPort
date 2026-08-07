import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/acceptance/**/*.spec.ts'],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/acceptance.vitest.json' },
  },
});
