// Run: node tools/terminal-bus.test.mjs
//
// The bus is small but has two properties worth pinning: a command queued
// before the terminal exists must still arrive, and a command must be one line.
// The second is a security property -- a <Run /> button shows its command to
// the reader, and a newline would let a note run a second command that the
// button never displayed.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-bus-'));
const file = join(out, 'bus.mjs');
await build({
  entryPoints: ['src/renderer/lib/terminal-bus.ts'],
  outfile: file,
  format: 'esm',
  bundle: true,
});
const bus = await import('file://' + file.replace(/\\/g, '/'));

// --- the single-line rule ----------------------------------------------------
assert.equal(bus.isRunnableCommand('code .'), true);
assert.equal(bus.isRunnableCommand('claude'), true);
assert.equal(bus.isRunnableCommand('  npm test  '), true, 'surrounding space is trimmed, not fatal');
assert.equal(bus.isRunnableCommand(''), false);
assert.equal(bus.isRunnableCommand('   '), false);
assert.equal(bus.isRunnableCommand('echo hi\nrm -rf .'), false, 'a newline would run a hidden second command');
assert.equal(bus.isRunnableCommand('echo hi\rrm -rf .'), false, 'a carriage return submits the line too');
assert.equal(bus.isRunnableCommand('echo \u0007bell'), false, 'control characters are refused');

// --- the queue ---------------------------------------------------------------
{
  const written = [];
  let opened = 0;
  bus.registerTerminalOpener(() => { opened++; });

  // Clicked before any terminal exists: the panel is asked to open and the
  // command waits rather than vanishing.
  bus.runInTerminal('first');
  assert.equal(opened, 1, 'a run reveals the terminal');
  assert.equal(written.length, 0, 'nothing is written before a terminal exists');

  const off = bus.registerTerminalWriter((d) => written.push(d));
  assert.deepEqual(written, ['first\r'], 'the queued command flushes on registration');

  bus.runInTerminal('second');
  assert.deepEqual(written, ['first\r', 'second\r'], 'later commands go straight through');

  // A refused command must not reach the terminal at all.
  bus.runInTerminal('bad\nsecond-line');
  assert.equal(written.length, 2, 'a multi-line command is dropped, not truncated');

  // After the panel closes, commands queue again instead of erroring.
  off();
  bus.runInTerminal('third');
  assert.equal(written.length, 2, 'nothing is written once the terminal is gone');
  bus.registerTerminalWriter((d) => written.push(d));
  assert.deepEqual(written.at(-1), 'third\r', 'and it arrives when a terminal comes back');
}

// --- overlapping terminal mounts -------------------------------------------
{
  const written = [];
  const offFirst = bus.registerTerminalWriter((d) => written.push(['first', d]));
  const offSecond = bus.registerTerminalWriter((d) => written.push(['second', d]));

  offFirst();
  bus.runInTerminal('shared-shell');
  assert.deepEqual(written, [['second', 'shared-shell\r']], 'an older mount cannot unregister the surviving writer');

  offSecond();
}

rmSync(out, { recursive: true, force: true });
console.log('terminal-bus: all checks passed');
