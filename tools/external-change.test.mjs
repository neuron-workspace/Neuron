// Runnable check for src/renderer/lib/external-change.ts: what an open file
// does when it changes on disk while an edit may be pending.
// Run: node tools/external-change.test.mjs
import { transform } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'src/renderer/lib/external-change.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const { decideExternalChange } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let checks = 0;
const check = (what, fn) => {
  try { fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
  console.log(`  ok  ${what}`);
};

check('no edit pending: the outside version replaces what is shown', () => {
  assert.equal(decideExternalChange({ disk: 'theirs', pending: false, ours: [] }), 'replace');
  assert.equal(decideExternalChange({ disk: 'theirs', pending: false, ours: ['mine'] }), 'replace');
  // Even text we wrote earlier: with nothing pending, the disk is the truth.
  assert.equal(decideExternalChange({ disk: 'mine', pending: false, ours: ['mine'] }), 'replace');
});

check('an edit pending and the disk holds what we last wrote: our own echo, ignored', () => {
  assert.equal(decideExternalChange({ disk: 'mine', pending: true, ours: ['mine'] }), 'ignore');
});

check('typing saves several versions in a row; an echo of any of them is ours', () => {
  const ours = ['shown v3', 'v1', 'v2', 'v3'];
  for (const disk of ['v1', 'v2', 'v3', 'shown v3']) assert.equal(decideExternalChange({ disk, pending: true, ours }), 'ignore', disk);
});

check('an edit pending and the disk holds something else: ask', () => {
  assert.equal(decideExternalChange({ disk: 'theirs', pending: true, ours: ['mine'] }), 'ask');
  assert.equal(decideExternalChange({ disk: 'theirs', pending: true, ours: [] }), 'ask');
  assert.equal(decideExternalChange({ disk: '', pending: true, ours: ['mine', null, undefined] }), 'ask', 'an emptied file is a change too');
});

console.log(`external-change: ${checks} checks passed`);
