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
import { chromium } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAlive, killTree } from './procs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { build = {}, build: { productName = 'neuron' } = {} } = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf-8'),
);

/**
 * The packaged executable, wherever this platform puts it.
 *
 * electron-builder writes a different shape per platform: a bare .exe on
 * Windows, an .app bundle on macOS whose real binary is buried in
 * Contents/MacOS, and an extensionless ELF on Linux. Accepts either the
 * unpacked directory or, on macOS, the .app itself.
 */
function findExecutable(dir) {
  if (!existsSync(dir)) return null;

  if (process.platform === 'darwin') {
    // Either we were handed the .app, or it sits inside the directory.
    const bundle = dir.endsWith('.app')
      ? dir
      : (() => {
          const hit = readdirSync(dir).find((f) => f.endsWith('.app'));
          return hit ? join(dir, hit) : null;
        })();
    if (!bundle) return null;
    const macos = join(bundle, 'Contents', 'MacOS');
    if (!existsSync(macos)) return null;
    const bin = readdirSync(macos)[0];
    return bin ? join(macos, bin) : null;
  }

  if (process.platform === 'win32') {
    const exe = readdirSync(dir).find((f) => /\.exe$/i.test(f) && !/unins|elevate|squirrel/i.test(f));
    return exe ? join(dir, exe) : null;
  }

  // Linux: name the binary rather than hunting for it. electron-builder calls
  // it `executableName`, which defaults to productName lowercased.
  //
  // The first version scanned for the executable bit and took the first hit.
  // The directory also holds chrome-sandbox and chrome_crashpad_handler, which
  // are executable, are extensionless like the app, and sort ahead of it -- so
  // the scan launched chrome-sandbox, and Playwright reported only "Process
  // failed to launch", naming nothing.
  const named = join(dir, (build.executableName ?? productName).toLowerCase());
  if (existsSync(named)) return named;

  // Fall back to the scan, minus Electron's own helpers.
  const candidate = readdirSync(dir).find((f) => {
    if (/^chrome[-_]/i.test(f)) return false;
    if (/\.(so|so\.\d+|pak|dat|bin|json|html|txt|md|desktop|png)$/i.test(f)) return false;
    const full = join(dir, f);
    try {
      const st = statSync(full);
      return st.isFile() && (st.mode & 0o111) !== 0;
    } catch { return false; }
  });
  return candidate ? join(dir, candidate) : null;
}

let unpacked = process.argv[2];
let temp = null;

if (!unpacked) {
  // Package outside the repository. Building into ./release trips an EPERM on
  // this machine when a scanner holds the freshly extracted binaries.
  temp = mkdtempSync(join(tmpdir(), 'neuron-smoke-'));
  console.log('packaging to', temp, '…');
  const target = process.platform === 'win32' ? '--win'
    : process.platform === 'darwin' ? '--mac'
    : '--linux';
  execFileSync(process.execPath, [
    join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    '--config', 'tools/electron-builder.env.cjs',
    target, '--dir', '--publish', 'never',
    `-c.directories.output=${temp}`,
  ], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEURON_BUILD_ENV: 'test',
      // electron-builder skips code signing entirely when it detects a pull
      // request, which would make this smoke test package something the release
      // never ships and then verify a signature that was never applied. The
      // guard exists to keep signing certificates out of untrusted PR builds;
      // macOS here signs ad-hoc, with no certificate and no secret involved, so
      // there is nothing for it to protect.
      CSC_FOR_PULL_REQUEST: 'true',
    },
  });
  // electron-builder names the macOS output directory after the architecture:
  // `mac` on Intel, `mac-arm64` on Apple Silicon, `mac-universal` for a fat
  // build. Hardcoding `mac` found nothing on an arm64 runner and reported it as
  // a missing executable, which reads like a broken build rather than a
  // directory this script guessed wrong.
  const macOutDir = () => {
    const hit = readdirSync(temp).find((d) => d === 'mac' || d.startsWith('mac-'));
    return join(temp, hit ?? 'mac');
  };
  unpacked = process.platform === 'win32' ? join(temp, 'win-unpacked')
    : process.platform === 'darwin' ? macOutDir()
    : join(temp, 'linux-unpacked');
}

/**
 * On macOS, a bundle that fails `codesign --verify` is not shippable.
 *
 * Launching proves nothing here. Gatekeeper only evaluates a signature when the
 * file carries a quarantine attribute, which a locally built app does not -- so
 * a completely unsealed bundle starts perfectly well on the machine that built
 * it and dies with "Neuron is damaged and can't be opened" on the machine that
 * downloads it. 0.4.4-beta.2 shipped exactly that: zero _CodeSignature seals
 * anywhere in the bundle, while every launch test passed.
 */
function verifySignature(bundlePath) {
  if (process.platform !== 'darwin') return;
  const app = bundlePath.includes('.app/') ? bundlePath.slice(0, bundlePath.indexOf('.app/') + 4) : bundlePath;
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
      encoding: 'utf-8', stdio: 'pipe', timeout: 120_000,
    });
    console.log('codesign: the bundle verifies');
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim() || error.message;
    console.error(`codesign --verify failed for ${app}\n${detail}`);
    console.error('\nThis build would be rejected on any Mac that downloads it.');
    process.exit(1);
  }
}

