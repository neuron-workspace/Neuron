// Run: node tools/settings-schema.test.mjs
// P0-2: what the renderer may write through settings:set, key by key. Every key
// the app writes accepts what the app really writes (built by the app's own
// functions where it has them) and refuses a wrong type, an oversize value and
// prototype names inside objects; unknown keys and main-only keys are refused.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await build({ stdin: { contents: `
  export * from './src/main/settings-schema';
  export { DEFAULT_LAYOUT, SEED_LAYOUTS, movePanel, resolveSavedLayouts } from './src/renderer/lib/layout';
  export { DEFAULT_APPEARANCE, normalizeAppearance } from './src/renderer/lib/theme';
  export { DEFAULT_BINDINGS, resolveBindings } from './src/renderer/lib/keybindings';
  export { serializeGroups } from './src/renderer/lib/tabs';
  export { addRecent, recentsKey } from './src/renderer/lib/workspace-explorer';
  export { GRAPH_DEFAULTS, graphPreferences } from './src/renderer/lib/knowledge-graph';
  export { knownWorkspaceKeys, migrateConnectorValues, resolveWorkspacePlugins, workspacePluginsKey } from './src/renderer/plugins/connectors';
`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const { checkRendererSetting: check, SETTINGS_RULES, SETTINGS_PREFIX_RULES, MAIN_ONLY_SETTINGS_KEYS } = m;

let checks = 0;
const accepts = (key, value, why = '') => {
  assert.deepEqual(check(key, value), { ok: true }, `${key} accepts ${why || JSON.stringify(value)?.slice(0, 160)}`);
  checks++;
};
const refuses = (key, value, pattern, why = '') => {
  const verdict = check(key, value);
  assert.equal(verdict.ok, false, `${key} refuses ${why || JSON.stringify(value)?.slice(0, 160)}`);
  if (pattern) assert.match(verdict.error, pattern, `${key}: ${verdict.error}`);
  checks++;
  return verdict.error;
};

// --- What the app writes, key by key -----------------------------------------
const WS = process.platform === 'win32' ? 'C:\\Users\\me\\Notes' : '/home/me/Notes';
const panels = [{ pluginId: 'terminal', view: { id: 'terminal.panel', location: 'bottom' } }, { pluginId: 'graph', view: { id: 'graph.panel' } }];
const moved = m.movePanel(panels, m.DEFAULT_LAYOUT, 'graph:graph.panel', 'left');
const groups = m.serializeGroups({
  groups: [{ tabs: ['a.md', 'b.md', 'https://example.com'], preview: null, selected: 'a.md' }, { tabs: ['c.md'], preview: 'c.md', selected: 'c.md' }],
  direction: 'row', focused: 1,
}, [40, 60]);
const pluginsKey = m.workspacePluginsKey(WS, process.platform);
const workspacePlugins = m.resolveWorkspacePlugins(null, null, null, pluginsKey.slice('plugins:'.length), ['version-history', 'graph', 'terminal']);
const manifests = [
  { id: 'ai-claude', connector: { id: 'anthropic' }, configSchema: [{ key: 'apiKey', type: 'password' }, { key: 'model', type: 'text' }] },
  { id: 'ai-local', connector: { id: 'local' }, configSchema: [{ key: 'endpoint', type: 'url' }, { key: 'model', type: 'text' }] },
];
const connectorValues = m.migrateConnectorValues({ 'ai-claude': { apiKey: 'sk-x', model: 'claude-test' }, 'ai-local': { endpoint: 'http://localhost:11434', model: 'llama' } }, manifests).values;
const positions = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`folder ${i % 50}/a fairly long note name ${i}.md`, { x: Math.random() * 1e4 - 5e3, y: Math.random() * 1e4 - 5e3 }]));

/** [key, realistic values, a value of the wrong type]. Every rule appears here. */
const samples = [
  ['layout', [m.DEFAULT_LAYOUT, moved, { ...m.DEFAULT_LAYOUT, zen: true, sidebar: false }], { ...m.DEFAULT_LAYOUT, sidebarSide: 'top' }],
  ['properties', [{ removeEmpty: true, showInReading: true, collapsedByDefault: false }], { removeEmpty: 'yes' }],
  ['savedLayouts', [m.SEED_LAYOUTS, m.resolveSavedLayouts([...m.SEED_LAYOUTS, { id: 'layout-' + Date.now().toString(36), name: 'Mine', layout: moved }]), []], m.SEED_LAYOUTS.map((l) => ({ ...l, layout: 'default' }))],
  ['activeLayoutId', ['seed-writing', 'layout-' + Date.now().toString(36), null], 42],
  ['appearance', [m.DEFAULT_APPEARANCE, m.normalizeAppearance({ preset: 'nord', markdownOverrides: { heading: '#FF0000', link: '#00ff00' } }), { preset: 'void', markdownOverrides: {} }], { preset: 'nord', markdownOverrides: { heading: 'red' } }],
  ['keybindings', [m.DEFAULT_BINDINGS, m.resolveBindings({ palette: 'mod+shift+p' })], { palette: 7 }],
  ['editorSplit', [null, 'beta.md'], { note: 'beta.md' }],
  ['explorerView', ['list', 'grid'], 'tiles'],
  ['automations', [[], [{ id: `${Date.now()}`, name: 'Build', commands: ['npm run build', 'npm test'] }]], [{ id: '1', name: 'Build', commands: 'npm test' }]],
  ['connectors', [connectorValues, {}, { anthropic: { model: 'claude-test' } }], { anthropic: { model: 42 } }],
  ['pluginsLegacyWorkspaces', [m.knownWorkspaceKeys({ current: WS, recent: [WS, WS + '-old'] }, process.platform), []], WS],
  [pluginsKey, [workspacePlugins, { ...workspacePlugins, config: { 'daily-calendar': { folder: 'Daily' } } }, { enabled: { graph: false }, config: {} }], { enabled: { graph: 'on' }, config: {} }],
  ['pluginstore:version-history:state', [{ open: true, list: [1, 'two', null] }, 'text', 3, false, null, []], undefined],
  [m.recentsKey(WS), [m.addRecent(m.addRecent([], { path: 'notes/a.md', kind: 'file' }), { path: 'notes', kind: 'folder' }), []], [{ path: 'a.md', kind: 'link' }]],
  ['explorer.folders:' + WS, [['empty', 'a/b'], []], 'empty'],
  ['editorGroups:' + WS, [groups, m.serializeGroups({ groups: [{ tabs: [], preview: null, selected: null }], direction: 'column', focused: 0 })], { ...groups, direction: 'diagonal' }],
  ['graph:v1:' + WS, [{ preferences: m.graphPreferences({ repel: 5, arrows: true }), positions: {} }, { preferences: m.GRAPH_DEFAULTS, positions }], { preferences: m.GRAPH_DEFAULTS, positions: { 'a.md': { x: 'left', y: 0 } } }],
  ['graph:v1:', [{ preferences: m.GRAPH_DEFAULTS, positions: {} }], 'graph'],
];

const covered = new Set();
const ruleOf = (key) => (Object.hasOwn(SETTINGS_RULES, key) ? key : Object.keys(SETTINGS_PREFIX_RULES).find((prefix) => key.startsWith(prefix)));
const limitOf = (key) => (SETTINGS_RULES[key] ?? SETTINGS_PREFIX_RULES[ruleOf(key)]).maxBytes;
/** The same value with a prototype name planted as deep as it goes. */
function plant(value, name) {
  const copy = structuredClone(value);
  const bad = JSON.parse(`{"${name}": {"polluted": true}}`); // an own property, as IPC would deliver it
  const deepest = (node) => {
    if (Array.isArray(node)) { const inner = node.find((item) => item && typeof item === 'object'); return inner ? deepest(inner) : node; }
    const inner = Object.values(node).find((item) => item && typeof item === 'object');
    return inner ? deepest(inner) : node;
  };
  if (!copy || typeof copy !== 'object') return { value: copy, ...bad };
  const target = deepest(copy);
  if (Array.isArray(target)) target.push(bad);
  else Object.defineProperty(target, name, { value: { polluted: true }, enumerable: true, configurable: true, writable: true });
  return copy;
}

for (const [key, values, wrong] of samples) {
  covered.add(ruleOf(key));
  for (const value of values) accepts(key, value);
  // Values cross IPC by structured clone; a copy must pass as the original does.
  accepts(key, structuredClone(values[0]), 'a structured clone');
  if (wrong !== undefined) {
    refuses(key, wrong, new RegExp(`^Invalid value for settings key "${key.slice(0, 40).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`), 'the wrong type');
  }
  refuses(key, undefined, /no value/);
  // Over its cap: refused by size, whatever it holds.
  const limit = limitOf(key);
  refuses(key, 'x'.repeat(limit), /limit/, `${limit + 2} bytes`);
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    refuses(key, plant(values.find((v) => v && typeof v === 'object') ?? values[0], name), new RegExp(`"${name}" cannot be used`), `"${name}" inside`);
  }
  refuses(key, { nested: new Date() }, null, 'a class instance');
}
assert.deepEqual([...covered].sort(), [...Object.keys(SETTINGS_RULES), ...Object.keys(SETTINGS_PREFIX_RULES)].sort(), 'every rule has realistic samples here');
// Shapes are checked, not only types.
refuses('layout', { ...m.DEFAULT_LAYOUT, injected: true }, /unknown member "injected"/);
refuses('properties', { removeEmpty: true, extra: 1 }, /unknown member/);
refuses(pluginsKey, { enabled: {}, config: {}, sync: { path: '/x' } }, /unknown member "sync"/);
refuses('savedLayouts', Array.from({ length: 21 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, layout: m.DEFAULT_LAYOUT })), /more than 20/);
refuses('savedLayouts', [{ id: 'x', name: 'n'.repeat(41), layout: m.DEFAULT_LAYOUT }], /longer than 40/);
refuses('appearance', { preset: 'nord', markdownOverrides: { heading: 'url(javascript:x)' } }, /#rrggbb/);
refuses('editorGroups:' + WS, { ...groups, focused: -1 }, /whole number/);
// Cycles and symbols never reach JSON.stringify.
const cyclic = { a: {} }; cyclic.a.self = cyclic;
refuses('pluginstore:p:k', cyclic, /refers to itself/, 'a cycle');
refuses('pluginstore:p:k', { [Symbol('s')]: 1 }, /symbol/, 'a symbol key');
refuses('pluginstore:p:k', Object.create({ inherited: true }), /plain objects/, 'a non-plain object');
let deep = {}; for (let i = 0; i < 40; i++) deep = { deep };
refuses('pluginstore:p:k', deep, /too deeply/, '40 levels');
// A plugin-owned value: anything plain, up to 64 KB and not a byte more.
accepts('pluginstore:p:k', 'x'.repeat(64 * 1024 - 2), 'exactly 64 KB of JSON');
refuses('pluginstore:p:k', 'x'.repeat(64 * 1024 - 1), /65537 bytes is over the 65536-byte limit/);
refuses('pluginstore:p:k', 'é'.repeat(32 * 1024), /limit/, 'counted in UTF-8 bytes');
refuses(pluginsKey, { enabled: {}, config: { big: { text: 'x'.repeat(4096) } }, more: 'x'.repeat(64 * 1024) }, /limit/);
// The 20 000-note graph fits under its own cap, which is not the plugin cap.
assert.ok(JSON.stringify({ preferences: m.GRAPH_DEFAULTS, positions }).length > 64 * 1024, 'the big graph sample is a real test of the graph cap');

// --- Keys ----------------------------------------------------------------------
for (const key of ['example', 'test', 'plugins', 'toString', 'hasOwnProperty', '', 'LAYOUT', 'layout ', 'pluginstore:', 'pluginstore:p', 'pluginstore::k',
  'pluginstore:../x:k', 'plugins:', 'editorGroups:', 'explorer.folders:', 'explorer.recents:', 'graph:v2:' + WS, 'plugins:' + 'x'.repeat(5000)]) {
  assert.deepEqual(check(key, {}), { ok: false, error: 'Unknown settings key.' }, JSON.stringify(key)); checks++;
}
for (const key of [null, undefined, 42, {}, ['layout']]) {
  assert.deepEqual(check(key, {}), { ok: false, error: 'Unknown settings key.' }); checks++;
}
// Main-only: sync (reserved before anything writes it), and the keys main owns today.
assert.deepEqual([...MAIN_ONLY_SETTINGS_KEYS].sort(), ['__secrets', 'connectorSecretsMigrated', 'htmxViewApprovals', 'repositories', 'seededDemo', 'sync']);
for (const key of MAIN_ONLY_SETTINGS_KEYS) {
  for (const value of [{}, null, { provider: 'folder', path: '/elsewhere' }, true]) {
    assert.deepEqual(check(key, value), { ok: false, error: 'Reserved key.' }, key); checks++;
  }
}
assert.ok(!Object.hasOwn(SETTINGS_RULES, 'sync') && !Object.keys(SETTINGS_PREFIX_RULES).some((p) => 'sync'.startsWith(p)), 'nothing in the table can admit sync');

// --- Every renderer write site has a rule ---------------------------------------
// A new settings.set( call fails here until its key is in the table and below.
const writeSites = {
  "'layout'": 'layout', "'properties'": 'properties', "'savedLayouts'": 'savedLayouts', "'activeLayoutId'": 'activeLayoutId',
  "'appearance'": 'appearance', 'recentsKey(repository.path)': m.recentsKey(WS), "'explorer.folders:' + repository.path": 'explorer.folders:' + WS,
  "'editorSplit'": 'editorSplit', 'GROUPS_KEY + workspace': 'editorGroups:' + WS, "'keybindings'": 'keybindings',
  STORE_KEY: 'automations', key: 'graph:v1:' + WS, LEGACY_WORKSPACES_KEY: 'pluginsLegacyWorkspaces', storageKey: pluginsKey,
  CONNECTORS_KEY: 'connectors', '`pluginstore:${pluginId}:${key}`': 'pluginstore:version-history:state', "'explorerView'": 'explorerView',
};
const found = new Set();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      for (const match of readFileSync(full, 'utf8').matchAll(/settings\.set\(\s*([^,]+?)\s*,/g)) found.add(match[1]);
    }
  }
};
walk(path.join(root, 'src', 'renderer'));
assert.deepEqual([...found].sort(), Object.keys(writeSites).sort(), 'every settings.set( call site in the renderer is listed here');
for (const key of Object.values(writeSites)) assert.ok(ruleOf(key), `${key} has a rule`);
// The constants behind those names are the keys the table expects.
const host = readFileSync(path.join(root, 'src/renderer/plugins/host.tsx'), 'utf8');
assert.match(host, /const LEGACY_WORKSPACES_KEY = 'pluginsLegacyWorkspaces';/);
assert.match(host, /const CONNECTORS_KEY = 'connectors';/);
assert.match(readFileSync(path.join(root, 'src/renderer/App.tsx'), 'utf8'), /const GROUPS_KEY = 'editorGroups:';/);
assert.match(readFileSync(path.join(root, 'src/renderer/components/Automations.tsx'), 'utf8'), /const STORE_KEY = 'automations';/);
assert.match(readFileSync(path.join(root, 'src/renderer/components/SigmaGraph.tsx'), 'utf8'), /const storageKey = `graph:v1:\$\{repo \?\? ''\}`;/);
// And main refuses through this table, after its own reserved-key and apiKey checks.
const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
const handler = main.slice(main.indexOf("ipcMain.handle('settings:set',"), main.indexOf("ipcMain.handle('settings:set-secret'"));
assert.ok(handler.indexOf('checkRendererSetting(key, value)') > handler.indexOf('carriesApiKey(value)'), 'settings:set consults the table');
assert.ok(handler.indexOf('checkRendererSetting(key, value)') < handler.indexOf('readSettings()'), 'before anything is read or written');

console.log(`settings-schema: ${checks} checks; ${samples.length} keys accept what the app writes and refuse wrong types, oversize values and prototype names; unknown and main-only keys refused`);
