// Run: node tools/task-line.test.mjs
// Ticking a task changes that task's box and nothing else on the line (4A).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/lib/task-line.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { toggleTaskLine } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

let checks = 0;
const tick = (line, checked = true) => toggleTaskLine(line, 0, checked);
const same = (actual, expected, why) => { assert.equal(actual, expected, why); checks++; };

// Bullets of every kind, ticked and unticked.
for (const bullet of ['-', '*', '+']) {
  same(tick(`${bullet} [ ] Buy milk`), `${bullet} [x] Buy milk`, bullet);
  same(tick(`${bullet} [x] Buy milk`, false), `${bullet} [ ] Buy milk`, bullet);
  same(tick(`${bullet} [X] Buy milk`, false), `${bullet} [ ] Buy milk`, bullet + ' capital X');
}
// Numbered, with a dot or a parenthesis, and long numbers.
same(tick('1. [ ] First'), '1. [x] First');
same(tick('1) [ ] First'), '1) [x] First');
same(tick('12. [x] Twelfth', false), '12. [ ] Twelfth');
// Nested: spaces or tabs before the marker.
same(tick('    - [ ] Nested'), '    - [x] Nested');
same(tick('\t\t* [ ] Tabbed'), '\t\t* [x] Tabbed');
same(tick('   3) [x] Nested number', false), '   3) [ ] Nested number');
// Quoted, once and repeatedly, with or without spaces between the markers, and in a quoted nested list.
same(tick('> - [ ] Quoted'), '> - [x] Quoted');
same(tick('> > - [ ] Twice quoted'), '> > - [x] Twice quoted');
same(tick('>>- [ ] Tight'), '>>- [x] Tight');
same(tick('>   1. [x] Quoted number', false), '>   1. [ ] Quoted number');
same(tick('  >   - [ ] Indented quote'), '  >   - [x] Indented quote');
// A non-breaking space as the empty box.
same(tick('- [ ] No-break box'), '- [x] No-break box');
same(tick('- [x] No-break box', false), '- [ ] No-break box');

// Other brackets on the line are text: earlier ones are not the box, later ones are not touched.
same(tick('- [ ] Read [x] and [ ] in the docs'), '- [x] Read [x] and [ ] in the docs', 'later brackets stay');
same(tick('- [x] Done with [ ] later', false), '- [ ] Done with [ ] later');
same(tick('- [ ] Link to [the spec](https://x.test/[x])'), '- [x] Link to [the spec](https://x.test/[x])');
// Brackets earlier on the line mean it is not a task at all.
same(tick('Note [ ] then - [ ] text'), null, 'a box mid-line is not a task');
// A box with no list marker at the start of the line: the preview draws it as a task, so it toggles.
same(tick('[ ] no marker'), '[x] no marker');
same(tick('  [x] indented, no marker', false), '  [ ] indented, no marker');
same(tick('text [ ] no marker mid-line'), null);
same(tick('- see [x] here', false), null, 'brackets later in a plain list item');
same(tick('-[ ] no space after the marker'), null);
same(tick('- [ ]no space after the box'), null);
same(tick('- [y] other letter'), null);
same(tick('- [  ] two spaces'), null);
same(tick('1.5 [ ] not a list number'), null);
same(tick('Plain paragraph.'), null, 'a non-task line');
same(tick(''), null, 'an empty line');
// Already as asked: nothing to change.
same(tick('- [x] Done'), null);
same(tick('- [ ] Open', false), null);
// An empty task, and a box at the end of the line.
same(tick('- [ ]'), '- [x]');
same(tick('- [ ]\r'), '- [x]\r', 'a CRLF line keeps its CR');

// Only the line asked for, in a document.
const doc = '# Tasks\n\n- [ ] one [ ]\n  - [x] two\n> 1) [ ] three\nnot [ ] a task\n';
same(toggleTaskLine(doc, 2, true), '# Tasks\n\n- [x] one [ ]\n  - [x] two\n> 1) [ ] three\nnot [ ] a task\n');
same(toggleTaskLine(doc, 3, false), '# Tasks\n\n- [ ] one [ ]\n  - [ ] two\n> 1) [ ] three\nnot [ ] a task\n');
same(toggleTaskLine(doc, 4, true), '# Tasks\n\n- [ ] one [ ]\n  - [x] two\n> 1) [x] three\nnot [ ] a task\n');
same(toggleTaskLine(doc, 5, true), null);
same(toggleTaskLine(doc, 0, true), null);
same(toggleTaskLine(doc, 99, true), null, 'past the end');

// Both renderers of a task list use this one function: the editor groups and the layout shell's panel.
const group = readFileSync(new URL('../src/renderer/components/EditorGroup.tsx', import.meta.url), 'utf8');
const panels = readFileSync(new URL('../src/renderer/surfaces/panels.tsx', import.meta.url), 'utf8');
for (const [name, text] of [['EditorGroup.tsx', group], ['panels.tsx', panels]]) {
  assert.match(text, /import \{ toggleTaskLine \} from '\.\.\/lib\/task-line';/, name); checks++;
  assert.doesNotMatch(text, /function toggleTaskLine/, name + ' keeps no copy'); checks++;
}
assert.match(group, /export \{ toggleTaskLine \};/, 'still exported from EditorGroup'); checks++;

console.log(`task line: ${checks} checks passed`);
