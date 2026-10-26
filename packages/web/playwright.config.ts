import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 18090);

// One fresh data directory per run (inherited by the worker processes through the env).
process.env.E2E_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'opendialer-e2e-'));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // the web client must be built first (npm run e2e does `vite build` before running Playwright)
    command: 'node ../server/dist/index.js',
    cwd: here,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATA_DIR: process.env.E2E_DATA_DIR!,
      PORT: String(PORT),
      HTTPS_PORT: '0',
      TLS: 'off',
      HOST: '127.0.0.1',
      WEB_DIR: path.join(here, 'dist'),
      ENGINE_INTERVAL_MS: '1000',
      LOG_LEVEL: 'warn',
      JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
    },
  },
});
