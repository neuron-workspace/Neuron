import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/lib/tabs.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const {
  EMPTY_TABS, openTab, keepTab, closeTab, removeMissing,
  EMPTY_GROUPS, MAX_GROUPS, mapGroup, focusGroup, openInGroup, keepEverywhere, closeGroup, closeInGroup, canSplit, splitBlocked,
  splitGroup, moveTab, removeMissingAll, dropPreviews, serializeGroups, restoreGroups,
} = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

// A single click on nothing open adds a preview.
eq(openTab(EMPTY_TABS, 'a.md', false), { tabs: ['a.md'], preview: 'a.md', selected: 'a.md' });

// The next single click replaces the preview where it stands.
const mixed = { tabs: ['k1.md', 'p.md', 'k2.md'], preview: 'p.md', selected: 'k2.md' };
eq(openTab(mixed, 'n.md', false), { tabs: ['k1.md', 'n.md', 'k2.md'], preview: 'n.md', selected: 'n.md' });

// Three single clicks leave one tab.
eq(['a.md', 'b.md', 'c.md'].reduce((state, path) => openTab(state, path, false), EMPTY_TABS),
  { tabs: ['c.md'], preview: 'c.md', selected: 'c.md' });

// Selecting a tab that is already open changes nothing else: the preview stays.
eq(openTab(mixed, 'k1.md', false), { tabs: ['k1.md', 'p.md', 'k2.md'], preview: 'p.md', selected: 'k1.md' });
eq(openTab(mixed, 'p.md', false), { tabs: ['k1.md', 'p.md', 'k2.md'], preview: 'p.md', selected: 'p.md' });
// Even a kept open of a kept tab leaves the preview alone.
eq(openTab(mixed, 'k1.md', true), { tabs: ['k1.md', 'p.md', 'k2.md'], preview: 'p.md', selected: 'k1.md' });

// Opening as kept appends beside the preview and does not replace it.
eq(openTab(mixed, 'n.md', true), { tabs: ['k1.md', 'p.md', 'k2.md', 'n.md'], preview: 'p.md', selected: 'n.md' });
eq(openTab(EMPTY_TABS, 'a.md', true), { tabs: ['a.md'], preview: null, selected: 'a.md' });

// Opening the preview as kept promotes it in place.
eq(openTab(mixed, 'p.md', true), { tabs: ['k1.md', 'p.md', 'k2.md'], preview: null, selected: 'p.md' });

// After promotion the next single click adds a tab.
const kept = keepTab(openTab(EMPTY_TABS, 'a.md', false), 'a.md');
eq(kept, { tabs: ['a.md'], preview: null, selected: 'a.md' });
eq(openTab(kept, 'b.md', false), { tabs: ['a.md', 'b.md'], preview: 'b.md', selected: 'b.md' });

// Keeping a tab that is not the preview does nothing.
assert.equal(keepTab(mixed, 'k1.md'), mixed); checks++;

// Closing the preview clears it; selection stays where it was.
eq(closeTab(mixed, 'p.md'), { tabs: ['k1.md', 'k2.md'], preview: null, selected: 'k2.md' });

// Closing the selected tab picks the one that took its place, or the new last one.
const three = { tabs: ['a.md', 'b.md', 'c.md'], preview: null, selected: 'b.md' };
eq(closeTab(three, 'b.md'), { tabs: ['a.md', 'c.md'], preview: null, selected: 'c.md' });
eq(closeTab({ ...three, selected: 'c.md' }, 'c.md'), { tabs: ['a.md', 'b.md'], preview: null, selected: 'b.md' });
eq(closeTab({ tabs: ['a.md'], preview: 'a.md', selected: 'a.md' }, 'a.md'), { tabs: [], preview: null, selected: null });
// Closing another tab keeps the selection.
eq(closeTab(three, 'a.md'), { tabs: ['b.md', 'c.md'], preview: null, selected: 'b.md' });

