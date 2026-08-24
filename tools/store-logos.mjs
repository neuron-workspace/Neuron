// Render the Microsoft Store logo set at exact pixel sizes.
//
//   node tools/store-logos.mjs   ->  store-assets/logos/*.png
//
// Electron is the renderer because it is already a dependency and Playwright's
// browsers are deliberately not installed in this repo. Device scale factor is
// forced to 1: the Store checks exact dimensions, and on a scaled Windows
// display a 300x300 window otherwise produces a 450x450 file.
import { _electron as electron } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shutdown } from './procs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'store-assets', 'logos');
mkdirSync(out, { recursive: true });

const fontsDir = join(root, 'docs', 'fonts').replace(/\\/g, '/');
const serif = `file:///${fontsDir}/source-serif-4-400-3.woff2`;
const sans = `file:///${fontsDir}/archivo-600-2.woff2`;

/** The app icon, as markup so it scales to any size without a raster step. */
const MARK = (size) => `
  <svg width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true">
    <g transform="translate(256,256)" fill="#ffffff">
      <polygon points="-24,-136 24,-136 16,6 -16,6" />
      <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(72)" />
      <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(144)" />
      <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(216)" />
      <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(288)" />
    </g>
  </svg>`;

/**
 * One brand surface for every asset: the site's blue, the app's asterisk.
 * `wordmark` is off for the small tiles -- at 150px the name is unreadable and
 * the Store prints it beside the tile anyway.
 */
function page({ width, height, mark, wordmark, tagline }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @font-face { font-family: 'SS'; src: url('${serif}') format('woff2'); font-weight: 400; }
    @font-face { font-family: 'AR'; src: url('${sans}') format('woff2'); font-weight: 600; }
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
    body {
      display: grid;
      place-content: center;
      justify-items: center;
      gap: ${Math.round(height * 0.045)}px;
      background:
        radial-gradient(120% 90% at 18% 12%, #7aa2ff 0%, transparent 55%),
        radial-gradient(90% 80% at 82% 78%, #1230a8 0%, transparent 60%),
        linear-gradient(150deg, #4b78ff 0%, #2b5cf6 45%, #163ec9 100%);
      position: relative;
    }
    /* The wordmark's own motif, faint, so a flat gradient is not the whole idea. */
    body::after {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(255,255,255,.10) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.10) 1px, transparent 1px);
      background-size: ${Math.round(width / 9)}px ${Math.round(width / 9)}px;
      -webkit-mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 72%);
    }
    .mark { position: relative; z-index: 1; display: block; filter: drop-shadow(0 ${Math.round(height * 0.01)}px ${Math.round(height * 0.03)}px rgba(6,20,70,.45)); }
    .word { position: relative; z-index: 1; font-family: SS, Georgia, serif; color: #fff; letter-spacing: -.02em; line-height: 1; }
    .tag { position: relative; z-index: 1; font-family: AR, system-ui, sans-serif; color: rgba(255,255,255,.82); letter-spacing: .16em; text-transform: uppercase; line-height: 1; }
  </style></head><body>
    <span class="mark">${MARK(mark)}</span>
    ${wordmark ? `<div class="word" style="font-size:${wordmark}px">Neuron</div>` : ''}
    ${tagline ? `<div class="tag" style="font-size:${tagline}px">Local-first notes</div>` : ''}
  </body></html>`;
}

// Sizes Partner Center asks for, plus both variants of each so the higher-
// resolution one is available if the listing wants it.
const ASSETS = [
  { file: 'poster-720x1080.png',  width: 720,  height: 1080, mark: 300,  wordmark: 84,  tagline: 20 },
  { file: 'poster-1440x2160.png', width: 1440, height: 2160, mark: 600,  wordmark: 168, tagline: 40 },
  { file: 'box-1080x1080.png',    width: 1080, height: 1080, mark: 420,  wordmark: 112, tagline: 26 },
  { file: 'box-2160x2160.png',    width: 2160, height: 2160, mark: 840,  wordmark: 224, tagline: 52 },
  { file: 'tile-300x300.png',     width: 300,  height: 300,  mark: 168,  wordmark: 0,   tagline: 0 },
  { file: 'tile-150x150.png',     width: 150,  height: 150,  mark: 88,   wordmark: 0,   tagline: 0 },
];

const work = mkdtempSync(join(tmpdir(), 'neuron-logos-'));
// A minimal Electron entry: one frameless window, no menu, nothing else.
writeFileSync(join(work, 'main.js'), `
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(() => {
  // Shown and loading immediately: Playwright attaches to a page, and a hidden
  // window with nothing loaded never becomes one.
  const win = new BrowserWindow({ width: 400, height: 400, frame: false, useContentSize: true });
  win.setMenu(null);
  win.loadURL('data:text/html,<html><body></body></html>');
});
`);

const electronApp = await electron.launch({
  args: [join(work, 'main.js'), '--force-device-scale-factor=1'],
  cwd: root,
});
const page_ = await electronApp.firstWindow();

for (const asset of ASSETS) {
  const html = page(asset);
  const file = join(work, asset.file.replace('.png', '.html'));
  writeFileSync(file, html);

  await electronApp.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(size.width, size.height);
  }, asset);

  await page_.goto('file:///' + file.replace(/\\/g, '/'));
  // Give the embedded fonts a moment; a fallback face would change the metrics.
  await page_.evaluate(() => document.fonts.ready);
  await page_.waitForTimeout(250);

  const target = join(out, asset.file);
  await page_.screenshot({ path: target, clip: { x: 0, y: 0, width: asset.width, height: asset.height } });

  // Verify, do not assume: the Store rejects a file whose dimensions are off,
  // and a scaled display is exactly how that happens silently.
  const buf = readFileSync(target);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const ok = w === asset.width && h === asset.height;
  console.log(`  ${ok ? 'ok' : 'XX'}  ${asset.file.padEnd(24)} ${w}x${h}${ok ? '' : `  (wanted ${asset.width}x${asset.height})`}`);
  if (!ok) process.exitCode = 1;
}

await shutdown(electronApp);
rmSync(work, { recursive: true, force: true });
console.log(`\nwrote ${ASSETS.length} logos to store-assets/logos/`);
process.exit(process.exitCode ?? 0);
