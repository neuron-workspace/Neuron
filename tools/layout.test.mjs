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
const { DEFAULT_LAYOUT, resolveLayout, placePanels, movePanel, panelKey, resolveSavedLayouts, sameLayout, layoutNameError, dockBand, SEED_LAYOUTS } = helpers;

for (const input of [undefined, null, false, 42, 'junk', []]) assert.deepEqual(resolveLayout(input), DEFAULT_LAYOUT);
assert.equal(resolveLayout({}).sidebarCollapsed, false);
for (const value of [true, false]) assert.equal(resolveLayout({ sidebarCollapsed: value }).sidebarCollapsed, value);
for (const value of ['true', 'false', 0, 1, null, [], {}, undefined]) {
  assert.equal(resolveLayout({ sidebarCollapsed: value }).sidebarCollapsed, false);
}
const defaults = resolveLayout({});
defaults.panels['test:one'] = { dock: 'left', order: 0 };
assert.deepEqual(DEFAULT_LAYOUT.panels, {});
const overrides = resolveLayout({ sidebar: false, leftPanel: true, sidebarSide: 'right', zen: true, panels: { 'p:a': { dock: 'left', order: 3 } } });
assert.equal(overrides.sidebar, false);
assert.equal(overrides.leftPanel, true);
assert.equal(overrides.sidebarSide, 'right');
assert.equal(overrides.zen, false);
assert.deepEqual(overrides.panels, { 'p:a': { dock: 'left', order: 3, group: 0 } });
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
assert.deepEqual(junk.panels, { 'p:good': { dock: 'bottom', order: -2, group: 0 } });
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
const keys = (placed) => Object.fromEntries(Object.entries(placed).map(([dock, list]) => [dock, list.flat().map(panelKey)]));
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

// Split groups: panels in one group are tabs; groups are separate cards in a dock.
const groups = (layout) => Object.fromEntries(Object.entries(placePanels(panels, layout)).map(([dock, list]) => [dock, list.map((g) => g.map(panelKey))]));
assert.equal(resolveLayout({ panels: { 'p:a': { dock: 'left', order: 0, group: 3 } } }).panels['p:a'].group, 3);
for (const group of [-1, 8, 1.5, '1', null, NaN]) {
  assert.deepEqual(resolveLayout({ panels: { 'p:a': { dock: 'left', order: 0, group } } }).panels, {}, 'junk group ' + group);
}
const active = resolveLayout({ activePanels: { 'right:0': 'p:c', 'right:9': 'p:c', 'top:0': 'p:c', 'left:0': 'plain', 'bottom:1': 7 } });
assert.deepEqual(active.activePanels, { 'right:0': 'p:c' });
// p:c and p:d start as tabs on the right. Split p:d below p:c.
const splitAfter = movePanel(panels, DEFAULT_LAYOUT, 'p:d', 'right', undefined, 'new-after');
assert.deepEqual(groups(splitAfter).right, [['p:c'], ['p:d']]);
assert.deepEqual(splitAfter.activePanels, { 'right:0': 'p:c', 'right:1': 'p:d', 'bottom:0': 'p:a' });
const splitBefore = movePanel(panels, DEFAULT_LAYOUT, 'p:d', 'right', undefined, 'new-before');
assert.deepEqual(groups(splitBefore).right, [['p:d'], ['p:c']]);
// A panel alone in its group cannot be split further.
assert.equal(movePanel(panels, splitAfter, 'p:d', 'right', undefined, 'new-after'), splitAfter);
assert.equal(movePanel(panels, splitAfter, 'p:d', 'right', undefined, { group: 1, edge: 'before' }), splitAfter);
// Joining an existing group empties the source group, and group numbers compact.
const joined = movePanel(panels, splitAfter, 'p:d', 'right', undefined, 0);
assert.deepEqual(groups(joined).right, [['p:c', 'p:d']]);
assert.deepEqual(Object.values(joined.panels).map((p) => p.group), [0, 0, 0, 0]);
const three = movePanel(panels, splitAfter, 'p:a', 'right', undefined, { group: 0, edge: 'after' });
assert.deepEqual(groups(three).right, [['p:c'], ['p:a'], ['p:d']]);
const compacted = movePanel(panels, three, 'p:a', 'bottom');
assert.deepEqual(groups(compacted), { left: [], right: [['p:c'], ['p:d']], bottom: [['p:b', 'p:a']] });
// A group that does not exist is refused, and an emptied dock closes.
assert.equal(movePanel(panels, splitAfter, 'p:a', 'right', undefined, 5), splitAfter);
const emptied = movePanel(panels, movePanel(panels, { ...DEFAULT_LAYOUT, bottomPanel: true }, 'p:a', 'right'), 'p:b', 'right');
assert.equal(emptied.bottomPanel, false);
assert.deepEqual(groups(resolveLayout(JSON.parse(JSON.stringify(three)))), groups(three));

