import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const externalStack = !!process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: externalStack ? [] : {
    command: 'node --import tsx tests/e2e/server.ts',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: { LOG_LEVEL: 'silent' },
  },
});