// A deleted preview disappears with its file.
eq(removeMissing(mixed, ['k1.md', 'k2.md']), { tabs: ['k1.md', 'k2.md'], preview: null, selected: 'k2.md' });
eq(removeMissing({ ...mixed, selected: 'p.md' }, ['k1.md', 'k2.md']), { tabs: ['k1.md', 'k2.md'], preview: null, selected: null });
// A predicate works too, and nothing missing returns the same object.
eq(removeMissing(mixed, (path) => !path.startsWith('k')), { tabs: ['p.md'], preview: 'p.md', selected: null });
assert.equal(removeMissing(mixed, ['k1.md', 'p.md', 'k2.md']), mixed); checks++;

// --- Editor groups ----------------------------------------------------------
{
const kept = (tabs, selected = tabs[tabs.length - 1]) => ({ tabs, preview: null, selected });
const two = { groups: [kept(['a.md', 'b.md'], 'a.md'), kept(['c.md'])], direction: 'row', focused: 1 };

// Opening goes to the focused group, with that group's own preview rules.
eq(openInGroup(EMPTY_GROUPS, 'a.md', false), { groups: [{ tabs: ['a.md'], preview: 'a.md', selected: 'a.md' }], direction: 'row', focused: 0 });
eq(openInGroup(two, 'd.md', false).groups, [two.groups[0], { tabs: ['c.md', 'd.md'], preview: 'd.md', selected: 'd.md' }]);
// A preview in one group is not replaced by a single click in another.
const previews = openInGroup(openInGroup(two, 'd.md', false, 0), 'e.md', false, 1);
eq(previews.groups, [{ tabs: ['a.md', 'b.md', 'd.md'], preview: 'd.md', selected: 'd.md' }, { tabs: ['c.md', 'e.md'], preview: 'e.md', selected: 'e.md' }]);
eq(openInGroup(previews, 'f.md', false, 0).groups[0], { tabs: ['a.md', 'b.md', 'f.md'], preview: 'f.md', selected: 'f.md' });
// Opening in a named group focuses it.
eq(openInGroup(two, 'a.md', false, 0).focused, 0);
assert.equal(openInGroup(two, 'x.md', false, 7), two); checks++;
assert.equal(focusGroup(two, 1), two); checks++;
eq(focusGroup(two, 0).focused, 0);
assert.equal(mapGroup(two, 0, (group) => group), two); checks++;

// Editing keeps the file wherever it is the preview.
eq(keepEverywhere({ ...previews, groups: [previews.groups[0], { tabs: ['d.md'], preview: 'd.md', selected: 'd.md' }] }, 'd.md').groups.map((g) => g.preview), [null, null]);
assert.equal(keepEverywhere(two, 'a.md'), two); checks++;

// Split: a copy of the tab in a new group at the end, which takes focus.
const one = { groups: [kept(['a.md', 'b.md'], 'a.md')], direction: 'row', focused: 0 };
eq(splitGroup(one, 0, 'a.md', 'column'), { groups: [kept(['a.md', 'b.md'], 'a.md'), kept(['a.md'])], direction: 'column', focused: 1 });
const three = splitGroup(splitGroup(one, 0, 'a.md', 'row'), 0, 'b.md', 'row');
eq(three.groups.map((g) => g.tabs), [['a.md', 'b.md'], ['a.md'], ['b.md']]);
eq(three.focused, 2);
// A row cannot gain a group below, and four is the most.
assert.equal(canSplit(three, 'column'), false); checks++;
assert.equal(splitGroup(three, 0, 'a.md', 'column'), three); checks++;
assert.match(splitBlocked(three, 'column'), /one direction/); checks++;
assert.equal(splitBlocked(three, 'row'), null); checks++;
const four = splitGroup(three, 0, 'a.md', 'row');
eq(four.groups.length, MAX_GROUPS);
assert.equal(canSplit(four, 'row'), false); checks++;
assert.equal(splitGroup(four, 0, 'b.md', 'row'), four); checks++;
assert.match(splitBlocked(four, 'row'), /at most 4/); checks++;
// One group can split either way.
assert.equal(canSplit(one, 'column'), true); checks++;
// A split by dragging moves the tab; a group it empties closes.
eq(splitGroup(two, 1, 'c.md', 'row', true), { groups: [kept(['a.md', 'b.md'], 'a.md'), kept(['c.md'])], direction: 'row', focused: 1 });
eq(splitGroup(two, 0, 'b.md', 'row', true).groups, [kept(['a.md'], 'a.md'), kept(['c.md']), kept(['b.md'])]);

// Moving a tab between groups: it arrives kept and selected, where it was dropped.
eq(moveTab(two, 0, 1, 'b.md', 'c.md'), { groups: [kept(['a.md'], 'a.md'), kept(['b.md', 'c.md'], 'b.md')], direction: 'row', focused: 1 });
eq(moveTab(two, 0, 1, 'b.md').groups[1], kept(['c.md', 'b.md'], 'b.md'));
// Moving the last tab out closes its group; focus follows the tab.
eq(moveTab(two, 1, 0, 'c.md', 'b.md'), { groups: [kept(['a.md', 'c.md', 'b.md'], 'c.md')], direction: 'row', focused: 0 });
// Within a group it reorders.
eq(moveTab(two, 0, 0, 'b.md', 'a.md').groups[0], kept(['b.md', 'a.md'], 'b.md'));
// A preview moved to another group is kept there.
eq(moveTab({ ...two, groups: [{ tabs: ['a.md', 'p.md'], preview: 'p.md', selected: 'p.md' }, two.groups[1]] }, 0, 1, 'p.md').groups,
  [{ tabs: ['a.md'], preview: null, selected: 'a.md' }, kept(['c.md', 'p.md'])]);
assert.equal(moveTab(two, 0, 1, 'b.md', 'b.md'), two); checks++;

// A moved tab already previewed in the target is kept, so the next click cannot replace it.
{
  const targetPreview = openInGroup(two, 'b.md', false, 1);
  const moved = moveTab(targetPreview, 0, 1, 'b.md');
  eq(moved.groups[1], kept(['c.md', 'b.md']));
  eq(openInGroup(moved, 'next.md', false).groups[1],
    { tabs: ['c.md', 'b.md', 'next.md'], preview: 'next.md', selected: 'next.md' });
}

// Closing a group closes its tabs; the neighbour before it takes focus.
eq(closeGroup(three, 2), { groups: three.groups.slice(0, 2), direction: 'row', focused: 1 });
eq(closeGroup({ ...three, focused: 0 }, 0).focused, 0);
eq(closeGroup({ ...three, focused: 2 }, 0).focused, 1);
eq(closeGroup({ ...three, focused: 0 }, 2).focused, 0);
// The last group only empties.
eq(closeGroup(one, 0), { groups: [EMPTY_TABS], direction: 'row', focused: 0 });
// Closing a group's last tab closes the group, except the last group.
eq(closeInGroup(two, 1, 'c.md'), { groups: [two.groups[0]], direction: 'row', focused: 0 });
eq(closeInGroup({ groups: [kept(['a.md'])], direction: 'row', focused: 0 }, 0, 'a.md'), { groups: [EMPTY_TABS], direction: 'row', focused: 0 });
eq(closeInGroup(two, 0, 'a.md').groups, [kept(['b.md']), kept(['c.md'])]);

// A deleted file leaves every group; groups it empties close.
eq(removeMissingAll(three, (path) => path !== 'a.md'), { groups: [kept(['b.md'], null), kept(['b.md'])], direction: 'row', focused: 1 });
eq(removeMissingAll(two, ['a.md', 'b.md']), { groups: [two.groups[0]], direction: 'row', focused: 0 });
eq(removeMissingAll(two, []), { groups: [EMPTY_TABS], direction: 'row', focused: 0 });
assert.equal(removeMissingAll(two, ['a.md', 'b.md', 'c.md']), two); checks++;

// Switching workspace drops each group's preview.
eq(dropPreviews(previews).groups, [kept(['a.md', 'b.md'], 'b.md'), kept(['c.md'])]);
assert.equal(dropPreviews(two), two); checks++;

// Stored: no previews, no websites; read back, only what still exists.
const stored = serializeGroups({ groups: [{ tabs: ['a.md', 'p.md', 'https://x.test/'], preview: 'p.md', selected: 'p.md' }, kept(['c.md'])], direction: 'column', focused: 1 }, [40, 60]);
eq(stored, { groups: [{ tabs: ['a.md'], selected: null }, { tabs: ['c.md'], selected: 'c.md' }], direction: 'column', focused: 1, sizes: [40, 60] });
eq(serializeGroups(two, [100]).sizes, undefined);
const all = () => true;
eq(restoreGroups(stored, all), { state: { groups: [kept(['a.md']), kept(['c.md'])], direction: 'column', focused: 1 }, sizes: [40, 60] });
// A missing file drops its tab; a group left empty drops, and with it the sizes.
eq(restoreGroups(stored, (path) => path !== 'c.md'), { state: { groups: [kept(['a.md'])], direction: 'column', focused: 0 }, sizes: null });
eq(restoreGroups(stored, () => false), null);
// Anything malformed is ignored rather than trusted.
for (const bad of [null, 'x', 42, {}, { groups: 'a.md' }, { groups: [] }, { groups: [{ tabs: [3, null] }] }]) eq(restoreGroups(bad, all), null);
eq(restoreGroups({ groups: [{ tabs: ['a.md', 'a.md', 7, 'https://x.test/', 'b.md'], selected: 'zzz' }], direction: 'diagonal', focused: 9, sizes: [100] }, all),
  { state: { groups: [kept(['a.md', 'b.md'])], direction: 'row', focused: 0 }, sizes: [100] });
eq(restoreGroups({ ...stored, sizes: [10, 10] }, all).sizes, null);
eq(restoreGroups({ ...stored, sizes: [50, 'x'] }, all).sizes, null);
// No more than four groups come back.
eq(restoreGroups({ groups: Array.from({ length: 6 }, (_, i) => ({ tabs: [`${i}.md`] })), direction: 'row', focused: 0 }, all).state.groups.length, 4);
// The focused group, or the one before it if it went.
eq(restoreGroups({ groups: [{ tabs: ['a.md'] }, { tabs: ['b.md'] }, { tabs: ['gone.md'] }], direction: 'row', focused: 2 }, (path) => path !== 'gone.md').state.focused, 1);

// --- Damaged saved state --------------------------------------------------------
// Wrong types anywhere: each part falls back on its own, the rest is kept.
eq(restoreGroups({ groups: [null, 'x', { tabs: 'a.md' }, { tabs: ['b.md'], selected: 3 }], direction: 5, focused: '1', sizes: 'x' }, all),
  { state: { groups: [kept(['b.md'])], direction: 'row', focused: 0 }, sizes: null });
eq(restoreGroups({ groups: [{ tabs: ['a.md'] }, { tabs: ['b.md'] }], direction: 'column', focused: NaN }, all).state.focused, 0);
eq(restoreGroups({ groups: [{ tabs: ['a.md'] }, { tabs: ['b.md'] }], direction: 'column', focused: -3 }, all).state.focused, 0);
eq(restoreGroups({ groups: [{ tabs: ['a.md'] }, { tabs: ['b.md'] }], direction: 'column', focused: 1.5 }, all).state.focused, 1);
// Unknown directions are a row.
for (const direction of ['diagonal', 'Column', '', null, undefined, ['column'], { column: true }]) {
  eq(restoreGroups({ groups: [{ tabs: ['a.md'] }, { tabs: ['b.md'] }], direction, focused: 0 }, all).state.direction, 'row');
}
// Sizes that do not add up to 100, have the wrong count, or are not positive finite numbers are dropped.
const twoGroups = { groups: [{ tabs: ['a.md'] }, { tabs: ['b.md'] }], direction: 'row', focused: 0 };
for (const sizes of [[30, 30], [60, 60], [100], [50, 30, 20], [50, -50], [0, 100], [Infinity, 1], [NaN, 100], [50, null], {}, null]) {
  eq(restoreGroups({ ...twoGroups, sizes }, all).sizes, null);
}
eq(restoreGroups({ ...twoGroups, sizes: [33.4, 66.6] }, all).sizes, [33.4, 66.6]);
eq(restoreGroups({ ...twoGroups, sizes: [50.4, 50] }, all).sizes, [50.4, 50], 'rounding within a percent is fine');
// More than four groups: the first four come back, and their sizes cannot fit.
{
  const six = restoreGroups({ groups: Array.from({ length: 6 }, (_, i) => ({ tabs: [`${i}.md`] })), direction: 'column', focused: 5, sizes: [10, 10, 20, 20, 20, 20] }, all);
  eq(six.state.groups.map((g) => g.tabs), [['0.md'], ['1.md'], ['2.md'], ['3.md']]);
  eq(six.state.focused, 3, 'focus past the fourth lands on the last kept group');
  eq(six.sizes, null);
}
// Duplicate paths in one group collapse to the first; the same path in two groups is allowed (one document, two views).
eq(restoreGroups({ groups: [{ tabs: ['a.md', 'b.md', 'a.md', 'b.md'], selected: 'b.md' }], direction: 'row', focused: 0 }, all).state.groups,
  [kept(['a.md', 'b.md'], 'b.md')]);
eq(restoreGroups({ groups: [{ tabs: ['a.md'] }, { tabs: ['a.md'] }], direction: 'row', focused: 1 }, all).state,
  { groups: [kept(['a.md']), kept(['a.md'])], direction: 'row', focused: 1 });
// Empty or whitespace-free junk tab names never become tabs.
eq(restoreGroups({ groups: [{ tabs: ['', 'a.md', 'http://x.test/'] }], direction: 'row', focused: 0 }, all).state.groups, [kept(['a.md'])]);

// --- Direction lock and the four-group limit, across split, move and close --------
{
  const solo = { groups: [kept(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], 'a.md')], direction: 'row', focused: 0 };
  // Stacked by the first split; from then on only down.
  let s = splitGroup(solo, 0, 'b.md', 'column', true);
  eq(s.direction, 'column');
  assert.equal(splitGroup(s, 0, 'c.md', 'row', true), s, 'a stack does not gain a group beside it'); checks++;
  s = splitGroup(splitGroup(s, 0, 'c.md', 'column', true), 0, 'd.md', 'column', true);
  eq(s.groups.length, 4);
  // At four, neither a split from the menu nor a drag to an edge adds one.
  assert.equal(splitGroup(s, 0, 'e.md', 'column'), s); checks++;
  assert.equal(splitGroup(s, 0, 'e.md', 'column', true), s); checks++;
  // Moving tabs between groups never adds one, and keeps the direction.
  const moved = moveTab(s, 0, 3, 'e.md');
  eq(moved.groups.length, 4);
  eq(moved.direction, 'column');
  // Moving a group's only tab out closes it, which makes room again, in the same direction only.
  const three = moveTab(moved, 1, 2, 'b.md');
  eq(three.groups.map((g) => g.tabs), [['a.md'], ['c.md', 'b.md'], ['d.md', 'e.md']]);
  eq(canSplit(three, 'column'), true);
  eq(canSplit(three, 'row'), false);
  // Closed back down to one group, either direction is open again.
  const one = closeGroup(closeGroup(three, 2), 1);
  eq(one.groups.length, 1);
  eq(canSplit(one, 'row'), true);
  eq(splitGroup(one, 0, 'a.md', 'row').direction, 'row');
  // A closing tab that empties a group does the same.
  const back = closeInGroup(closeInGroup(three, 1, 'c.md'), 1, 'b.md');
  eq(back.groups.map((g) => g.tabs), [['a.md'], ['d.md', 'e.md']]);
  eq(back.direction, 'column');
}

