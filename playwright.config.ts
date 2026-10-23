import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the built web app and the real API code (local server, in-memory data).
export const E2E_PASSPHRASE = 'frase de prueba e2e larga';
const passphraseHash = execSync('node scripts/hash-passphrase.ts', { input: E2E_PASSPHRASE }).toString().trim();

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8790', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/dev-server.ts',
    url: 'http://localhost:8790/api/v1/health',
    reuseExistingServer: false,
    env: {
      PORT: '8790',
      DEV_STORE: 'memory',
      ADMIN_PASSPHRASE_HASH: passphraseHash,
      SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-123',
    },
  },
  projects: [
    // Closest to Safari on iPhone: WebKit engine with iPhone viewport and touch.
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'iphone-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
  ],
});