const executablePath = findExecutable(unpacked);
if (!executablePath) {
  console.error(`No executable found in ${unpacked}`);
  process.exit(1);
}

verifySignature(executablePath);
console.log('\nlaunching', executablePath);

/**
 * Start the packaged app and attach to its renderer over the DevTools protocol.
 *
 * Not Playwright's `_electron.launch`. That drives the main process through
 * Node's inspector -- it passes `--inspect=0` and waits for "Debugger
 * listening" -- and the packaged app has the nodeCliInspect fuse off, so the
 * inspector never starts and the launch times out. Chromium's own
 * `--remote-debugging-port` is not a Node option and no fuse governs it, and
 * the renderer is all this test inspects.
 */
async function launchPackaged(executable, userDataDir) {
  const args = [`--user-data-dir=${userDataDir}`, '--remote-debugging-port=0'];
  // What `_electron.launch` added on Linux: an unpacked build's chrome-sandbox
  // is not setuid root, and without this Chromium refuses to start.
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error(`no DevTools endpoint within 60 s\n${output}`)), 60_000);
    const read = (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
    };
    child.stdout.setEncoding('utf-8').on('data', read);
    child.stderr.setEncoding('utf-8').on('data', read);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exited with ${code} before it opened a window\n${output}`)); });
  });
  const browser = await chromium.connectOverCDP(endpoint);
  return { child, browser };
}

/** The app's own window: the page loaded from the packaged renderer. */
async function appWindow(browser, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith('file:'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no app window within ${timeout / 1000} s`);
}

/**
 * Quit the app and confirm it is gone, as procs.mjs's shutdown does for
 * Playwright launches.
 *
 * Asked to quit first, killed only if it will not: a killed tree keeps its
 * profile directory locked for a moment after taskkill returns, and removing
 * the throwaway user-data directory then fails with EPERM.
 */
async function stopPackaged({ child, browser }) {
  const exited = new Promise((r) => { if (child.exitCode !== null) r(); else child.once('exit', r); });
  const within = (ms) => Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
  try {
    const cdp = await browser.newBrowserCDPSession();
    // Not awaited: the app quits mid-reply, and the reply never comes.
    cdp.send('Browser.close').catch(() => {});
  } catch { /* the connection is already gone */ }
  if (!(await within(10_000))) {
    killTree(child.pid);
    await within(5000);
  }
  await browser.close().catch(() => {});
  if (isAlive(child.pid)) console.warn(`warning: pid ${child.pid} survived shutdown`);
}

const userData = mkdtempSync(join(tmpdir(), 'neuron-smoke-data-'));
let app;
try {
  app = await launchPackaged(executablePath, userData);
} catch (err) {
  console.error('\nFAILED: the packaged application did not start.\n');
  console.error(err.message);
  process.exit(1);
}

let state;
try {
  // A main-process module error shows as a dialog and no window, so the window
  // appearing is itself most of the assertion. A renderer that fails to load
  // (ERR_FILE_NOT_FOUND inside app.asar, say) shows an error page whose URL is
  // not file:, so it is not mistaken for the app.
  const page = await appWindow(app.browser, 60_000);
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });

  // Wait for the toolbar to mount before inspecting the packaged renderer.
  await page.locator('.titlebar').waitFor({ state: 'visible', timeout: 60_000 });

  // And the renderer must actually have rendered, not just opened a blank frame.
  state = await page.evaluate(() => ({
    title: document.title,
    hasRoot: !!document.querySelector('#root')?.childElementCount,
    hasCustomControls: !!document.querySelector('.titlebar .window-control'),
    hasToolbarLogo: !!document.querySelector('.titlebar .neuron-logo'),
    toolbarHeight: document.querySelector('.titlebar')?.getBoundingClientRect().height,
    overlayVisible: navigator.windowControlsOverlay?.visible ?? false,
    bodyText: (document.body.innerText || '').slice(0, 120),
  }));
} catch (err) {
  console.error('\nFAILED: the packaged application did not render.\n');
  console.error(err.message);
  await stopPackaged(app);
  process.exit(1);
}

// No module-resolution probe here. With the inspector fused off there is no
// way into the main process from outside at all -- and it is not needed:
// main.ts imports every AI provider statically at the top of the file, and
// each pulls in zod. A missing one kills the process before any window is
// created, which is exactly how 0.4.3 failed. A mounted renderer IS the
// assertion that the packaged dependency tree is complete.

console.log('\n  window title      :', state.title);
console.log('  renderer mounted  :', state.hasRoot);
const nativeChrome = !state.hasCustomControls && !state.hasToolbarLogo && state.toolbarHeight === 40
  && (process.platform === 'darwin' || state.overlayVisible);
console.log('  native chrome     :', nativeChrome);

await stopPackaged(app);
rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
if (temp) { try { rmSync(temp, { recursive: true, force: true }); } catch { /* scanner holds it */ } }

const ok = state.hasRoot && nativeChrome;
console.log(ok
  ? '\nsmoke: the packaged application starts and renders\n'
  : '\nsmoke: FAILED -- packaged rendering or native chrome check failed\n');
process.exit(ok ? 0 : 1);
