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
  // CI runners are markedly slower than a dev machine -- an Electron launch that
  // takes 3s locally took 20s there. Failing on the clock rather than on
  // behaviour teaches people to ignore the suite.
  timeout: process.env.CI ? 180_000 : 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // The renderer is served by Vite: an unpackaged Electron treats itself as dev
  // and loads DEV_URL. Building the renderer instead would need a production
  // flag in main.ts, and a test-only branch in the process that owns the
  // security guards is not worth the convenience.
  // Start our own renderer, never adopt one that is already listening.
  //
  // Reuse looks free and is not. The port is fixed at 5174, so a dev server
  // started in one checkout gets adopted by a run in another -- and Playwright
  // cannot tell, because all it checks is that something answers. A Codex task
  // verifying a change in its own worktree was silently exercising the renderer
  // from the main checkout, and reported a full green suite for code it had
  // never loaded.
  //
  // Fixing it the other way -- a per-checkout port -- would mean making DEV_URL
  // dynamic, and DEV_URL is what src/main/navigation.ts compares origins
  // against to decide where the app frame may navigate. That guard does not get
  // loosened for test ergonomics.
  //
  // vite runs with strictPort, so a port that is already taken now fails loudly
  // instead of quietly testing the wrong tree. The cost is that `npm run dev`
  // and the end-to-end suite can no longer share one server.
  webServer: {
    command: 'npm run dev:renderer',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
