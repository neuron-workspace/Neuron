// Run: node tools/platform-chrome.test.mjs
//
// Native chrome on every platform, without launching Electron.
// Evaluate the constructor options with host stubs so every platform is covered.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(root, ...parts), 'utf-8');

const main = read('src', 'main', 'main.ts');
const css = read('src', 'renderer', 'index.css');
const preload = read('src', 'main', 'preload.ts');
const declarations = read('src', 'renderer', 'electron.d.ts');

/** Return a balanced source fragment, ignoring delimiters in strings/comments. */
function balanced(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === open) depth++;
    if (char === close && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unbalanced ${open}${close} fragment`);
}

function browserWindowOptions(source) {
  const call = source.indexOf('new BrowserWindow');
  assert.notEqual(call, -1, 'src/main/main.ts must construct a BrowserWindow');
  const paren = source.indexOf('(', call);
  const argument = balanced(source, paren, '(', ')').slice(1, -1).trim();
  if (argument.startsWith('{')) return balanced(argument, 0, '{', '}');

  const name = argument.match(/^[$A-Z_a-z][$\w]*/)?.[0];
  assert.ok(name, 'BrowserWindow options must be statically traceable');
  const declaration = new RegExp(`(?:const|let)\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*\\{`).exec(source);
  assert.ok(declaration, `Could not find the ${name} BrowserWindow options object`);
  return balanced(source, source.indexOf('{', declaration.index), '{', '}');
}

const options = browserWindowOptions(main);
function windowOptions(platform, testInBackground = false) {
  return runInNewContext('(' + options.replace(/\bas const\b/g, '') + ')', {
    process: { platform }, iconPath: '', fs: { existsSync: () => false },
    path: { join: () => '' }, __dirname: '', testInBackground,
  });
}

const tests = [
  ['e2e background mode is off-screen and unthrottled, and nothing else', () => {
    const normal = windowOptions('win32');
    assert.equal(normal.x, undefined, 'a normal launch is placed by the OS');
    assert.equal(normal.show, undefined, 'a normal launch shows its window');
    const background = windowOptions('win32', true);
    assert.ok(background.x < -10000 && background.y < -10000, 'placed off-screen');
    assert.equal(background.show, false, 'shown later, without focus');
    assert.equal(background.webPreferences.backgroundThrottling, false, 'still renders while unseen');
    assert.match(main, /testInBackground = !app\.isPackaged &&/, 'never available to an installed build');
  }],
  ['Windows and Linux use native frame and Window Controls Overlay', () => {
    for (const platform of ['win32', 'linux']) {
      const actual = windowOptions(platform);
      assert.notEqual(actual.frame, false, platform + ': keep the native frame');
      assert.equal(actual.titleBarStyle, 'hidden', platform);
      assert.equal(actual.titleBarOverlay.height, 39, platform);
      assert.equal(actual.titleBarOverlay.color, '#121419', platform);
      assert.equal(actual.titleBarOverlay.symbolColor, '#e6e8ec', platform);
      assert.equal(actual.trafficLightPosition, undefined, platform);
    }
  }],
  ['macOS keeps hiddenInset and its native traffic lights', () => {
    const actual = windowOptions('darwin');
    assert.notEqual(actual.frame, false);
    assert.equal(actual.titleBarStyle, 'hiddenInset');
    assert.equal(actual.titleBarOverlay, undefined);
    assert.equal(actual.trafficLightPosition.x, 18);
    assert.equal(actual.trafficLightPosition.y, 13);
  }],
  ['custom controls and maximized insets are gone', () => {
    const titlebar = read('src', 'renderer', 'components', 'TitleBar.tsx');
    assert.doesNotMatch(main, /needsMaximizeInset|window:toggle-maximize|window:minimize|window:close/);
    assert.doesNotMatch(css, /window-maximized|\.window-control/);
    assert.doesNotMatch(titlebar, /usesCustomWindowControls|window-control|SparkIcon|neuron-logo/);
    assert.doesNotMatch(declarations, /inset: boolean/);
  }],
  ['preload exposes process.platform', () => {
    assert.match(
      preload,
      /\bplatform\s*:\s*process\.platform\b/,
      'electronAPI must expose process.platform as a value',
    );
  }],
  ['renderer ElectronAPI declares platform', () => {
    const interfaceStart = declarations.search(/\binterface\s+ElectronAPI\s*\{/);
    assert.notEqual(interfaceStart, -1, 'electron.d.ts must declare ElectronAPI');
    const bodyStart = declarations.indexOf('{', interfaceStart);
    const electronApi = balanced(declarations, bodyStart, '{', '}');
    assert.match(electronApi, /\bplatform\s*:\s*[^;{}]+;/, 'ElectronAPI must declare its platform value');
  }],
];

let failures = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}\n  ${error.message}`);
  }
}

if (failures) {
  console.error(`platform chrome: ${failures} of ${tests.length} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`platform chrome: all ${tests.length} checks passed`);
}
