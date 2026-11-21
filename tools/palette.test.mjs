// Run: node tools/palette.test.mjs
// The command palette: every command once, the shortcut it shows is the one
// keybindings.ts gives the same action, plugin commands only from plugins on in
// this workspace, and two workspaces of one name told apart by their folder.
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-palette-'));
const file = join(out, 'palette.mjs');
await build({
  stdin: {
    contents: [
      "export * from './src/renderer/lib/palette-commands.ts';",
      "export { KEY_ACTIONS, DEFAULT_BINDINGS, resolveBindings, formatChord } from './src/renderer/lib/keybindings.ts';",
      "export { activatePlugins } from './src/renderer/plugins/activate.ts';",
      "export { resolveWorkspacePlugins, workspaceKey } from './src/renderer/plugins/connectors.ts';",
    ].join('\n'),
    resolveDir: process.cwd(), loader: 'ts',
  },
  outfile: file, format: 'esm', bundle: true, platform: 'node', logLevel: 'silent',
});
const {
  paletteCommands, shortcutText, KEY_ACTIONS, DEFAULT_BINDINGS, resolveBindings, formatChord, activatePlugins, resolveWorkspacePlugins, workspaceKey,
} = await import(pathToFileURL(file));

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

const noop = () => {};
const actions = new Proxy({}, { get: () => noop });
const layout = (over = {}) => ({ sidebar: true, leftPanel: false, rightPanel: false, bottomPanel: false, sidebarCollapsed: false, statusBar: true, zen: false, sidebarSide: 'left', ...over });
const repo = (path) => ({ path, name: path.split(/[\\/]/).filter(Boolean).pop() });
const state = (over = {}) => ({
  layout: layout(), savedLayouts: [], recents: [], editorGroups: 1, canSplitRight: false, canSplitDown: false, shellActive: false, graphActive: false, ...over,
});

// Every combination of what changes a label.
const states = [];
for (const flag of [false, true]) {
  states.push(state({
    layout: layout({ sidebar: flag, leftPanel: flag, rightPanel: flag, bottomPanel: flag, sidebarCollapsed: flag, statusBar: flag, zen: flag, sidebarSide: flag ? 'right' : 'left' }),
    shellActive: flag, graphActive: flag, editorGroups: flag ? 3 : 1, canSplitRight: flag, canSplitDown: flag,
    recents: [repo('/home/a/one/notes'), repo('/home/a/two/notes'), repo('/home/a/work')],
    savedLayouts: [{ id: 'l1', name: 'Writing' }, { id: 'l2', name: 'Review' }],
  }));
}

