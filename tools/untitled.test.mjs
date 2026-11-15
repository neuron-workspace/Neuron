import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/lib/untitled.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { nextUntitled } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

assert.equal(nextUntitled([], ''), 'Untitled.md');
assert.equal(nextUntitled(['Untitled.md'], ''), 'Untitled 1.md');
assert.equal(nextUntitled(['Untitled.md', 'Untitled 2.md'], ''), 'Untitled 1.md');
assert.equal(nextUntitled(['UNTITLED.MD', 'untitled 1.md'], ''), 'Untitled 2.md');
assert.equal(nextUntitled(['notes/daily/Untitled.md', 'Untitled 1.md'], 'notes/daily'), 'notes/daily/Untitled 1.md');
assert.equal(nextUntitled([], '', 'Untitled folder', ''), 'Untitled folder');
assert.equal(nextUntitled(['Untitled folder', 'Untitled folder 2'], '', 'Untitled folder', ''), 'Untitled folder 1');
assert.equal(nextUntitled(['UNTITLED FOLDER/child.md'], '', 'Untitled folder', ''), 'Untitled folder 1');
assert.equal(nextUntitled(['Untitled.md/child.md'], ''), 'Untitled 1.md');
console.log('untitled: 9 checks passed');
