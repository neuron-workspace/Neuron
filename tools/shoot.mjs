// Capture real screenshots of the app for the download site.
//
//   npm run build && node tools/shoot.mjs
//
// Real, not mocked: it launches the actual main process against a throwaway
// copy of the demo workspace, applies the light theme, opens a note, and
// photographs the window. A hand-drawn approximation on a download page is a
// promise the product then has to keep; a real capture keeps itself honest.
//
// An unpackaged Electron loads the Vite dev URL rather than the built files
// (main.ts: `!app.isPackaged` means dev), so this starts the renderer server
// itself. Skipping that produced a blank dark window and a confusing timeout.
import { _electron as electron } from '@playwright/test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shutdown } from './procs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repoRoot, 'docs', 'screenshots');
const DEV_URL = 'http://localhost:5174';

const waitForServer = async (url, ms = 120_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`renderer never came up at ${url}`);
};

let vite = null;
const alreadyUp = await fetch(DEV_URL).then((r) => r.ok).catch(() => false);
if (!alreadyUp) {
  console.log('starting the renderer dev server…');
  vite = spawn('npm', ['run', 'dev:renderer'], { cwd: repoRoot, shell: true, stdio: 'ignore' });
}
await waitForServer(DEV_URL);

mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'neuron-shot-'));
const workspace = join(dir, 'workspace');
const userData = join(dir, 'userData');
cpSync(join(repoRoot, 'examples', 'demo-repo'), workspace, { recursive: true });
mkdirSync(userData, { recursive: true });

// Light theme up front. Switching after launch would photograph the transition.
writeFileSync(join(userData, 'neuron-settings.json'), JSON.stringify({
  repositories: { current: workspace, recent: [workspace] },
  seededDemo: true,
  appearance: { preset: 'light' },
  // Terminal closed and graph overlay off. The terminal renders a real prompt
  // in a temp directory, which puts the capturing machine's username on a
  // public web page; the graph's labels collide at this size and read as a
  // rendering fault rather than a feature.
  layout: { activityBar: true, sidebar: true, rightPanel: false, bottomPanel: false, statusBar: true, graphOverlay: false },
}, null, 2));

// The workspace's own .neuron/layout.json splits the window and puts a real
// terminal in the lower pane, which app settings cannot override. That prompt
// prints the temp path -- and therefore the username of whatever machine ran
// this. Editing the throwaway copy is the only place to fix it.
writeFileSync(join(workspace, '.neuron', 'layout.json'), JSON.stringify({
  direction: 'vertical',
  children: [{ size: 100, panel: { type: 'editor' } }],
}, null, 2));

const app = await electron.launch({
  args: [join(repoRoot, 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
  cwd: repoRoot,
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded', { timeout: 90_000 });

// Resize the real window, not the page: setViewportSize is a browser concept
// and an Electron window ignores it.
await app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1440, 900);
  win.center();
});

const open = async (path) => {
  const trigger = page.getByRole('button', { name: /Search & commands/ });
  await trigger.click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill(path);
  await dialog.getByText(path, { exact: false }).first().click();
  await page.waitForTimeout(600);
};

// A note with layout components and a live table photographs better than an
// empty editor, and it is honest: it ships in the demo workspace.
await open('Dashboard.mdx');

// Confirm light actually applied rather than trusting the settings file.
const scheme = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
console.log('body background:', scheme);

// Scroll past the properties panel to the part worth photographing.
await page.locator('.preview-prose').first().hover().catch(() => {});
await page.mouse.wheel(0, 260);
await page.waitForTimeout(1000);

// A last check that nothing personal is on screen before it goes on a public
// page: the temp path contains the username, so the terminal must be gone.
const leak = await page.evaluate(() => {
  const text = document.body.innerText;
  // Windows home paths and POSIX ones. Either would publish the username
  // of whichever machine ran the capture.
  const win = text.match(/[A-Za-z]:\\Users\\[^\\\s]+/);
  const nix = text.match(/\/(?:home|Users)\/[^/\s]+/);
  return (win || nix)?.[0] ?? null;
});
if (leak) {
  const where = await page.evaluate(() => [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && /Users/.test(e.textContent || ''))
    .map((e) => e.tagName + '.' + (e.className || '').toString().slice(0, 40) + ' :: ' + e.textContent.trim().slice(0, 60))
    .slice(0, 6));
  console.log('leak sources:', JSON.stringify(where, null, 1));
  await page.screenshot({ path: join(out, '_debug-leak.png') });
}
if (leak) { throw new Error(`refusing to write a screenshot showing a local path: ${leak}`); }

await page.screenshot({ path: join(out, 'workspace-light.png') });
console.log('wrote docs/screenshots/workspace-light.png');

// process.exit below would end this script but not the Electron tree it
// started, which is one of the ways strays accumulated in the first place.
const outcome = await shutdown(app);
if (outcome === 'survived') console.warn('Electron survived shutdown; a stray process is still running.');
if (vite) { try { process.kill(-vite.pid); } catch { vite.kill(); } }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* the OS will */ }
process.exit(0);
