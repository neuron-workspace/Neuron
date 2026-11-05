// Run: node tools/layout.test.mjs
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { code } = await transform(readFileSync(join(root, 'src/renderer/lib/layout.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
const tmp = join(root, 'tools/.layout.tmp.mjs');
writeFileSync(tmp, code);
let helpers;
try { helpers = await import(pathToFileURL(tmp)); } finally { rmSync(tmp); }
const { DEFAULT_LAYOUT, resolveLayout, placePanels, movePanel, panelKey } = helpers;

for (const input of [undefined, null, false, 42, 'junk', []]) assert.deepEqual(resolveLayout(input), DEFAULT_LAYOUT);
const defaults = resolveLayout({});
defaults.panels['test:one'] = { dock: 'left', order: 0 };
assert.deepEqual(DEFAULT_LAYOUT.panels, {});
const overrides = resolveLayout({ sidebar: false, leftPanel: true, sidebarSide: 'right', zen: true, panels: { 'p:a': { dock: 'left', order: 3 } } });
assert.equal(overrides.sidebar, false);
assert.equal(overrides.leftPanel, true);
assert.equal(overrides.sidebarSide, 'right');
assert.equal(overrides.zen, false);
assert.deepEqual(overrides.panels, { 'p:a': { dock: 'left', order: 3 } });
const junk = resolveLayout({
  sidebar: 'false', rightPanel: 1, sidebarSide: 'bottom', panels: {
    'p:good': { dock: 'bottom', order: -2 },
    'p:dock': { dock: 'side', order: 0 },
    'p:nan': { dock: 'left', order: NaN },
    'p:infinite': { dock: 'right', order: Infinity },
    'p:string': { dock: 'right', order: '1' },
    'p:null': null, 'p:array': [], 'p:bool': true,
    'p:missing': { dock: 'left' }, plain: { dock: 'left', order: 1 },
  },
});
assert.equal(junk.sidebar, true);
assert.equal(junk.rightPanel, false);
assert.equal(junk.sidebarSide, 'left');
assert.deepEqual(junk.panels, { 'p:good': { dock: 'bottom', order: -2 } });
for (const panels of [null, [], 'junk', 1]) assert.deepEqual(resolveLayout({ panels }).panels, {});
const poisoned = resolveLayout(JSON.parse('{"panels":{"__proto__":{"dock":"left","order":0},"constructor":{"dock":"left","order":0},"p:__proto__":{"dock":"left","order":0},"prototype:x":{"dock":"left","order":0},"p:ok":{"dock":"right","order":1}}}'));
assert.deepEqual(Object.keys(poisoned.panels), ['p:ok']);
assert.equal(Object.getPrototypeOf(poisoned.panels), Object.prototype);

const panels = [
  { pluginId: 'p', view: { id: 'a', location: 'bottom' } },
  { pluginId: 'p', view: { id: 'b', location: 'bottom' } },
  { pluginId: 'p', view: { id: 'c', location: 'side' } },
  { pluginId: 'p', view: { id: 'd' } },
];
const keys = (placed) => Object.fromEntries(Object.entries(placed).map(([dock, list]) => [dock, list.map(panelKey)]));
assert.deepEqual(keys(placePanels(panels, DEFAULT_LAYOUT)), { left: [], right: ['p:c', 'p:d'], bottom: ['p:a', 'p:b'] });
const ordered = resolveLayout({ panels: { 'p:c': { dock: 'left', order: 2 }, 'p:d': { dock: 'left', order: 1 }, 'unknown:key': { dock: 'bottom', order: -1 } } });
assert.deepEqual(keys(placePanels(panels, ordered)), { left: ['p:d', 'p:c'], right: [], bottom: ['p:a', 'p:b'] });
const earlier = movePanel(panels, DEFAULT_LAYOUT, 'p:b', 'bottom', 0);
assert.deepEqual(keys(placePanels(panels, earlier)).bottom, ['p:b', 'p:a']);
const later = movePanel(panels, earlier, 'p:b', 'bottom', 1);
assert.deepEqual(keys(placePanels(panels, later)).bottom, ['p:a', 'p:b']);
const moved = movePanel(panels, later, 'p:a', 'right', 1);
assert.deepEqual(keys(placePanels(panels, moved)), { left: [], right: ['p:c', 'p:a', 'p:d'], bottom: ['p:b'] });
assert.equal(moved.rightPanel, true);
const appended = movePanel(panels, moved, 'p:b', 'right');
assert.deepEqual(keys(placePanels(panels, appended)).right, ['p:c', 'p:a', 'p:d', 'p:b']);
assert.equal(movePanel(panels, appended, 'unknown:key', 'left'), appended);
assert.deepEqual(DEFAULT_LAYOUT.panels, {});
assert.deepEqual(keys(placePanels(panels, resolveLayout(JSON.parse(JSON.stringify(appended))))), keys(placePanels(panels, appended)));
console.log('layout: all checks passed');
