// Runnable check for src/renderer/lib/external-change.ts: what an open file
// does when it changes on disk while an edit may be pending.
// Run: node tools/external-change.test.mjs
import { transform } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'src/renderer/lib/external-change.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const { decideExternalChange, contentHash, createSaveSender } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let checks = 0;
const check = async (what, fn) => {
  try { await fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
  console.log(`  ok  ${what}`);
};

await check('R1: the base a save sends is what main hashes for the same text', async () => {
  for (const text of ['', 'abc', 'naïve — 日本語\r\n', '﻿# BOM', 'x'.repeat(100_000)]) {
    assert.equal(await contentHash(text), createHash('sha256').update(text, 'utf-8').digest('hex'), JSON.stringify(text.slice(0, 20)));
  }
  assert.equal(await contentHash(null), undefined, 'no known version: no base');
  assert.equal(await contentHash(undefined), undefined);
});

await check('R1: a file\'s saves reach main in the order they were made, however long each base takes to hash', async () => {
  // The first base hashes slowly, the second at once: sent as hashed, the
  // second save would reach main first and the older text land last.
  const releases = [];
  const slowFirst = (text) => new Promise((resolve) => { if (text === 'slow') releases.push(() => resolve('h-slow')); else resolve(text ? `h-${text}` : undefined); });
  const send = createSaveSender(slowFirst);
  const order = [];
  const first = send('a.md', 'slow', (base) => { order.push(['one', base]); return Promise.resolve(1); });
  const second = send('a.md', 'quick', (base) => { order.push(['two', base]); return Promise.resolve(2); });
  const other = send('b.md', null, (base) => { order.push(['other', base]); return Promise.resolve(3); });
  await other;
  assert.deepEqual(order, [['other', undefined]], 'another file is not held up');
  releases.forEach((release) => release());
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, [['other', undefined], ['one', 'h-slow'], ['two', 'h-quick']]);
  // A failed send does not stop the next.
  const failed = send('a.md', 'x', () => Promise.reject(new Error('gone')));
  await assert.rejects(failed, /gone/);
  assert.equal(await send('a.md', 'y', () => Promise.resolve('next')), 'next');
});

await check('no edit pending: the outside version replaces what is shown', () => {
  assert.equal(decideExternalChange({ disk: 'theirs', pending: false, ours: [] }), 'replace');
  assert.equal(decideExternalChange({ disk: 'theirs', pending: false, ours: ['mine'] }), 'replace');
  // Even text we wrote earlier: with nothing pending, the disk is the truth.
  assert.equal(decideExternalChange({ disk: 'mine', pending: false, ours: ['mine'] }), 'replace');
});

await check('an edit pending and the disk holds what we last wrote: our own echo, ignored', () => {
  assert.equal(decideExternalChange({ disk: 'mine', pending: true, ours: ['mine'] }), 'ignore');
});

await check('typing saves several versions in a row; an echo of any of them is ours', () => {
  const ours = ['shown v3', 'v1', 'v2', 'v3'];
  for (const disk of ['v1', 'v2', 'v3', 'shown v3']) assert.equal(decideExternalChange({ disk, pending: true, ours }), 'ignore', disk);
});

await check('an edit pending and the disk holds something else: ask', () => {
  assert.equal(decideExternalChange({ disk: 'theirs', pending: true, ours: ['mine'] }), 'ask');
  assert.equal(decideExternalChange({ disk: 'theirs', pending: true, ours: [] }), 'ask');
  assert.equal(decideExternalChange({ disk: '', pending: true, ours: ['mine', null, undefined] }), 'ask', 'an emptied file is a change too');
});

console.log(`external-change: ${checks} checks passed`);