// Saved layouts.
assert.deepEqual(resolveSavedLayouts(null), []);
assert.deepEqual(resolveSavedLayouts('junk'), []);
const saved = resolveSavedLayouts([
  { id: 'a', name: '  Writing  ', layout: { sidebar: false, panels: { 'p:a': { dock: 'left', order: 0 }, junk: 1 } } },
  { id: 'a', name: 'Same id', layout: {} },
  { id: 'b', name: 'writing', layout: {} },
  { id: 'c', name: '', layout: {} },
  { id: 'd', name: 'x'.repeat(41), layout: {} },
  { id: '', name: 'No id', layout: {} },
  { id: 'e', name: 7, layout: {} },
  null, 'junk',
  { id: 'f', name: 'Review', layout: 'junk' },
]);
assert.deepEqual(saved.map((l) => [l.id, l.name]), [['a', 'Writing'], ['f', 'Review']]);
assert.equal(saved[0].layout.sidebar, false);
assert.deepEqual(saved[0].layout.panels, { 'p:a': { dock: 'left', order: 0, group: 0 } });
assert.deepEqual(saved[1].layout, DEFAULT_LAYOUT);
assert.equal(resolveSavedLayouts(Array.from({ length: 30 }, (_, i) => ({ id: 'l' + i, name: 'Layout ' + i, layout: {} }))).length, 20);
assert.equal(layoutNameError('  ', saved), 'Enter a name.');
assert.match(layoutNameError('x'.repeat(41), saved), /40 characters/);
assert.equal(layoutNameError('REVIEW', saved), 'That name is already used.');
assert.equal(layoutNameError('REVIEW', saved, 'f'), null, 'renaming a layout to its own name is allowed');
assert.equal(layoutNameError('Research', saved), null);
// Zen and the selected tab are not part of an arrangement; everything else is.
assert.equal(sameLayout(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT, zen: true, activePanels: { 'right:0': 'p:c' } }), true);
assert.equal(sameLayout(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT, sidebar: false }), false);
assert.equal(sameLayout(splitAfter, splitBefore), false);
assert.equal(sameLayout(splitAfter, resolveLayout(JSON.parse(JSON.stringify(splitAfter)))), true);
assert.deepEqual(SEED_LAYOUTS.map((l) => l.name), ['Writing', 'Review', 'Focus']);
assert.deepEqual(resolveSavedLayouts(JSON.parse(JSON.stringify(SEED_LAYOUTS))), SEED_LAYOUTS);

// Dock bands: the outer parts of the workbench are docks, the middle is none.
const box = { left: 100, top: 50, width: 1000, height: 600 };
assert.equal(dockBand(box, 150, 200), 'left');
assert.equal(dockBand(box, 1050, 200), 'right');
assert.equal(dockBand(box, 600, 620), 'bottom');
assert.equal(dockBand(box, 600, 300), null);
assert.equal(dockBand(box, 150, 620), 'bottom', 'the bottom band wins its corners');
assert.equal(dockBand(box, 150, 620, false), 'left', 'the sidebar has no bottom dock');
// A floating panel docks only when pushed to within a fixed margin of an edge.
assert.equal(dockBand(box, 1050, 200, true, 40), null);
assert.equal(dockBand(box, 1075, 200, true, 40), 'right');
assert.equal(dockBand(box, 120, 200, true, 40), 'left');
assert.equal(dockBand(box, 600, 630, true, 40), 'bottom');
assert.equal(dockBand(box, 600, 560, true, 40), null);
console.log('layout: all checks passed');
