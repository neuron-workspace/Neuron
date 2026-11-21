// Run: node tools/platform-chrome.test.mjs
//
// Native chrome on every platform, without launching Electron.
// Evaluate the constructor options with host stubs so every platform is covered.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

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

const strip = (code, module = ts.ModuleKind.None) =>
  ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module } }).outputText;

/** The real window:set-overlay-colors handler, run on one platform against a recording window. */
function overlayHandler(platform) {
  const start = main.indexOf("ipcMain.handle('window:set-overlay-colors'");
  assert.notEqual(start, -1, 'main.ts registers window:set-overlay-colors');
  const call = 'ipcMain.handle' + balanced(main, main.indexOf('(', start), '(', ')') + ';';
  const recordStart = main.search(/const isRecord\b/);
  assert.notEqual(recordStart, -1, 'main.ts declares isRecord');
  const record = main.slice(recordStart, main.indexOf(';\n', recordStart) + 1);
  const calls = [];
  let handler;
  // Copied out of the vm's realm, so deepEqual compares plain values.
  const window = { setTitleBarOverlay: (colors) => calls.push(JSON.parse(JSON.stringify(colors))) };
  runInNewContext(strip(record + '\n' + call), {
    process: { platform }, Object, Array,
    ipcMain: { handle: (_name, fn) => { handler = fn; } },
    windowOf: (event) => event.window,
  });
  return { calls, set: (colors, from = window) => handler({ window: from }, colors) };
}

/** menu.ts with Electron stubbed: buildFromTemplate hands the template back. */
function menuModule(platform) {
  const installed = [];
  const exports = {};
  const electron = {
    app: { name: 'Neuron', getPath: () => '' },
    shell: { openPath: () => {}, openExternal: () => {} },
    Menu: { buildFromTemplate: (template) => template, setApplicationMenu: (menu) => installed.push(menu) },
  };
  runInNewContext(strip(read('src', 'main', 'menu.ts'), ts.ModuleKind.CommonJS), {
    exports, module: { exports }, process: { platform },
    require: (name) => { assert.equal(name, 'electron'); return electron; },
  });
  return { ...exports, installed };
}
const menuItems = (items) => items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? menuItems(item.submenu) : [])]);

/** keybindings.ts as macOS sees it. */
async function macBindings() {
  const source = read('src', 'renderer', 'lib', 'keybindings.ts').replace(/import \{ isMac \} from '\.\/platform';/, 'const isMac = true;');
  return import('data:text/javascript;base64,' + Buffer.from(strip(source, ts.ModuleKind.ESNext)).toString('base64'));
}
/** "Command+Shift+K" → "mod+shift+k", the renderer's chord form. */
const acceleratorChord = (accelerator) => accelerator.split('+').map((part) => {
  if (/^(Command|Cmd|CommandOrControl|CmdOrCtrl)$/.test(part)) return 'mod';
  if (/^(Alt|Option)$/.test(part)) return 'alt';
  return part.toLowerCase();
}).join('+');

