import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..');

/**
 * Every test gets its own throwaway workspace and userData directory.
 *
 * This is not tidiness. The app writes to its workspace as you use it -- a
 * canvas records node positions, a .db records rows, views persist variables --
 * so a suite pointed at examples/demo-repo would rewrite the committed demo
 * content as a side effect of running, and the diff would show up as unrelated
 * churn in someone's next commit. Point tests at a copy, always.
 */
export interface AppFixture {
  app: ElectronApplication;
  page: Page;
  workspace: string;
}

export const test = base.extend<AppFixture>({
  workspace: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'neuron-e2e-'));
    const workspace = join(dir, 'workspace');
    cpSync(join(repoRoot, 'examples', 'demo-repo'), workspace, { recursive: true });
    await use(workspace);
    rmSync(dir, { recursive: true, force: true });
  },

  app: async ({ workspace }, use) => {
    // Pre-seed settings so the app opens our copy instead of running its
    // first-launch demo-repo discovery, which would reach the real one.
    const userData = join(workspace, '..', 'userData');
    mkdirSync(userData, { recursive: true });
    writeFileSync(
      join(userData, 'neuron-settings.json'),
      JSON.stringify({ repositories: { current: workspace, recent: [workspace] }, seededDemo: true }, null, 2),
    );

    const app = await electron.launch({
      args: [join(repoRoot, 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
      cwd: repoRoot,
    });
    await use(app);
    await app.close();
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export const expect = test.expect;
