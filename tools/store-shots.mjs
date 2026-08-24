// Capture Microsoft Store screenshots from the running application.
//
//   npm run build && node tools/store-shots.mjs   ->  store-assets/screenshots/*.png
//
// Real captures of the real app against the demo workspace. 1600x1000 clears
// the Store's 1366x768 recommendation with room to spare.
//
// An unpackaged Electron loads the Vite dev URL rather than the built files, so
// this starts the renderer server itself.
import { _electron as electron } from '@playwright/test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shutdown } from './procs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'store-assets', 'screenshots');
const DEV_URL = 'http://localhost:5174';
const WIDTH = 1600;
const HEIGHT = 1000;

const waitForServer = async (url, ms = 120_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`renderer never came up at ${url}`);
};

let vite = null;
if (!await fetch(DEV_URL).then((r) => r.ok).catch(() => false)) {
  console.log('starting the renderer dev server…');
  vite = spawn('npm', ['run', 'dev:renderer'], { cwd: root, shell: true, stdio: 'ignore' });
}
await waitForServer(DEV_URL);

mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'neuron-shot-'));
const workspace = join(dir, 'workspace');
const userData = join(dir, 'userData');
cpSync(join(root, 'examples', 'demo-repo'), workspace, { recursive: true });
mkdirSync(userData, { recursive: true });

writeFileSync(join(userData, 'neuron-settings.json'), JSON.stringify({
  repositories: { current: workspace, recent: [workspace] },
  seededDemo: true,
  appearance: { preset: 'light' },
  layout: { activityBar: true, sidebar: true, rightPanel: false, bottomPanel: false, statusBar: true, graphOverlay: false },
}, null, 2));

// The workspace's own layout puts a live terminal in the lower pane, and its
// prompt prints the temp path -- which is the capturing machine's username, on
// a public Store listing.
writeFileSync(join(workspace, '.neuron', 'layout.json'), JSON.stringify({
  direction: 'vertical',
  children: [{ size: 100, panel: { type: 'editor' } }],
}, null, 2));

const app = await electron.launch({
  args: [join(root, 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`, '--force-device-scale-factor=1'],
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded', { timeout: 90_000 });
await app.evaluate(async ({ BrowserWindow }, size) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(size.w, size.h);
  win.center();
}, { w: WIDTH, h: HEIGHT });

const open = async (path) => {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill(path);
  await dialog.getByText(path, { exact: false }).first().click();
  await page.waitForTimeout(900);
};

/** Nothing personal reaches a public listing. This has already fired once. */
const assertNoLocalPaths = async (label) => {
  const leak = await page.evaluate(() => {
    const text = document.body.innerText;
    const win = text.match(/[A-Za-z]:\\Users\\[^\\\s]+/);
    const nix = text.match(/\/(?:home|Users)\/[^/\s]+/);
    return (win || nix)?.[0] ?? null;
  });
  if (leak) throw new Error(`refusing to write ${label}: a local path is visible (${leak})`);
};

const shoot = async (file) => {
  await assertNoLocalPaths(file);
  const target = join(out, file);
  // No clip. A clip rectangle crops whatever the viewport actually is, so if
  // the window ends up wider than WIDTH the right edge is silently cut -- which
  // is exactly what happened, and it read as an overflow bug in the app until
  // measuring inside the webview showed scrollWidth equal to clientWidth.
  await page.screenshot({ path: target });
  const buf = readFileSync(target);
  console.log(`  ok  ${file.padEnd(30)} ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
};

// 1. A note. Layout components and a live database table in reading view.
await open('Dashboard.mdx');
await page.locator('.preview-prose').first().hover().catch(() => {});
await page.mouse.wheel(0, 260);
await page.waitForTimeout(800);
await shoot('01-notes-and-dashboards.png');

// 2. The canvas, which is the most visually distinct surface.
await open('Idea board.canvas');
await page.waitForTimeout(1200);
await shoot('02-canvas.png');

// 3. A typed database, stored as readable JSON.
await open('Planner.db');
await page.waitForTimeout(1200);
await shoot('03-database.png');

// 4. A sandboxed HTML view computing from that database.
await open('Custom dashboard.html');
const allow = page.getByRole('button', { name: 'Allow for this view' });
if (await allow.isVisible().catch(() => false)) await allow.click();
await page.waitForTimeout(2500);
await shoot('04-custom-views.png');

await shutdown(app);
if (vite) { try { process.kill(-vite.pid); } catch { vite.kill(); } }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* the OS will */ }
console.log('\nwrote 4 screenshots to store-assets/screenshots/');
process.exit(0);