// --- Preview per group, through every operation -----------------------------------
{
  const pv = (tabs, preview, selected = preview) => ({ tabs, preview, selected });
  const base = { groups: [pv(['a.md', 'p.md'], 'p.md'), pv(['c.md', 'q.md'], 'q.md')], direction: 'row', focused: 0 };
  // Opening in one group leaves the other's preview alone.
  eq(openInGroup(base, 'r.md', false, 0).groups, [pv(['a.md', 'r.md'], 'r.md'), base.groups[1]]);
  eq(openInGroup(base, 'r.md', true, 1).groups, [base.groups[0], pv(['c.md', 'q.md', 'r.md'], 'q.md', 'r.md')]);
  // Keeping in one group: only where that file is the preview.
  eq(keepEverywhere(base, 'p.md').groups, [pv(['a.md', 'p.md'], null, 'p.md'), base.groups[1]]);
  // A split copies the file as a kept tab; both groups keep their previews.
  eq(splitGroup(base, 0, 'a.md', 'row').groups, [...base.groups, kept(['a.md'])]);
  // A split by dragging the preview: it is kept in its new group, and its old group has none.
  eq(splitGroup(base, 0, 'p.md', 'row', true).groups, [pv(['a.md'], null, 'a.md'), base.groups[1], kept(['p.md'])]);
  // Moving a group's preview to another: kept there, the target's own preview stays.
  eq(moveTab(base, 0, 1, 'p.md').groups, [pv(['a.md'], null, 'a.md'), pv(['c.md', 'q.md', 'p.md'], 'q.md', 'p.md')]);
  // Moving a kept tab keeps both previews.
  eq(moveTab(base, 0, 1, 'a.md', 'c.md').groups, [pv(['p.md'], 'p.md'), pv(['a.md', 'c.md', 'q.md'], 'q.md', 'a.md')]);
  // Reordering within a group: a dragged preview arrives kept, as every moved tab does; another tab's drag leaves it.
  eq(moveTab(base, 0, 0, 'p.md', 'a.md').groups, [pv(['p.md', 'a.md'], null, 'p.md'), base.groups[1]]);
  eq(moveTab(base, 0, 0, 'a.md').groups[0], pv(['p.md', 'a.md'], 'p.md', 'a.md'));
  // Closing a tab or a group touches only its own group's preview.
  eq(closeInGroup(base, 1, 'q.md').groups, [base.groups[0], pv(['c.md'], null, 'c.md')]);
  eq(closeInGroup(base, 1, 'c.md').groups, [base.groups[0], pv(['q.md'], 'q.md')]);
  eq(closeGroup(base, 0).groups, [base.groups[1]]);
  // A deleted preview leaves only the groups where it was.
  eq(removeMissingAll(base, (path) => path !== 'q.md').groups, [base.groups[0], pv(['c.md'], null, null)]);
  // A workspace switch drops every group's preview; groups it empties close.
  eq(dropPreviews(base).groups, [kept(['a.md'], 'a.md'), kept(['c.md'], 'c.md')]);
  eq(dropPreviews({ ...base, groups: [pv(['p.md'], 'p.md'), base.groups[1]] }).groups, [kept(['c.md'], 'c.md')]);
  // Stored state holds no previews.
  eq(serializeGroups(base).groups, [{ tabs: ['a.md'], selected: null }, { tabs: ['c.md'], selected: null }]);
}

