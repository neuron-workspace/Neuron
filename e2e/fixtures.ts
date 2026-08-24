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

    // Bound the close, then kill. Electron does not always exit promptly -- it
    // is holding a chokidar watcher, a loopback HTTP server, PTYs and webview
    // partitions -- and on the CI runner `await app.close()` hung past the 60s
    // test timeout, failing a green run of 29 tests with "Tearing down app
    // exceeded the test timeout". Locally it always returned in under a second,
    // so this only ever reproduced in CI.
    //
    // Whether Electron shuts down tidily is a product question with its own
    // test, not something every fixture should block on.
    let closed = false;
    await Promise.race([
      app.close().then(() => { closed = true; }).catch(() => { closed = true; }),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    // Only kill what did not close. Killing an already-exiting Electron costs
    // real time across 40 tests and gains nothing.
    //
    // Kill the TREE. Electron's renderer, GPU and utility children inherit the
    // worker's stdio, so killing the main process alone leaves them holding
    // pipes the worker waits on -- a green run of 40 tests still failed with
    // "Worker teardown timeout of 180000ms exceeded", after every test passed.
    if (!closed) {
      const pid = app.process().pid;
      try {
        if (pid && process.platform === 'win32') {
          const { execFileSync } = await import('node:child_process');
          execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          app.process().kill();
        }
      } catch { /* already gone */ }
    }
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    // Generous, because this is Electron cold-starting against a Vite dev server
    // that compiles on first request. On a loaded CI runner individual tests were
    // taking 15-20s just to reach this point, and the 30s default tipped two of
    // them over -- a slow machine, not a broken app.
    await page.waitForLoadState('domcontentloaded', { timeout: 90_000 });
    await use(page);
  },
});

export const expect = test.expect;

/**
 * Open a note through the command palette.
 *
 * Not by clicking its `.note-row`: a note inside a collapsed folder has no row
 * in the DOM at all, so a row click is a test that silently depends on where
 * the note happens to live. The palette searches the whole workspace, so this
 * keeps working when notes are reorganised -- which is exactly what broke the
 * specs that used to click rows for `markdown-basics`.
 *
 * The title-bar trigger rather than Ctrl+K: the shortcut runs through a global
 * keydown handler attached on mount, so a press issued while the renderer is
 * still hydrating lands nowhere. Retrying is worse, not better -- the binding
 * TOGGLES, so a second press closes what the first opened.
 */
export async function openNote(page: Page, path: string) {
  const trigger = page.getByRole('button', { name: /Search & commands/ });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Filter first. The unfiltered list is long enough that the wanted entry may
  // be scrolled out of view, and a click on an off-screen item never lands.
  await dialog.getByRole('combobox').or(dialog.locator('input')).first().fill(path);
  await dialog.getByText(path, { exact: false }).first().click();
  await expect(dialog).toBeHidden();
}

/** URLs the app handed to the OS browser, recorded by the stub above. */
export function openedExternally(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __openExternal?: string[] }).__openExternal ?? []);
}
