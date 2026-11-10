import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Transpile in process, without a bundler subprocess or DOM dependency.
const source = readFileSync(new URL('../src/renderer/lib/live-edit.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const temporary = new URL('./.live-edit.tmp.cjs', import.meta.url);
writeFileSync(temporary, outputText);
let helpers;
try { helpers = createRequire(import.meta.url)('./.live-edit.tmp.cjs'); }
finally { unlinkSync(temporary); }
const { replaceLines, splitLinePrefix, nextLinePrefix, serializeInline, canRoundTrip } = helpers;

let passed = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); passed++; };
eq(replaceLines('first\nmiddle\nlast', 0, 0, 0, 'new'), 'new\nmiddle\nlast');
eq(replaceLines('first\nmiddle\nlast', 0, 2, 2, 'new'), 'first\nmiddle\nnew');
eq(replaceLines('first\nmiddle\nlast\n', 0, 1, 2, 'two\nlines'), 'first\ntwo\nlines\n');
const front = '---\ntitle: Kept # comment\n---\n';
eq(replaceLines(front + 'first\nlast', 3, 0, 0, 'new'), front + 'new\nlast');
eq(replaceLines(front + 'first\nlast', 3, 1, 1, 'new'), front + 'first\nnew');
eq(replaceLines(front + 'first\nlast\n', 3, 0, 1, ''), front + '\n');
const windows = '\ufeff---\r\ntitle: Kept\r\n---\r\nfirst\r\nlast\r\n';
eq(replaceLines(windows, 3, 0, 0, 'new\nnext'), windows.replace('first', 'new\r\nnext'));
eq(replaceLines('---\r\ntitle: Keep\r\n---\r\nfirst\nlast', 3, 1, 1, 'new'), '---\r\ntitle: Keep\r\n---\r\nfirst\nnew');
eq(replaceLines('', 0, 0, 0, 'Hello'), 'Hello');
eq(replaceLines('first', 0, 1, 0, 'last'), 'first\nlast');
eq(replaceLines('---\ntitle: Kept\n---', 3, 0, 0, 'Body'), '---\ntitle: Kept\n---\nBody');
eq(replaceLines('first\nlast', 0, 1, 0, 'inserted'), 'first\ninserted\nlast');
eq(replaceLines('first\n\nlast', 0, 1, 1, []), 'first\nlast');
eq(replaceLines('first\n', 0, 1, 1, []), 'first');
eq(replaceLines('', 0, 0, 0, []), '');
assert.throws(() => replaceLines('a', 0, -1, 0, 'b'), RangeError); passed++;
assert.throws(() => replaceLines('a', 0, 5, 5, 'b'), RangeError); passed++;

for (const prefix of ['# ', '## ', '### ', '#### ', '##### ', '###### ', '- ', '* ', '1. ', '19. ', '> ', '- [ ] ', '- [x] ', '- [X] ', '* [ ] ', '[ ] ', '[] ', '']) {
  const line = prefix + 'before **bold**';
  const split = splitLinePrefix(line);
  eq(split, { prefix, text: 'before **bold**' });
  eq(replaceLines(line, 0, 0, 0, split.prefix + 'after **bold**'), prefix + 'after **bold**');
}
eq(nextLinePrefix('- '), '- ');
eq(nextLinePrefix('* '), '* ');
eq(nextLinePrefix('9. '), '10. ');
eq(nextLinePrefix('- [x] '), '- [ ] ');
eq(nextLinePrefix('## '), '');
eq(nextLinePrefix('> '), '');

const text = (value) => ({ nodeType: 3, textContent: value, childNodes: [] });
const element = (tagName, childNodes = [], dataset = {}) => ({ nodeType: 1, tagName, textContent: null, childNodes, dataset });
const atom = (md, label = 'Rendered label') => element('SPAN', [text(label)], { md });
const tick = String.fromCharCode(96);
for (const [nodes, markdown] of [
  [[text('plain α < & #tag')], 'plain α < & #tag'],
  [[element('STRONG', [text('bold')])], '**bold**'],
  [[element('EM', [text('italic')])], '*italic*'],
  [[element('DEL', [text('gone')])], '~~gone~~'],
  [[atom('[Label](https://example.com "Title")')], '[Label](https://example.com "Title")'],
  [[atom('[[folder/Note|Alias]]')], '[[folder/Note|Alias]]'],
  [[atom(tick + 'code' + tick)], tick + 'code' + tick],
  [[atom('![[embed]]')], '![[embed]]'],
  [[element('BR', [], { md: '<BR />' })], '<BR />'],
  [[atom('#tag')], '#tag'],
  [[text('See '), element('STRONG', [text('bold')]), text(' and '), element('EM', [text('italics')]), text(' '), atom('[[Note]]'), text(' '), atom(tick + 'x' + tick), text(' '), atom('[site](https://example.com)')], 'See **bold** and *italics* [[Note]] ' + tick + 'x' + tick + ' [site](https://example.com)'],
  [[element('STRONG', [text('bold '), element('EM', [text('nested')]), text(' '), atom('[[Note]]')])], '**bold *nested* [[Note]]**'],
]) {
  const root = element('P', nodes);
  eq(serializeInline(root), markdown);
  eq(canRoundTrip(root, markdown), true);
}
eq(serializeInline(element('P', [element('BR')])), '');
eq(serializeInline(element('P', [element('STRONG', [element('BR')])])), '');
eq(canRoundTrip(element('P', [element('STRONG')]), '**'), false);
eq(serializeInline(element('P', [element('U', [text('underlined')])])), null);
eq(canRoundTrip(element('P', [element('U', [text('underlined')])]), '<u>underlined</u>'), false);
eq(canRoundTrip(element('P', [element('STRONG', [text('bold')])]), '__bold__'), false);
console.log('live-edit: ' + passed + ' assertions passed');
