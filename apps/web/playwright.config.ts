import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/web',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1430', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:1430', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 960 } } }],
});
