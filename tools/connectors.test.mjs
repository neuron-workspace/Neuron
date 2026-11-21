// Run: node tools/connectors.test.mjs
//
// Global connectors and per-workspace plugins: the workspace key, the
// enabled-state migration, the connector config migration and status.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/plugins/connectors.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const {
  connectorsOf, connectorStatus, workspaceKey, workspacePluginsKey, knownWorkspaceKeys, resolveWorkspacePlugins, migrateConnectorValues,
} = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

// --- The per-workspace key: one per folder, however it is spelled ---------
assert.equal(workspaceKey('C:\\Notes\\Work\\', 'win32'), 'c:\\notes\\work');
assert.equal(workspaceKey('c:/notes/work', 'win32'), 'c:\\notes\\work');
assert.equal(workspaceKey('C:\\Notes\\.\\Old\\..\\Work', 'win32'), 'c:\\notes\\work');
assert.equal(workspaceKey('\\\\server\\share\\Notes', 'win32'), '\\\\server\\share\\notes');
assert.equal(workspaceKey('/Users/Ada/Notes/', 'darwin'), '/users/ada/notes');
// Linux file systems are case-sensitive: two folders, two keys.
assert.equal(workspaceKey('/home/ada/Notes//', 'linux'), '/home/ada/Notes');
assert.notEqual(workspaceKey('/home/ada/Notes', 'linux'), workspaceKey('/home/ada/notes', 'linux'));
assert.equal(workspacePluginsKey('C:\\Notes', 'win32'), 'plugins:c:\\notes');
assert.deepEqual(knownWorkspaceKeys({ current: 'C:\\Notes', recent: ['c:\\notes\\', 'D:\\Work'] }, 'win32'), ['c:\\notes', 'd:\\work']);
assert.deepEqual(knownWorkspaceKeys(null, 'win32'), []);

// --- Enabled state: the old global set, once, for workspaces that existed --
const defaults = ['version-history', 'graph', 'terminal'];
const legacy = { enabled: { 'ai-claude': true, terminal: false, 'daily-calendar': true }, config: {} };
const existing = resolveWorkspacePlugins(null, legacy, ['c:\\notes'], 'c:\\notes', defaults);
assert.deepEqual(existing.enabled, { 'ai-claude': true, terminal: false, 'daily-calendar': true, 'version-history': true, graph: true },
  'an existing workspace keeps what was on, and what was switched off stays off');
const fresh = resolveWorkspacePlugins(null, legacy, ['c:\\notes'], 'd:\\new', defaults);
assert.deepEqual(fresh.enabled, { 'version-history': true, graph: true, terminal: true }, 'a new workspace starts with the defaults');
assert.deepEqual(resolveWorkspacePlugins(null, null, null, 'c:\\notes', defaults).enabled, { 'version-history': true, graph: true, terminal: true },
  'a fresh install starts with the defaults');
// Once saved, the workspace's own record wins over the old global one.
const saved = { enabled: { 'ai-claude': false }, config: { automations: { x: '1' } } };
const reopened = resolveWorkspacePlugins(saved, legacy, ['c:\\notes'], 'c:\\notes', defaults);
assert.equal(reopened.enabled['ai-claude'], false);
assert.equal(reopened.enabled['daily-calendar'], undefined);
assert.equal(reopened.enabled.graph, true, 'a default the record never mentioned is filled in');
assert.deepEqual(reopened.config, { automations: { x: '1' } });
// Junk in a stored record is ignored rather than trusted.
assert.deepEqual(resolveWorkspacePlugins({ enabled: { a: 'yes', b: true }, config: {} }, null, null, 'k', []).enabled, { b: true });
// The old record is not changed by being read.
assert.deepEqual(legacy.enabled, { 'ai-claude': true, terminal: false, 'daily-calendar': true });

