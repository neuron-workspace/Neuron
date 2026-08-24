// Launch the PACKAGED application and prove it starts.
//
//   npm run build && npm run smoke            (packages to a temp dir first)
//   npm run smoke -- <path-to-unpacked-dir>   (reuse an existing package)
//
// This exists because 0.4.3 shipped an application that could not start at all,
// and every one of the 47 end-to-end tests was green. They all run against
// `dist/main/main.js` with the full node_modules tree present. The packaged app
// loads from inside app.asar, which contains only what electron-builder could
// reach from `dependencies` in package.json -- and `zod` was reachable in
// development only because npm hoists peer dependencies to the root.
//
// Nothing in the suite ever launched the artifact users download. This does.
import { _electron as electron } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shutdown } from './procs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findExecutable(dir) {
  if (!existsSync(dir)) return null;
  const exe = readdirSync(dir).find((f) => /\.exe$/i.test(f) && !/unins|elevate|squirrel/i.test(f));
  return exe ? join(dir, exe) : null;
}

let unpacked = process.argv[2];
let temp = null;

if (!unpacked) {
  // Package outside the repository. Building into ./release trips an EPERM on
  // this machine when a scanner holds the freshly extracted binaries.
  temp = mkdtempSync(join(tmpdir(), 'neuron-smoke-'));
  console.log('packaging to', temp, '…');
  execFileSync(process.execPath, [
    join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    '--config', 'tools/electron-builder.env.cjs',
    '--win', '--x64', '--dir', '--publish', 'never',
    `-c.directories.output=${temp}`,
  ], { cwd: root, stdio: 'inherit', env: { ...process.env, NEURON_BUILD_ENV: 'test' } });
  unpacked = join(temp, 'win-unpacked');
}

const executablePath = findExecutable(unpacked);
if (!executablePath) {
  console.error(`No executable found in ${unpacked}`);
  process.exit(1);
}
console.log('\nlaunching', executablePath);

const userData = mkdtempSync(join(tmpdir(), 'neuron-smoke-data-'));
let app;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`] });
} catch (err) {
  console.error('\nFAILED: the packaged application did not start.\n');
  console.error(err.message);
  process.exit(1);
}

// A main-process module error shows as a dialog and no window, so the window
// appearing is itself most of the assertion.
const page = await app.firstWindow({ timeout: 60_000 });
await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });

// And the renderer must actually have rendered, not just opened a blank frame.
const state = await page.evaluate(() => ({
  title: document.title,
  hasRoot: !!document.querySelector('#root')?.childElementCount,
  bodyText: (document.body.innerText || '').slice(0, 120),
}));

// No module-resolution probe here. The main process is ESM, so neither
// `require` nor a dynamic `import()` works inside app.evaluate -- and it is not
// needed: main.ts imports every AI provider statically at the top of the file,
// and each pulls in zod. A missing one kills the process before any window is
// created, which is exactly how 0.4.3 failed. A mounted renderer IS the
// assertion that the packaged dependency tree is complete.

console.log('\n  window title      :', state.title);
console.log('  renderer mounted  :', state.hasRoot);

await shutdown(app);
rmSync(userData, { recursive: true, force: true });
if (temp) { try { rmSync(temp, { recursive: true, force: true }); } catch { /* scanner holds it */ } }

const ok = state.hasRoot;
console.log(ok
  ? '\nsmoke: the packaged application starts and renders\n'
  : '\nsmoke: FAILED -- the packaged application did not render\n');
process.exit(ok ? 0 : 1);
