import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WIDGET_E2E_PORT ?? 4290);

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.WIDGET_E2E_BASE_URL ?? `http://localhost:${port}`,
    viewport: { width: 480, height: 200 },
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 480, height: 200 } },
    },
  ],
});