// --- Per workspace: switching a plugin on in one leaves another untouched ----
// The settings store as the host uses it: load by the workspace's key, save
// the whole record back under that key (host.tsx setEnabled/persist).
for (const [platform, a, aAgain, b] of [
  ['win32', 'C:\\Notes\\Work', 'c:/notes/work/', 'C:\\Notes\\Home'],
  ['darwin', '/Users/Ada/Work', '/users/ada/Work/', '/Users/Ada/Home'],
  ['linux', '/home/ada/Work', '/home/ada/Work//', '/home/ada/Home'],
]) {
  const store = new Map();
  const open = (dir) => resolveWorkspacePlugins(store.get(workspacePluginsKey(dir, platform)) ?? null, null, null, workspaceKey(dir, platform), defaults);
  const enable = (dir, id, on) => {
    const current = open(dir);
    store.set(workspacePluginsKey(dir, platform), { ...current, enabled: { ...current.enabled, [id]: on } });
  };
  enable(b, 'graph', true);
  const bBefore = JSON.stringify(store.get(workspacePluginsKey(b, platform)));
  enable(a, 'daily-calendar', true);
  assert.equal(open(a).enabled['daily-calendar'], true, `${platform}: on where it was switched on`);
  assert.equal(open(aAgain).enabled['daily-calendar'], true, `${platform}: another spelling of the folder is the same workspace`);
  assert.equal(workspacePluginsKey(a, platform), workspacePluginsKey(aAgain, platform), `${platform}: one key for both spellings`);
  assert.equal(open(b).enabled['daily-calendar'], undefined, `${platform}: off in the other workspace`);
  assert.equal(JSON.stringify(store.get(workspacePluginsKey(b, platform))), bBefore, `${platform}: the other workspace's record is not written`);
  enable(aAgain, 'daily-calendar', false);
  assert.equal(store.size, 2, `${platform}: switching off under the other spelling writes the same record`);
  assert.equal(open(a).enabled['daily-calendar'], false);
}

// --- Connectors, read off the plugin manifests -----------------------------
const claude = {
  id: 'ai-claude', name: 'Claude Assistant', connector: { id: 'anthropic', name: 'Claude', description: 'd' },
  configSchema: [{ key: 'apiKey', label: 'Key', type: 'password' }, { key: 'model', label: 'Model', type: 'text' }],
};
const local = {
  id: 'ai-local', name: 'Local Model', connector: { id: 'local', name: 'Local model', description: 'd' },
  configSchema: [{ key: 'endpoint', label: 'Endpoint', type: 'url' }, { key: 'model', label: 'Model', type: 'text' }],
};
const terminal = { id: 'terminal', name: 'Terminal' };
const connectors = connectorsOf([claude, terminal, local, { ...claude, id: 'ai-claude-2' }]);
assert.deepEqual(connectors.map((c) => c.id), ['anthropic', 'local'], 'one row per connector, none for plugins without one');
assert.deepEqual(connectors[0].usedBy, ['ai-claude', 'ai-claude-2']);
assert.deepEqual(connectors[0].fields.map((f) => f.key), ['apiKey', 'model']);

// --- Status ---------------------------------------------------------------
assert.equal(connectorStatus(claude.configSchema, {}, {}), 'not-set-up');
assert.equal(connectorStatus(claude.configSchema, { model: 'x' }, { apiKey: false }), 'not-set-up', 'a model name alone is not set up');
assert.equal(connectorStatus(claude.configSchema, {}, { apiKey: true }), 'connected');
assert.equal(connectorStatus(local.configSchema, { model: 'llama3' }, {}), 'not-set-up');
assert.equal(connectorStatus(local.configSchema, { endpoint: '  ' }, {}), 'not-set-up');
assert.equal(connectorStatus(local.configSchema, { endpoint: 'http://localhost:11434/v1/chat/completions' }, {}), 'connected');
assert.equal(connectorStatus([], undefined, undefined), 'connected');

// --- Connector config migration: copied, nothing deleted ------------------
const legacyConfig = {
  'ai-claude': { model: 'claude-x', apiKey: 'sk-ant-plain' },
  'ai-local': { endpoint: 'http://localhost:1234/v1/chat/completions', model: 'qwen', extra: 'kept' },
  terminal: { shell: 'pwsh' },
};
const before = JSON.stringify(legacyConfig);
const migrated = migrateConnectorValues(legacyConfig, [claude, local, terminal]);
assert.deepEqual(migrated.values, { anthropic: { model: 'claude-x' }, local: { endpoint: 'http://localhost:1234/v1/chat/completions', model: 'qwen' } });
assert.deepEqual(migrated.secrets, [{ connector: 'anthropic', field: 'apiKey', value: 'sk-ant-plain' }], 'a plaintext key goes to the secret store, not the readable values');
assert.ok(!JSON.stringify(migrated.values).includes('sk-ant-plain'));
assert.equal(JSON.stringify(legacyConfig), before, 'the old record is left as it was');
assert.deepEqual(migrateConnectorValues(null, [claude]), { values: {}, secrets: [] });
assert.deepEqual(migrateConnectorValues({ 'ai-claude': { model: '' } }, [claude]), { values: {}, secrets: [] }, 'empty values are not copied');

console.log('connectors: ok');
