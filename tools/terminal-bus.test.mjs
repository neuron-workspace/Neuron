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

const hidden = [0x00, 0x09, 0x0a, 0x0d, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  0x200e, 0x200f, 0x061c, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff];
for (const point of hidden) {
  const char = String.fromCodePoint(point);
  for (const command of [`echo ${char}safe`, `${char}echo safe`, `echo safe${char}`]) {
    assert.equal(bus.isRunnableCommand(command), false, `refuse U+${point.toString(16)}`);
  }
}
for (const command of ['echo café', 'echo 中文', 'echo 😀']) assert.equal(bus.isRunnableCommand(command), true);
// Neighbours of the refused ranges are ordinary text.
for (const point of [0x7e, 0xa0, 0xe9, 0x200a, 0x2010, 0x202f, 0x2065, 0x206a, 0xfefe, 0xff01]) {
  assert.equal(bus.isRunnableCommand(`echo a${String.fromCodePoint(point)}b`), true, `allow U+${point.toString(16)}`);
}
for (const value of [null, undefined, 42, {}]) assert.equal(bus.isRunnableCommand(value), false, 'only strings run');
assert.equal(bus.HIDDEN_CHARS_REFUSAL, "This command contains hidden characters and won't run.");

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

// Automations use the visible terminal and retain order even before it mounts.
{
  const written = [];
  let opened = 0;
  const close = bus.registerTerminalOpener(() => { opened++; });
  assert.equal(bus.runAutomationInTerminal(['echo first', 'echo second', 'echo third']), true);
  assert.equal(opened, 3);
  assert.deepEqual(written, [], 'cold-start commands wait for readiness');
  const off = bus.registerTerminalWriter((data) => written.push(data));
  assert.deepEqual(written, ['echo first\r', 'echo second\r', 'echo third\r']);
  assert.equal(bus.runAutomationInTerminal(['echo safe', 'hidden\rcommand']), false);
  assert.equal(written.length, 3, 'an invalid sequence never partially runs');
  off(); close();
}

// Refused sequences neither open the panel nor leave anything in its queue.
for (const ready of [false, true]) {
  const written = [];
  let opened = 0;
  const close = bus.registerTerminalOpener(() => { opened++; });
  let off = ready ? bus.registerTerminalWriter((data) => written.push(data)) : null;
  for (const bad of ['', '   ', null, ...hidden.map((point) => `echo ${String.fromCodePoint(point)}bad`)]) {
    assert.equal(bus.runAutomationInTerminal(['echo before', bad, 'echo after']), false);
    if (typeof bad === 'string') bus.runInTerminal(bad);
  }
  assert.equal(bus.runAutomationInTerminal([]), false);
  assert.equal(opened, 0);
  off ??= bus.registerTerminalWriter((data) => written.push(data));
  assert.deepEqual(written, []);
  off(); close();
}

rmSync(out, { recursive: true, force: true });
console.log('terminal-bus: all checks passed');
