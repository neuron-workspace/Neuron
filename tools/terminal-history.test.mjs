// What the terminal replays when a panel reattaches.
//
// The replay buffer exists so a panel that remounts does not show an empty
// pane. It made `cls` look broken: the shell cleared the screen, but the erased
// output was still in the buffer and came straight back on the next attach.
//
// Exercise the production helper without loading Electron or node-pty.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const LIMIT = 200 * 1024;
const bundle = await build({ entryPoints: ['src/main/terminal-history.ts'], bundle: true, format: 'esm', write: false });
const { appendHistory } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

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
  const full = 'x'.repeat(LIMIT - 6) + 'newest';
  assert.equal(appendHistory('', full), full, 'exactly at the cap is retained');
  assert.equal(appendHistory('o', full), full, 'one over discards the oldest output');
  assert.equal(appendHistory('old'.repeat(LIMIT), full), full, 'large output keeps the newest output');
});

check('a clear resets the size, so the limit is not hit sooner', () => {
  let h = appendHistory('', 'y'.repeat(LIMIT));
  h = appendHistory(h, `${ESC}[2Jshort`);
  assert.ok(h.length < 100, 'a clear should shrink the buffer, not leave it full');
});

check('clear sequences split across chunks still cut the replay', () => {
  for (const clear of [`${ESC}[2J`, `${ESC}[3J`, `${ESC}c`]) {
    for (let split = 1; split < clear.length; split++) {
      assert.equal(appendHistory(appendHistory('stale', clear.slice(0, split)), clear.slice(split) + 'fresh'), clear + 'fresh');
    }
  }
});

console.log(`\nterminal-history: ${checks} checks passed`);
