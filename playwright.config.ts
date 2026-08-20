import { defineConfig } from '@playwright/test';

// Electron end-to-end suite. There are no browser projects: every test drives
// the real app through _electron.launch, so no Playwright browser download is
// needed (`npx playwright install` is not part of setup).
export default defineConfig({
  testDir: './e2e',
  // One Electron app at a time. Parallel instances fight over the single-instance
  // lock and the shared user-data directory -- see the requestSingleInstanceLock
  // note in src/main/main.ts.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // The renderer is served by Vite: an unpackaged Electron treats itself as dev
  // and loads DEV_URL. Building the renderer instead would need a production
  // flag in main.ts, and a test-only branch in the process that owns the
  // security guards is not worth the convenience.
  webServer: {
    command: 'npm run dev:renderer',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
