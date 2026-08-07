import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/cli/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
