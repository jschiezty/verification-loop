// Playwright config for the demo journey.
//   BASE_URL set     test that URL (a preview or staging environment); no server is started
//   BASE_URL unset   start the demo locally on port 4173
//   PW_CHANNEL=chrome  use an installed Google Chrome instead of downloading Playwright's browser
//
// Traces and screenshots are kept only on failure to keep artifacts small.

import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  retries: 0, // A journey that only passes on retry is a finding, not a pass.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]] : 'list',
  use: {
    baseURL,
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node src/server.mjs',
        url: `${baseURL}/health`,
        reuseExistingServer: false,
        timeout: 10_000,
      },
});
