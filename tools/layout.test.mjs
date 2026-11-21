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
// The terminal toggle: shown means plugin on, dock open and its tab selected.
const { TERMINAL_PANEL_KEY, terminalVisible, terminalTogglePatch } = helpers;
assert.equal(TERMINAL_PANEL_KEY, 'terminal:terminal.panel');
const term = { pluginId: 'terminal', view: { id: 'terminal.panel', location: 'bottom' } };
const other = { pluginId: 'p', view: { id: 'a', location: 'bottom' } };
const both = [other, term];
const apply = (layout, patch) => ({ ...layout, ...patch });
// Plugin off: no panel is registered, so there is nothing to show or hide.
assert.equal(terminalVisible([other], DEFAULT_LAYOUT), false);
assert.equal(terminalTogglePatch([other], DEFAULT_LAYOUT), null);
// Bottom dock closed: toggling opens it and selects the terminal tab.
assert.equal(terminalVisible([term], DEFAULT_LAYOUT), false);
assert.deepEqual(terminalTogglePatch([term], DEFAULT_LAYOUT), { bottomPanel: true, activePanels: { 'bottom:0': TERMINAL_PANEL_KEY } });
// Dock open but another tab selected: not visible; toggling selects the terminal and leaves the dock open.
const otherTab = { ...DEFAULT_LAYOUT, bottomPanel: true, activePanels: { 'bottom:0': 'p:a' } };
assert.equal(terminalVisible(both, otherTab), false);
const selectPatch = terminalTogglePatch(both, otherTab);
assert.deepEqual(selectPatch, { bottomPanel: true, activePanels: { 'bottom:0': TERMINAL_PANEL_KEY } });
// Open and selected: visible; toggling closes the dock only.
const shown = apply(otherTab, selectPatch);
assert.equal(terminalVisible(both, shown), true);
assert.deepEqual(terminalTogglePatch(both, shown), { bottomPanel: false });
assert.equal(terminalVisible(both, apply(shown, { bottomPanel: false })), false);
// With no stored selection the first tab of the group counts as selected.
assert.equal(terminalVisible([term, other], { ...DEFAULT_LAYOUT, bottomPanel: true }), true);
assert.equal(terminalVisible(both, { ...DEFAULT_LAYOUT, bottomPanel: true }), false);
// Moved to the right dock: that dock's flag decides, not the bottom one.
const right = resolveLayout({ panels: { [TERMINAL_PANEL_KEY]: { dock: 'right', order: 0 } }, bottomPanel: true });
assert.equal(terminalVisible([term], right), false);
assert.deepEqual(terminalTogglePatch([term], right), { rightPanel: true, activePanels: { 'right:0': TERMINAL_PANEL_KEY } });
assert.equal(terminalVisible([term], { ...right, rightPanel: true }), true);
assert.deepEqual(terminalTogglePatch([term], { ...right, rightPanel: true }), { rightPanel: false });
// In a split group: the selection is per group, and an existing selection elsewhere is kept.
const split = resolveLayout({
  rightPanel: true,
  panels: { 'p:a': { dock: 'right', order: 0, group: 0 }, [TERMINAL_PANEL_KEY]: { dock: 'right', order: 0, group: 1 } },
  activePanels: { 'right:0': 'p:a' },
});
assert.equal(terminalVisible(both, split), true, 'alone in its own group, so selected there');
const stacked = resolveLayout({
  rightPanel: true,
  panels: { 'p:a': { dock: 'right', order: 0, group: 1 }, [TERMINAL_PANEL_KEY]: { dock: 'right', order: 1, group: 1 }, 'q:b': { dock: 'right', order: 0, group: 0 } },
  activePanels: { 'right:0': 'q:b', 'right:1': 'p:a' },
});
const third = { pluginId: 'q', view: { id: 'b' } };
assert.equal(terminalVisible([other, term, third], stacked), false);
assert.deepEqual(terminalTogglePatch([other, term, third], stacked), { rightPanel: true, activePanels: { 'right:0': 'q:b', 'right:1': TERMINAL_PANEL_KEY } });

