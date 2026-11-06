// Runnable check for src/renderer/lib/terminal-resize.ts: the shell hears about
// a size once, after a burst settles, and never about a hidden panel.
// Run: node tools/terminal-resize.test.mjs
import { transform } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'src/renderer/lib/terminal-resize.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const temp = fs.mkdtempSync(path.join(tmpdir(), 'neuron-terminal-resize-'));
try {
  const tmp = path.join(temp, 'terminal-resize.mjs');
  fs.writeFileSync(tmp, code);
  const { createResizeSync } = await import(pathToFileURL(tmp));

  // A manual clock: timers run only when `tick` says so.
  const make = () => {
    let queue = [];
    const sent = [];
    const sync = createResizeSync((c, r) => sent.push(`${c}x${r}`), 60, {
      set: (fn) => { const h = { fn }; queue.push(h); return h; },
      clear: (h) => { queue = queue.filter((x) => x !== h); },
    });
    const tick = () => { const run = queue; queue = []; run.forEach((h) => h.fn()); };
    return { sync, sent, tick, pending: () => queue.length };
  };

  { // A burst sends only the final size, once.
    const { sync, sent, tick } = make();
    for (const cols of [80, 81, 82, 90, 100]) sync.request(cols, 24);
    assert.deepEqual(sent, []);
    tick();
    assert.deepEqual(sent, ['100x24']);
  }
  { // The same size again sends nothing: no pointless prompt redraw.
    const { sync, sent, tick } = make();
    sync.request(100, 24); tick();
    sync.request(100, 24); tick();
    assert.deepEqual(sent, ['100x24']);
  }
  { // A hidden panel measures 0x0; that is not a size to give a shell.
    const { sync, sent, tick, pending } = make();
    sync.request(0, 0);
    sync.request(-1, 24);
    assert.equal(pending(), 0);
    tick();
    assert.deepEqual(sent, []);
  }
  { // Spawned at a size: no resize to it, but a later change still goes through.
    const { sync, sent, tick } = make();
    sync.markSent(120, 30);
    sync.request(120, 30); tick();
    assert.deepEqual(sent, []);
    sync.request(100, 30); tick();
    assert.deepEqual(sent, ['100x30']);
  }
  { // Hidden then shown at the old size: nothing changed, nothing sent.
    const { sync, sent, tick } = make();
    sync.request(100, 24); tick();
    sync.request(0, 0); sync.request(100, 24); tick();
    assert.deepEqual(sent, ['100x24']);
  }
  { // Disposed: a pending resize never fires into a torn-down pty.
    const { sync, sent, tick } = make();
    sync.request(90, 20);
    sync.dispose();
    tick();
    assert.deepEqual(sent, []);
  }

  console.log('terminal-resize: all checks passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
