// Run: node tools/settings-window.test.mjs
// P0-8: the Settings window is where the recovery key and pairing codes will be
// shown, so no plugin may run there (plugins in the renderer can read the DOM,
// risk R3). This pins today's behaviour: the Settings window hosts the plugin
// provider with no workspace, and with no workspace no plugin is activated --
// not by default, not by a settings change, not by switching one on.
//
// The real PluginProvider (src/renderer/plugins/host.tsx) is rendered with
// react-dom on a linkedom document, with spy plugins that count activations.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

const root = process.cwd();
let checks = 0;

// --- 1. The Settings window gives the plugin host no workspace -----------------
const app = readFileSync(path.join(root, 'src/renderer/App.tsx'), 'utf8');
const start = app.indexOf('if (utilityWindow) {');
assert.ok(start > 0, 'App.tsx still renders the Settings window from its utilityWindow branch');
const settingsBranch = app.slice(start, app.indexOf('\n  }\n', start));
assert.match(app, /const utilityWindow = useMemo\(\(\) => \(new URLSearchParams\(window\.location\.search\)\.get\('window'\) === 'settings' \? 'settings' : null\), \[\]\);/);
const providers = [...settingsBranch.matchAll(/<PluginProvider\b([^>]*)>/g)].map((m) => m[1]);
assert.equal(providers.length, 1, 'one plugin host in the Settings window');
assert.match(providers[0], /\bworkspace=\{null\}/, 'the Settings window plugin host has no workspace');
assert.doesNotMatch(settingsBranch, /activatePlugins|registerPanel|mdxComponents|\.render\(/, 'nothing in the Settings branch runs plugin code directly');
checks += 4;
// Plugins are activated in one place only, and only by the provider.
const sites = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name)) {
      const text = readFileSync(full, 'utf8');
      if (/\bactivatePlugins\(/.test(text)) sites.push(path.relative(root, full).replace(/\\/g, '/'));
      if (/\.activate\(/.test(text)) sites.push(`${path.relative(root, full).replace(/\\/g, '/')} (.activate)`);
    }
  }
};
walk(path.join(root, 'src/renderer'));
assert.deepEqual(sites.sort(), ['src/renderer/plugins/activate.ts', 'src/renderer/plugins/activate.ts (.activate)', 'src/renderer/plugins/host.tsx'].sort(),
  'activatePlugins is defined in activate.ts and called only by the plugin host');
checks++;

// --- 2. With no workspace, the real provider activates nothing ----------------------
const { window, document } = parseHTML('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const writes = [];
const listeners = [];
window.electronAPI = {
  platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
  settings: {
    get: async () => null,
    set: async (key, value) => { writes.push([key, value]); return { success: true }; },
    hasSecret: async () => false,
    setSecret: async () => ({ success: true }),
    onChanged: (fn) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
  },
  ai: {}, net: {}, terminal: {},
};

const outfile = path.join(root, 'tools/.settings-window.tmp.cjs');
await build({ stdin: { contents: `export { PluginProvider, usePlugins } from './src/renderer/plugins/host';`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', outfile, logLevel: 'silent' });
let PluginProvider, usePlugins;
try { ({ PluginProvider, usePlugins } = createRequire(import.meta.url)(outfile)); } finally { rmSync(outfile, { force: true }); }
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

const activations = [];
// The built-in ids, including the three on by default in every workspace.
const ids = ['version-history', 'graph', 'terminal', 'automations', 'daily-calendar', 'ai-claude'];
const catalog = ids.map((id) => ({
  manifest: { id, name: id, version: '1.0.0', description: id, category: 'editor' },
  activate: (host) => { activations.push(id); host.registerPanel({ id: `${id}.panel`, title: id, render: () => null }); return () => {}; },
}));
const bridge = { activeNote: null, noteContent: '', notes: [], notesData: [], openNote: () => {}, createNote: async () => true, refreshNotes: async () => {} };
let context = null;
function Probe() { context = usePlugins(); return null; }

async function mount(workspace) {
  activations.length = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => { rootNode.render(React.createElement(PluginProvider, { catalog, bridge, workspace }, React.createElement(Probe))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return rootNode;
}

{
  // The Settings window: workspace null, as App.tsx passes it.
  const settingsRoot = await mount(null);
  assert.equal(context.ready, true, 'the provider has settled');
  assert.deepEqual(activations, [], 'no plugin activates in a window with no workspace');
  assert.deepEqual(context.panels, []);
  assert.deepEqual(context.commands, []);
  assert.deepEqual(context.mdxComponents, {});
  // A settings change broadcast from another window, and an attempt to switch one on, change nothing.
  await act(async () => { for (const fn of [...listeners]) fn('plugins:/anything'); await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { context.setEnabled('graph', true); await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(activations, [], 'still nothing after a broadcast or setEnabled');
  assert.equal(context.isEnabled('graph'), false);
  assert.ok(!writes.some(([key]) => key.startsWith('plugins:')), 'no per-workspace plugin record is written from Settings');
  await act(async () => settingsRoot.unmount());
  checks += 8;
}

{
  // Contrast, so the check above cannot pass by never activating anything: a
  // workspace window starts its default plugins.
  const workspaceRoot = await mount(process.platform === 'win32' ? 'C:\\Notes' : '/home/me/Notes');
  assert.deepEqual(activations.sort(), ['graph', 'terminal', 'version-history'], 'a workspace window activates its default plugins');
  assert.equal(context.panels.length, 3);
  await act(async () => workspaceRoot.unmount());
  checks += 2;
}

console.log(`settings-window: ${checks} checks; the Settings window hosts plugins with no workspace and activates none (workspace windows do)`);