// .neuron/layout.json: the sidebar and terminal keys, and the meaning-not-text comparison.
const surfaces = await transform(readFileSync(join(root, 'src/renderer/surfaces/layout.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
const surfacesTmp = join(root, 'tools/.surfaces-layout.tmp.mjs');
writeFileSync(surfacesTmp, surfaces.code);
let surfaceHelpers;
try { surfaceHelpers = await import(pathToFileURL(surfacesTmp)); } finally { rmSync(surfacesTmp); }
const { parseWorkspacePanels, parseLayout, hasLayoutTree, sameJson } = surfaceHelpers;
const json = (value) => JSON.stringify(value);
// Short form and long form.
assert.deepEqual(parseWorkspacePanels(json({ sidebar: 'open', terminal: 'closed' })), { sidebar: { open: true }, terminal: { open: false } });
assert.deepEqual(parseWorkspacePanels(json({ sidebar: { state: 'open', position: 'right' }, terminal: { state: 'closed', position: 'bottom' } })),
  { sidebar: { open: true, side: 'right' }, terminal: { open: false, dock: 'bottom' } });
// Case and surrounding space do not matter.
assert.deepEqual(parseWorkspacePanels(json({ sidebar: '  CLOSED ', terminal: { state: 'Open', position: ' Left' } })), { sidebar: { open: false }, terminal: { open: true, dock: 'left' } });
// Junk types and unknown values are dropped; what is valid beside them is kept.
for (const value of [true, 1, null, [], ['open'], 'shown', '', { state: 1 }, { state: ['open'] }, { position: 'bottom' }]) {
  assert.deepEqual(parseWorkspacePanels(json({ sidebar: value })), {}, 'junk sidebar ' + json(value));
}
for (const position of ['top', 'up', 'center', 'TOP', 1, null]) {
  assert.deepEqual(parseWorkspacePanels(json({ terminal: { position } })), {}, 'unknown terminal position ' + json(position));
}
assert.deepEqual(parseWorkspacePanels(json({ terminal: { state: 'open', position: 'top' } })), { terminal: { open: true } });
assert.deepEqual(parseWorkspacePanels(json({ sidebar: { state: 'nope', position: 'right' } })), { sidebar: { side: 'right' } });
// Extra keys are ignored, at the top level and inside a setting.
assert.deepEqual(parseWorkspacePanels(json({ theme: 'dark', sidebar: { state: 'closed', width: 300 }, statusBar: 'closed' })), { sidebar: { open: false } });
// A file with only the new keys has no layout tree; one with only the old tree has no settings.
const onlyKeys = json({ sidebar: 'closed' });
assert.equal(parseLayout(onlyKeys), null);
assert.equal(hasLayoutTree(onlyKeys), false);
const onlyTree = json({ direction: 'vertical', children: [{ size: 100, panel: { type: 'editor' } }] });
assert.deepEqual(parseWorkspacePanels(onlyTree), {});
assert.equal(hasLayoutTree(onlyTree), true);
assert.notEqual(parseLayout(onlyTree), null);
const bothParts = json({ direction: 'vertical', children: [{ size: 100, panel: { type: 'editor' } }], terminal: 'open' });
assert.deepEqual(parseWorkspacePanels(bothParts), { terminal: { open: true } });
assert.deepEqual(parseLayout(bothParts).children, JSON.parse(onlyTree).children, 'the panel tree is read as before');
// Not JSON, or not an object: no settings, and the layout view still explains the problem.
for (const text of ['', '{', 'sidebar: closed', '[]', '"open"', 'null', '42']) assert.deepEqual(parseWorkspacePanels(text), {}, 'not settings: ' + text);
assert.equal(hasLayoutTree('{'), true);
assert.equal(hasLayoutTree('[]'), true);
// sameJson: meaning, not text.
assert.equal(sameJson('{"a":1,"b":[1,2]}', '{\n  "b": [ 1, 2 ],\n  "a": 1\n}\n'), true, 'whitespace and key order do not count');
assert.equal(sameJson('{"a":{"y":1,"x":2}}', '{"a":{"x":2,"y":1}}'), true, 'nested key order does not count');
assert.equal(sameJson('[1,2]', '[2,1]'), false, 'array order counts');
assert.equal(sameJson('{"a":[{"x":1},{"y":2}]}', '{"a":[{"y":2},{"x":1}]}'), false);
assert.equal(sameJson('{"a":1}', '{"a":"1"}'), false, 'a number is not a string');
assert.equal(sameJson('{"a":1}', '{"a":1,"b":null}'), false);
assert.equal(sameJson('{"__proto__":{"a":1}}', '{"__proto__":{"a":2}}'), false, 'a __proto__ key is compared like any other');
assert.equal(sameJson('{"a":1}', '{"a":1'), false, 'invalid is never the same as valid');
assert.equal(sameJson('{"a":1', '{"a":1'), true, 'identical invalid text is the same');
assert.equal(sameJson('{"a":1', '{"a": 1'), false, 'different invalid text is not');

// Applying the settings to the window's layout.
const { workspacePanelsPatch } = helpers;
const docked = (list, layout) => Object.fromEntries(Object.entries(placePanels(list, layout)).map(([dock, g]) => [dock, g.map((members) => members.map(panelKey))]));
// Sidebar: open/closed and side, and nothing when it already matches.
assert.deepEqual(workspacePanelsPatch(both, DEFAULT_LAYOUT, { sidebar: { open: false } }), { sidebar: false });
assert.equal(workspacePanelsPatch(both, DEFAULT_LAYOUT, { sidebar: { open: true } }), null);
assert.deepEqual(workspacePanelsPatch(both, DEFAULT_LAYOUT, { sidebar: { side: 'right' } }), { sidebarSide: 'right' });
assert.deepEqual(workspacePanelsPatch(both, { ...DEFAULT_LAYOUT, sidebar: false }, { sidebar: { open: true, side: 'right' } }), { sidebar: true, sidebarSide: 'right' });
assert.equal(workspacePanelsPatch(both, DEFAULT_LAYOUT, {}), null);
// Terminal open: its dock opens with its tab selected.
assert.deepEqual(workspacePanelsPatch(both, otherTab, { terminal: { open: true } }), { activePanels: { 'bottom:0': TERMINAL_PANEL_KEY } });
assert.deepEqual(workspacePanelsPatch([term], DEFAULT_LAYOUT, { terminal: { open: true } }), { bottomPanel: true, activePanels: { 'bottom:0': TERMINAL_PANEL_KEY } });
assert.equal(workspacePanelsPatch(both, shown, { terminal: { open: true } }), null, 'already shown');
// Terminal closed: the dock closes when the terminal is its selected tab...
assert.deepEqual(workspacePanelsPatch(both, shown, { terminal: { open: false } }), { bottomPanel: false });
// ...and not when the person has another tab selected there.
assert.equal(workspacePanelsPatch(both, otherTab, { terminal: { open: false } }), null);
// ...nor when the dock is split and another group shows something else.
assert.equal(workspacePanelsPatch(both, split, { terminal: { open: false } }), null);
// Plugin disabled: no terminal panel is registered, so the terminal key is ignored.
assert.equal(workspacePanelsPatch([other], DEFAULT_LAYOUT, { terminal: { open: true, dock: 'right' } }), null);
assert.deepEqual(workspacePanelsPatch([other], DEFAULT_LAYOUT, { sidebar: { open: false }, terminal: { open: true } }), { sidebar: false });
// Position only: the terminal moves, and what is on screen stays as it was.
const movedHidden = apply(DEFAULT_LAYOUT, workspacePanelsPatch(both, DEFAULT_LAYOUT, { terminal: { dock: 'right' } }));
assert.deepEqual(docked(both, movedHidden).right, [[TERMINAL_PANEL_KEY]]);
assert.equal(movedHidden.rightPanel, false, 'a hidden terminal stays hidden');
assert.equal(terminalVisible(both, movedHidden), false);
const movedShown = apply(shown, workspacePanelsPatch(both, shown, { terminal: { dock: 'right' } }));
assert.equal(terminalVisible(both, movedShown), true, 'a shown terminal stays shown, in its new dock');
assert.equal(movedShown.rightPanel, true);
assert.equal(movedShown.bottomPanel, true, 'the other tab keeps the bottom dock it is in');
// Moving into a dock the person is using keeps their selected tab there.
const busyRight = { ...DEFAULT_LAYOUT, rightPanel: true, activePanels: { 'right:0': 'q:b' } };
const movedBusy = apply(busyRight, workspacePanelsPatch([other, term, third], busyRight, { terminal: { dock: 'right' } }));
assert.deepEqual(docked([other, term, third], movedBusy).right, [['q:b', TERMINAL_PANEL_KEY]]);
assert.equal(movedBusy.activePanels['right:0'], 'q:b');
assert.equal(movedBusy.rightPanel, true);
// Position and state together.
const movedOpen = apply(DEFAULT_LAYOUT, workspacePanelsPatch(both, DEFAULT_LAYOUT, { terminal: { open: true, dock: 'right' } }));
assert.equal(terminalVisible(both, movedOpen), true);
assert.deepEqual(docked(both, movedOpen).right, [[TERMINAL_PANEL_KEY]]);
const movedClosed = apply(shown, workspacePanelsPatch(both, shown, { terminal: { open: false, dock: 'left' } }));
assert.deepEqual(docked(both, movedClosed).left, [[TERMINAL_PANEL_KEY]]);
assert.equal(terminalVisible(both, movedClosed), false);
assert.equal(movedClosed.leftPanel, false);
// The dock it is already in: nothing to move.
assert.equal(workspacePanelsPatch(both, DEFAULT_LAYOUT, { terminal: { dock: 'bottom' } }), null);
// Zen: nothing is applied.
assert.equal(workspacePanelsPatch(both, { ...DEFAULT_LAYOUT, zen: true }, { sidebar: { open: false }, terminal: { open: true } }), null);
// End to end, from the file text.
assert.deepEqual(workspacePanelsPatch(both, DEFAULT_LAYOUT, parseWorkspacePanels(json({ sidebar: 'closed', terminal: { state: 'open', position: 'top' } }))),
  { sidebar: false, bottomPanel: true, activePanels: { 'bottom:0': TERMINAL_PANEL_KEY } });
// --- Module 8: .neuron/layout.json, presets and drift, saved-layout limits ---------
{
  const { readableLayout } = surfaceHelpers;
  const tree = (children) => json({ direction: 'horizontal', children });
  // A children tree is what renders the shell: groups nest, panels keep their keys.
  const shell = parseLayout(tree([
    { size: 25, panel: { type: 'tree' } },
    { size: 75, group: { direction: 'vertical', children: [{ size: 70, panel: { type: 'editor' } }, { size: 30, panel: { type: 'graph', scope: 'folder', extra: 1 } }] } },
  ]));
  assert.equal(shell.direction, 'horizontal');
  assert.deepEqual(shell.children.map((c) => c.panel?.type ?? 'group'), ['tree', 'group']);
  assert.deepEqual(shell.children[1].group.children[1].panel, { type: 'graph', scope: 'folder', extra: 1 }, 'unknown panel keys are carried, not trusted');
  assert.equal(hasLayoutTree(tree([{ size: 100, panel: { type: 'editor' } }])), true);
  // Unknown top-level keys beside the tree are ignored.
  assert.deepEqual(parseLayout(json({ direction: 'vertical', theme: 'dark', zen: true, children: [{ size: 100, panel: { type: 'editor' } }] })),
    { direction: 'vertical', theme: 'dark', zen: true, children: [{ size: 100, panel: { type: 'editor' } }] });
  // Not a tree: a wrong direction or no children array renders nothing.
  for (const bad of [{ direction: 'diagonal', children: [] }, { direction: 'vertical', children: {} }, { direction: 'vertical' }, [], 'x']) {
    assert.equal(parseLayout(json(bad)), null, 'not a tree: ' + json(bad));
  }
  // Legacy inline terminals are stripped, nested too, and a group left empty goes with them.
  const legacy = parseLayout(tree([
    { size: 60, panel: { type: 'editor' } },
    { size: 40, group: { direction: 'vertical', children: [{ size: 100, panel: { type: 'terminal' } }] } },
    { size: 10, panel: { type: 'terminal', shell: 'bash' } },
  ]));
  assert.deepEqual(legacy.children, [{ size: 60, panel: { type: 'editor' } }]);
  assert.equal(parseLayout(tree([{ size: 100, panel: { type: 'terminal' } }])), null, 'only a terminal: nothing to show');
  // Invalid JSON and an empty file: no tree (the layout view shows its notice), no
  // window settings (the window keeps the default layout), and never readable.
  for (const text of ['', '   \n', '{', '{"direction": "vertical", "children": [', 'sidebar: closed']) {
    assert.equal(parseLayout(text), null, 'no tree: ' + JSON.stringify(text));
    assert.deepEqual(parseWorkspacePanels(text), {});
    assert.equal(readableLayout(text), false, 'not readable: ' + JSON.stringify(text));
    assert.deepEqual(resolveLayout(parseWorkspacePanels(text)), DEFAULT_LAYOUT);
  }
  // Readable: the short and long settings forms, and a valid tree; not a broken tree or a non-object.
  assert.equal(readableLayout(json({ sidebar: 'closed' })), true);
  assert.equal(readableLayout(json({ sidebar: { state: 'open', position: 'right' }, terminal: 'closed' })), true);
  assert.equal(readableLayout(json({ unknown: 1 })), true, 'unknown keys are ignored, not an error');
  assert.equal(readableLayout(tree([{ size: 100, panel: { type: 'editor' } }])), true);
  assert.equal(readableLayout(json({ direction: 'sideways', children: [] })), false);
  assert.equal(readableLayout(tree([{ size: 100, panel: { type: 'terminal' } }])), false);
  assert.equal(readableLayout('[]'), false);
  assert.equal(readableLayout('null'), false);

  // Zen is never restored, from any shape it was stored in.
  for (const zen of [true, 'true', 1]) assert.equal(resolveLayout({ ...DEFAULT_LAYOUT, zen }).zen, false);
  assert.equal(resolveLayout(JSON.parse(JSON.stringify({ ...DEFAULT_LAYOUT, zen: true, sidebar: false }))).sidebar, false, 'the rest of a zen session is kept');
  // Panel keys naming prototype parts are rejected, in panels and in selected tabs.
  const evil = JSON.parse('{"panels":{"__proto__:x":{"dock":"left","order":0},"p:constructor":{"dock":"left","order":0},"prototype:p":{"dock":"left","order":0},"ok:p":{"dock":"left","order":0}},"activePanels":{"left:0":"__proto__:x","right:0":"p:prototype","bottom:0":"ok:p"}}');
  const safe = resolveLayout(evil);
  assert.deepEqual(Object.keys(safe.panels), ['ok:p']);
  assert.deepEqual(safe.activePanels, { 'bottom:0': 'ok:p' });
  assert.equal({}.dock, undefined, 'Object.prototype untouched');

  // Presets and drift: a seed layout matches itself; moving a panel drifts; moving it back does not.
  const writing = SEED_LAYOUTS[0].layout;
  assert.equal(sameLayout(writing, resolveLayout(JSON.parse(JSON.stringify(writing)))), true);
  const drifted = movePanel(panels, writing, 'p:a', 'left', 0);
  assert.equal(sameLayout(writing, drifted), false, 'a panel moved to another dock');
  assert.equal(sameLayout(SEED_LAYOUTS[1].layout, SEED_LAYOUTS[0].layout), false, 'the seeds differ from each other');
  const reordered = movePanel(panels, writing, 'p:b', 'bottom', 0);
  assert.equal(sameLayout(writing, reordered), false, 'a panel reordered in its dock');
  const split = movePanel(panels, writing, 'p:d', 'right', undefined, 'new-after');
  assert.equal(sameLayout(writing, split), false, 'a panel split into its own group');
  assert.equal(sameLayout(split, movePanel(panels, split, 'p:d', 'right', undefined, 0)), false);
  assert.equal(sameLayout(writing, { ...writing, rightPanel: true }), false, 'a dock opened');
  // What is not the arrangement does not drift: zen, the selected tab, and panel sizes
  // (kept by the resizable panels themselves, never in the layout).
  assert.equal(sameLayout(writing, { ...writing, zen: true, activePanels: { 'bottom:0': 'p:b' } }), true);
  assert.equal(sameLayout(writing, resolveLayout({ ...writing, sizes: { left: 30 }, panelSizes: [20, 80] })), true);
  // Key order in the stored file does not count either.
  const reversed = Object.fromEntries(Object.entries(drifted).reverse());
  assert.equal(sameLayout(drifted, resolveLayout(JSON.parse(JSON.stringify(reversed)))), true);

  // Twenty saved layouts at most; names up to forty characters, trimmed, unique without case.
  const { MAX_SAVED_LAYOUTS, MAX_LAYOUT_NAME } = helpers;
  assert.equal(MAX_SAVED_LAYOUTS, 20);
  assert.equal(MAX_LAYOUT_NAME, 40);
  const twenty = Array.from({ length: 20 }, (_, i) => ({ id: 'l' + i, name: 'Layout ' + i, layout: {} }));
  assert.equal(resolveSavedLayouts(twenty).length, 20);
  assert.deepEqual(resolveSavedLayouts([...twenty, { id: 'extra', name: 'Extra', layout: {} }]).map((l) => l.id), twenty.map((l) => l.id), 'the 21st is dropped');
  // Junk before the limit does not use up a place.
  assert.equal(resolveSavedLayouts([null, { id: '', name: 'x' }, ...twenty]).length, 20);
  const forty = 'x'.repeat(40);
  assert.equal(layoutNameError(forty, []), null, 'exactly forty is allowed');
  assert.match(layoutNameError(forty + 'y', []), /40 characters/);
  assert.equal(layoutNameError('  ' + forty + '  ', []), null, 'surrounding space does not count');
  assert.deepEqual(resolveSavedLayouts([{ id: 'a', name: forty, layout: {} }, { id: 'b', name: forty + 'y', layout: {} }]).map((l) => l.id), ['a']);
  assert.equal(layoutNameError('Layout 3', resolveSavedLayouts(twenty)), 'That name is already used.');
}

console.log('layout: all checks passed');