const tests = [
  ['window:set-overlay-colors recolours only on Windows and Linux', () => {
    for (const platform of ['win32', 'linux']) {
      const { calls, set } = overlayHandler(platform);
      set({ color: '#1A2b3c', symbolColor: '#ffffff' });
      assert.deepEqual(calls, [{ color: '#1A2b3c', symbolColor: '#ffffff' }], platform);
    }
    const { calls, set } = overlayHandler('darwin');
    set({ color: '#1a2b3c', symbolColor: '#ffffff' });
    assert.deepEqual(calls, [], 'macOS has no overlay to recolour');
  }],
  ['window:set-overlay-colors takes only #rrggbb from a known window', () => {
    const { calls, set } = overlayHandler('win32');
    for (const colors of [
      null, undefined, 'x', [], { color: '#fff', symbolColor: '#000000' }, { color: '#ffffff', symbolColor: '#000' },
      { color: 'red', symbolColor: '#000000' }, { color: '#ffffff' }, { symbolColor: '#000000' },
      { color: '#ffffff00', symbolColor: '#000000' }, { color: 'ffffff', symbolColor: '#000000' },
      { color: '#ffffff;', symbolColor: '#000000' }, { color: '#gggggg', symbolColor: '#000000' },
      { color: ' #ffffff', symbolColor: '#000000' }, { color: '#ffffff\n', symbolColor: '#000000' },
      { color: 0xffffff, symbolColor: '#000000' }, { color: ['#ffffff'], symbolColor: '#000000' },
      { color: 'rgb(0,0,0)', symbolColor: '#000000' },
    ]) set(colors);
    set({ color: '#ffffff', symbolColor: '#000000' }, null);
    assert.deepEqual(calls, [], 'nothing invalid reaches setTitleBarOverlay');
  }],
  ['macOS menu: renderer chords are shown, not registered', async () => {
    const { buildMacApplicationMenu } = menuModule('darwin');
    const sent = [];
    const window = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
    const items = menuItems(buildMacApplicationMenu(() => window));
    const { DEFAULT_BINDINGS } = await macBindings();
    // Every default the renderer dispatches, plus Find, which is CodeMirror's.
    const rendererChords = new Set([...Object.values(DEFAULT_BINDINGS), 'mod+f']);
    const withShortcut = items.filter((item) => item.accelerator);
    assert.ok(withShortcut.length >= 3, 'the menu shows app shortcuts');
    for (const item of withShortcut) {
      const chord = acceleratorChord(item.accelerator);
      if (rendererChords.has(chord)) {
        assert.equal(item.registerAccelerator, false, `${item.label} (${item.accelerator}) is the renderer's; the menu must not take it`);
      } else {
        assert.notEqual(item.registerAccelerator, false, `${item.label}: nothing else handles ${item.accelerator}, so the menu does`);
      }
    }
    const find = items.find((item) => item.label === 'Find…');
    const search = items.find((item) => item.label === 'Search & Commands…');
    assert.equal(acceleratorChord(find.accelerator), 'mod+f');
    assert.equal(acceleratorChord(search.accelerator), DEFAULT_BINDINGS.palette, 'the label shows the real palette shortcut');
    const settings = items.find((item) => item.label === 'Settings…');
    assert.equal(acceleratorChord(settings.accelerator), 'mod+,');
    // Clicking still works, through the command channel.
    find.click(); search.click(); settings.click();
    assert.deepEqual(sent, [['menu:command', 'find'], ['menu:command', 'palette'], ['menu:command', 'settings']]);
  }],
  ['macOS menu keeps the native roles', () => {
    const { buildMacApplicationMenu } = menuModule('darwin');
    const roles = new Set(menuItems(buildMacApplicationMenu(() => null)).map((item) => item.role).filter(Boolean));
    for (const role of ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit', 'undo', 'redo', 'cut', 'copy', 'paste',
      'pasteAndMatchStyle', 'delete', 'selectAll', 'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut',
      'togglefullscreen', 'minimize', 'zoom', 'close', 'front', 'help']) {
      assert.ok(roles.has(role), `missing native role ${role}`);
    }
  }],
  ['the application menu is macOS only', () => {
    for (const platform of ['win32', 'linux']) {
      const { installApplicationMenu, installed } = menuModule(platform);
      installApplicationMenu(() => null);
      assert.deepEqual(installed, [null], `${platform}: no menu bar, the title bar is the menu`);
    }
    const { installApplicationMenu, installed } = menuModule('darwin');
    installApplicationMenu(() => null);
    assert.ok(Array.isArray(installed[0]) && installed[0].length > 0, 'macOS installs the real menu');
  }],
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
      assert.equal(actual.backgroundColor, '#f3f4f6', platform);
      assert.equal(actual.titleBarOverlay.height, 39, platform);
      assert.equal(actual.titleBarOverlay.color, '#f3f4f6', platform);
      assert.equal(actual.titleBarOverlay.symbolColor, '#171a1f', platform);
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
    await test();
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