// --- Focus after closing ---------------------------------------------------------
{
  const four = { groups: [kept(['a.md']), kept(['b.md']), kept(['c.md']), kept(['d.md'])], direction: 'row', focused: 2 };
  // Closing the focused group: the one before it takes focus; for the first, the next (now first).
  eq(closeGroup(four, 2).focused, 1);
  eq(closeGroup({ ...four, focused: 0 }, 0).focused, 0);
  eq(closeGroup({ ...four, focused: 3 }, 3).focused, 2);
  // Closing a group before the focused one: focus stays on the same group, now one place earlier.
  const before = closeGroup(four, 0);
  eq(before.focused, 1);
  eq(before.groups[before.focused].tabs, ['c.md']);
  // Closing one after it leaves focus where it was.
  eq(closeGroup(four, 3).focused, 2);
  // The same through closing a group's last tab, and through moving it out.
  eq(closeInGroup(four, 2, 'c.md').focused, 1);
  const closedBefore = closeInGroup(four, 1, 'b.md');
  eq(closedBefore.groups[closedBefore.focused].tabs, ['c.md']);
  const movedOut = moveTab(four, 0, 3, 'a.md');
  eq(movedOut.groups[movedOut.focused].tabs, ['d.md', 'a.md'], 'focus follows the moved tab');
  // A deleted file closing groups before the focused one keeps focus on its group.
  const pruned = removeMissingAll(four, (path) => path !== 'a.md' && path !== 'b.md');
  eq(pruned.groups[pruned.focused].tabs, ['c.md']);
}
}

console.log(`tabs: ${checks} checks passed`);
