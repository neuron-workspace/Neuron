// What the terminal replays when a panel reattaches.
//
// The replay buffer exists so a panel that remounts does not show an empty
// pane. It made `cls` look broken: the shell cleared the screen, but the erased
// output was still in the buffer and came straight back on the next attach.
//
// The logic mirrors appendHistory in src/main/main.ts. It is duplicated rather
// than imported because main.ts pulls in electron and node-pty, neither of which
// loads outside an Electron process — and the rule this encodes is small enough
// that a copy is cheaper than the plumbing to share it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 200 * 1024;
const CLEARS_SCREEN = /\x1b\[[23]J|\x1bc/g;

function appendHistory(history, data) {
  let next = history + data;
  CLEARS_SCREEN.lastIndex = 0;
  let cut = -1;
  for (let m = CLEARS_SCREEN.exec(next); m; m = CLEARS_SCREEN.exec(next)) cut = m.index;
  if (cut >= 0) next = next.slice(cut);
  return next.length > LIMIT ? next.slice(-LIMIT) : next;
}

const ESC = '\x1b';
let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

check('ordinary output accumulates', () => {
  let h = '';
  h = appendHistory(h, 'first\r\n');
  h = appendHistory(h, 'second\r\n');
  assert.equal(h, 'first\r\nsecond\r\n');
});

check('erase-screen drops what came before it', () => {
  let h = appendHistory('', 'stale output\r\n');
  h = appendHistory(h, `${ESC}[2Jprompt> `);
  assert.ok(!h.includes('stale output'), 'cleared output must not survive');
  assert.ok(h.endsWith('prompt> '), 'what came after the clear is kept');
});

check('erase-scrollback drops what came before it', () => {
  const h = appendHistory('stale\r\n', `${ESC}[3Jfresh`);
  assert.ok(!h.includes('stale'));
  assert.ok(h.includes('fresh'));
});

check('a full reset drops what came before it', () => {
  const h = appendHistory('stale\r\n', `${ESC}cfresh`);
  assert.ok(!h.includes('stale'));
  assert.ok(h.includes('fresh'));
});

check('the last clear wins when several arrive at once', () => {
  const h = appendHistory('a', `${ESC}[2Jb${ESC}[2Jc`);
  assert.ok(!h.includes('a') && !h.includes('b'), 'only output after the final clear survives');
  assert.ok(h.endsWith('c'));
});

check('a bare letter c is not a reset', () => {
  // The first version of this matched /\x1b\[[23]J|c/ — a bare `c` — so every
  // word containing the letter truncated the scrollback.
  const h = appendHistory('', 'echo cascade\r\n');
  assert.equal(h, 'echo cascade\r\n');
});

check('a bare [2J without the escape is not a clear', () => {
  const h = appendHistory('kept\r\n', 'grep "[2J" file\r\n');
  assert.ok(h.startsWith('kept'), 'only the real control sequence clears');
});

check('the buffer stays within its limit', () => {
  const h = appendHistory('', 'x'.repeat(LIMIT + 5_000));
  assert.equal(h.length, LIMIT);
});

check('a clear resets the size, so the limit is not hit sooner', () => {
  let h = appendHistory('', 'y'.repeat(LIMIT));
  h = appendHistory(h, `${ESC}[2Jshort`);
  assert.ok(h.length < 100, 'a clear should shrink the buffer, not leave it full');
});

// The copy above has to stay in step with the original.
const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'main.ts'), 'utf-8');
check('main.ts still uses the sequences this file tests', () => {
  assert.match(main, /CLEARS_SCREEN\s*=\s*\/\\x1b\\\[\[23\]J\|\\x1bc\/g/,
    'the clear-sequence pattern in main.ts changed — update this test with it');
  assert.match(main, /TERMINAL_HISTORY_LIMIT\s*=\s*200 \* 1024/,
    'the history limit in main.ts changed — update this test with it');
});

console.log(`\nterminal-history: ${checks} checks passed`);
