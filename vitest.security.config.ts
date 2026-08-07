import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/tenancy/**/*.spec.ts',
      'tests/security/**/*.spec.ts',
      'apps/api/tests/tenancy/**/*.spec.ts',
      'apps/api/tests/security/**/*.spec.ts',
    ],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
