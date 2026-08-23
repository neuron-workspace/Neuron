import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..');

/** The stale-workspace sweep is a once-per-run job, not a per-test one. */
let sweptThisRun = false;

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
    // Sweep ONCE per run, not per test. Teardown deletes nothing (below), so
    // leftovers accumulate; sweeping the whole pile before each of 23 tests is
    // slow enough to blow Playwright's worker-teardown budget by itself -- the
    // same failure the sweep was introduced to fix, reintroduced from the other
    // end. 166 stale directories had built up before this was noticed.
    //
    // Cleanup happens HERE, not in teardown:
    // Electron holds file handles on Windows after close -- the main process
    // watches this directory with chokidar and HTML views add webview partitions
    // and loopback sessions on top -- so deleting on the way out raced those
    // handles and blew Playwright's 60s worker-teardown budget. That surfaced as
    // a different test failing every run, because the timeout attaches to
    // whichever test the worker happened to be on. Deleting on the way IN has no
    // race: nothing holds those directories any more.
    if (!sweptThisRun) {
      sweptThisRun = true;
      // Bounded on purpose. Each leftover holds an Electron userData directory
      // -- tens of megabytes of GPU and code cache, not the 144K workspace --
      // so deleting a full backlog costs minutes and lands entirely inside the
      // first test's fixture, which is how it blew the worker-teardown budget.
      // A few per run drains the backlog across runs without any single run
      // paying for it.
      const stale = Date.now() - 60 * 60 * 1000;
      let budget = 5;
      for (const name of readdirSync(tmpdir())) {
        if (budget <= 0) break;
        if (!name.startsWith('neuron-e2e-')) continue;
        const dir = join(tmpdir(), name);
        try {
          if (statSync(dir).mtimeMs < stale) { rmSync(dir, { recursive: true, force: true }); budget--; }
        } catch { /* another run owns it, or the OS already reaped it */ }
      }
    }

    const dir = mkdtempSync(join(tmpdir(), 'neuron-e2e-'));
    const workspace = join(dir, 'workspace');
    cpSync(join(repoRoot, 'examples', 'demo-repo'), workspace, { recursive: true });
    await use(workspace);

    // Hand the delete to a detached OS process and return immediately.
    //
    // Three earlier attempts each failed differently: deleting synchronously
    // blocked on Electron's file handles and blew the 60s worker-teardown
    // budget; deleting nothing let the backlog grow to 299 directories, each
    // holding tens of megabytes of Electron cache; and a bounded sweep removed
    // 5 per run while every run created 23, which is a losing race.
    //
    // Detached costs teardown nothing and the OS finishes after the handles
    // drop. If it fails there is no consequence: the bounded sweep is still
    // there as a backstop.
    try {
      spawn(process.platform === 'win32' ? 'cmd' : 'rm',
        process.platform === 'win32' ? ['/c', 'rmdir', '/s', '/q', dir] : ['-rf', dir],
        { detached: true, stdio: 'ignore' }).unref();
    } catch { /* the sweep collects it */ }
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

    // Stub shell.openExternal for EVERY test, before a single line runs.
    //
    // This is not optional hygiene. main.ts hands any blocked navigation to the
    // OS browser (`shell.openExternal`), so a test that drives the app frame at
    // an external URL opens a real tab in the developer's real browser -- once
    // per hostile URL, per run, forever. It leaks out of the test process
    // entirely, which no assertion can catch and no teardown can undo.
    // Stubbing here rather than per-test means a future spec cannot forget.
    await app.evaluate(({ shell }) => {
      const store = globalThis as unknown as { __openExternal?: string[] };
      store.__openExternal = [];
      shell.openExternal = async (url: string) => { store.__openExternal!.push(url); };
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

/** URLs the app handed to the OS browser, recorded by the stub above. */
export function openedExternally(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __openExternal?: string[] }).__openExternal ?? []);
}
