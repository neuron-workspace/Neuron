import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/lib/tabs.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { EMPTY_TABS, openTab, keepTab, closeTab, removeMissing } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

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

console.log(`tabs: ${checks} checks passed`);
