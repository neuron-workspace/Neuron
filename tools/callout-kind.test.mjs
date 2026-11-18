import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/lib/callout-kind.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { calloutKind, CALLOUT_LABELS } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

const expected = {
  success: 'success', done: 'success', tip: 'success', congratulations: 'success',
  info: 'info', note: 'info',
  warning: 'warning', caution: 'warning',
  error: 'error', danger: 'error',
};
for (const [type, kind] of Object.entries(expected)) assert.equal(calloutKind(type), kind, type);
assert.equal(calloutKind('Warning'), 'warning');
assert.equal(calloutKind('DANGER'), 'error');
assert.equal(calloutKind(' Tip '), 'success');
assert.equal(calloutKind(undefined), 'info');
assert.equal(calloutKind(''), 'info');
assert.equal(calloutKind('banana'), 'info');
assert.equal(calloutKind('constructor'), 'info');
assert.deepEqual(Object.keys(CALLOUT_LABELS).sort(), ['error', 'info', 'success', 'warning']);
console.log('callout kind: type mapping passes');