check('every command has a unique id and a unique row, in every state', () => {
  for (const s of states) {
    const commands = paletteCommands(s, actions);
    const ids = commands.map((c) => c.id);
    // What the row shows: two workspaces of one name differ by their folder.
    const labels = commands.map((c) => c.label + (c.detail ? ' ' + c.detail : ''));
    assert.equal(new Set(ids).size, ids.length, `duplicate id: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
    assert.equal(new Set(labels).size, labels.length, `duplicate label: ${labels.filter((l, i) => labels.indexOf(l) !== i)}`);
    for (const c of commands) assert.ok(c.label.trim() && c.id && typeof c.run === 'function' && c.icon, c.id);
  }
});

check('the built-in plugins register commands with ids and titles of their own', () => {
  const dir = 'src/renderer/plugins/builtin';
  const registered = readdirSync(dir).flatMap((name) => [...readFileSync(join(dir, name), 'utf8')
    .matchAll(/registerCommand\(\{\s*id:\s*'([^']+)',\s*title:\s*(?:'([^']+)'|"([^"]+)")/g)].map((m) => ({ id: m[1], title: m[2] ?? m[3] })));
  assert.ok(registered.length >= 2, 'found the registrations');
  const ids = registered.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  const own = new Set(states.flatMap((s) => paletteCommands(s, actions).map((c) => c.label)));
  for (const { title } of registered) assert.ok(!own.has(title), `${title} reads like a palette command`);
});

check('a shortcut on a row is a real binding, and the one for the same action', () => {
  const ids = new Set(KEY_ACTIONS.map((a) => a.id));
  const commands = paletteCommands(states[0], actions);
  for (const c of commands) if (c.shortcut) assert.ok(ids.has(c.shortcut), `${c.id} shows ${c.shortcut}, which keybindings.ts does not define`);
  // The palette commands that do what a key action does show its chord.
  const same = {
    'new-note': 'create-note', 'new-view': 'new-view', 'open-website': 'open-website', 'toggle-graph': 'toggle-graph',
    'toggle-fullscreen': 'toggle-fullscreen', 'toggle-zen': 'toggle-zen', 'toggle-terminal': 'toggle-terminal', 'split-editor-right': 'split-right',
  };
  for (const [action, id] of Object.entries(same)) {
    assert.equal(commands.find((c) => c.id === id)?.shortcut, action, `${id} shows the ${action} chord`);
  }
  // Each action's chord appears on at most one row, so the palette never teaches two chords for one thing.
  const shown = commands.filter((c) => c.shortcut).map((c) => c.shortcut);
  assert.equal(new Set(shown).size, shown.length);
});

check('the chord shown is the user\'s own binding, as the platform writes it', () => {
  const graph = paletteCommands(states[0], actions).find((c) => c.id === 'toggle-graph');
  assert.equal(shortcutText(graph, DEFAULT_BINDINGS), formatChord(DEFAULT_BINDINGS['toggle-graph']));
  const custom = resolveBindings({ 'toggle-graph': 'mod+alt+g' });
  assert.equal(shortcutText(graph, custom), formatChord('mod+alt+g'));
  assert.equal(shortcutText(paletteCommands(states[0], actions).find((c) => c.id === 'new-database'), custom), null, 'no binding, no chord');
});

check('two workspaces of one name show their parent folder; a unique name shows none', () => {
  const commands = paletteCommands(states[0], actions).filter((c) => c.id.startsWith('switch:'));
  const byPath = Object.fromEntries(commands.map((c) => [c.id.slice('switch:'.length), c]));
  assert.equal(byPath['/home/a/one/notes'].label, 'Switch workspace: notes');
  assert.equal(byPath['/home/a/one/notes'].detail, 'a/one');
  assert.equal(byPath['/home/a/two/notes'].detail, 'a/two');
  assert.equal(byPath['/home/a/work'].detail, undefined);
  assert.match(byPath['/home/a/one/notes'].value, /one/, 'and typing the folder finds it');
  // Same on Windows paths.
  const win = paletteCommands(state({ recents: [repo('C:\\Users\\me\\notes'), repo('D:\\notes')] }), actions).filter((c) => c.id.startsWith('switch:'));
  assert.deepEqual(win.map((c) => c.detail), ['Users/me', 'D:']);
});

check('a command runs what it says, and switching workspace closes the palette first', () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const commands = paletteCommands(states[1], spy);
  commands.find((c) => c.id === 'switch:/home/a/two/notes').run();
  commands.find((c) => c.id === 'new-table').run();
  commands.find((c) => c.id === 'dock:bottomPanel').run();
  assert.deepEqual(calls, [['onSwitchRepo', '/home/a/two/notes'], ['onCreateKind', 'table'], ['onLayoutChange', { bottomPanel: false }]]);
  assert.equal(commands.find((c) => c.id === 'switch:/home/a/two/notes').closeFirst, true);
  assert.equal(commands.find((c) => c.id === 'new-table').keepsFocus, true);
});

check('plugin commands come only from plugins switched on in this workspace', () => {
  const plugin = (id, title) => ({ manifest: { id, name: id }, activate: (host) => { host.registerCommand({ id: `${id}.run`, title, run: noop }); } });
  const catalog = [plugin('calendar', 'Open today'), plugin('history', 'Show versions'), { manifest: { id: 'broken', name: 'broken' }, activate: () => { throw new Error('no'); } }];
  // Two workspaces, one record each: calendar is on in the first only.
  const store = new Map([
    ['plugins:/w/one', { enabled: { calendar: true, broken: true }, config: {} }],
    ['plugins:/w/two', { enabled: { history: true }, config: {} }],
  ]);
  const commandsIn = (dir) => {
    const enabled = resolveWorkspacePlugins(store.get(`plugins:${dir}`) ?? null, null, null, workspaceKey(dir, 'linux'), []).enabled;
    const quiet = console.error; console.error = noop;
    try { return activatePlugins(catalog, enabled).commands.map((c) => [c.pluginId, c.command.title]); } finally { console.error = quiet; }
  };
  assert.deepEqual(commandsIn('/w/one'), [['calendar', 'Open today']], 'a plugin that throws is skipped');
  assert.deepEqual(commandsIn('/w/two'), [['history', 'Show versions']]);
  assert.deepEqual(commandsIn('/w/three'), [], 'a new workspace has none on');
  const app = readFileSync('src/renderer/components/CommandPalette.tsx', 'utf8');
  assert.match(app, /const \{ commands: pluginCommands, runtimeFor \} = usePlugins\(\);/, 'the palette lists the host\'s activated commands');
  assert.match(readFileSync('src/renderer/plugins/host.tsx', 'utf8'), /activatePlugins\(catalog, state\.enabled\)/, 'which the host builds from this workspace\'s switches');
});

console.log(`\npalette: ${checks} checks passed`);
rmSync(out, { recursive: true, force: true });
