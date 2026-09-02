// Assistant context stays useful and bounded without standing up React or Vite.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-assistant-context-'));
// esbuild names each output after its entry point's basename, so this is
// assistant-context.js -- not a name of our choosing.
const file = join(out, 'assistant-context.js');
await build({
  entryPoints: ['src/renderer/lib/assistant-context.ts', 'src/renderer/lib/search.ts'],
  outdir: out,
  format: 'esm',
  bundle: true,
});
const context = await import('file://' + file.replace(/\\/g, '/'));
const search = await import('file://' + join(out, 'search.js').replace(/\\/g, '/'));
const { buildActiveContext, buildContext } = context;
const { searchNotes } = search;

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

check('a huge note cannot exceed the context budget', () => {
  const note = { path: 'huge.md', content: `needle ${'word '.repeat(10_000)}` };
  const [hit] = searchNotes([note], 'needle');
  assert.ok(buildContext([hit], { notes: [note], maxChars: 500 }).text.length <= 500);
  assert.ok(buildActiveContext(note, 500).text.length <= 500, 'active-note context uses the same cap');
});

check('the first snippet from each note wins over extras from one note', () => {
  const notes = [
    { path: 'first.md', content: `needle ${'one '.repeat(300)}\nneedle again\nneedle third` },
    { path: 'second.md', content: `needle ${'two '.repeat(300)}` },
  ];
  const hits = searchNotes(notes, 'needle', { snippets: 3 });
  const built = buildContext(hits, { notes, maxChars: 700, surroundingLines: 0 });
  assert.match(built.text, /first\.md/);
  assert.match(built.text, /second\.md/);
  assert.deepEqual(built.sources, ['first.md', 'second.md']);
});

check('snippets identify their path and numbered source lines', () => {
  const note = { path: 'plans/db.md', content: 'before\nstill before\nDB migration plan\nafter' };
  const [hit] = searchNotes([note], 'db');
  const built = buildContext([hit], { notes: [note], surroundingLines: 1 });
  assert.match(built.text, /File: "plans\/db\.md"/);
  assert.match(built.text, /Lines 2-4:/);
  assert.match(built.text, /3: DB migration plan/);
});

check('no matches produce an explicit, usable context message', () => {
  assert.equal(buildContext([], { notes: [] }).text, 'No matching workspace notes were found.');
});

check('short AI and db queries use the shared search successfully', () => {
  const notes = [
    { path: 'topics/AI.md', content: 'Model notes' },
    { path: 'engineering/storage.md', content: 'The db migration is ready.' },
  ];
  assert.deepEqual(searchNotes(notes, 'AI').map((hit) => hit.path), ['topics/AI.md']);
  assert.deepEqual(searchNotes(notes, 'db').map((hit) => hit.path), ['engineering/storage.md']);
});

console.log(`\nassistant context: ${checks} checks passed`);
rmSync(out, { recursive: true, force: true });
