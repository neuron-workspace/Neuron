// Run: node tools/file-writer.test.mjs
// R1: useFileWriter (src/renderer/components/db/table-kit.tsx), the writer
// every table uses, rendered with react-dom on a linkedom document against a
// fake bridge. Covers what a table embedded in a page now does:
//   - its saves carry the version they were based on, and main's refusal
//     (an outside change while the save was on its way) raises the conflict;
//   - an outside change to an edit not yet on disk raises it too;
//   - Keep my version sends the edit again based on the file as it is now,
//     Use the file on disk adopts the disk;
//   - two embeds of one file share one writer: an edit in one shows in the
//     other at once, neither takes the other's save for an outside change, and
//     both show the same conflict.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

const root = process.cwd();
let checks = 0;
const check = async (what, fn) => {
  try { await fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
  console.log(`  ok  ${what}`);
};
const sha = (text) => createHash('sha256').update(text, 'utf-8').digest('hex');

const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The bridge: one file on disk, its watcher, and every write asked of main.
const disk = new Map();
const watchers = new Set();
const writes = [];
let answer = (file, text) => { disk.set(file, text); return { success: true }; };
window.electronAPI = {
  readNote: async (file) => (disk.has(file) ? disk.get(file) : 'Error: missing'),
  writeNote: async (file, text, base) => { writes.push({ file, text, base }); return answer(file, text, base); },
  onNotesChanged: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
};

const outfile = path.join(root, 'tools/.file-writer.tmp.cjs');
await build({ stdin: { contents: `export { useFileWriter } from './src/renderer/components/db/table-kit';`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', outfile, logLevel: 'silent', tsconfig: path.join(root, 'tsconfig.json') });
let useFileWriter;
try { ({ useFileWriter } = createRequire(import.meta.url)(outfile)); } finally { rmSync(outfile, { force: true }); }
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const FILE = 'Planner.db';
const writers = {};
const shown = {};
function Embed({ id, perFile = true }) {
  writers[id] = useFileWriter(FILE, (text) => { shown[id] = text; }, { askOnConflict: true, perFile });
  return null;
}
async function mount(...embeds) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => { rootNode.render(React.createElement(React.Fragment, null, ...embeds.map((props) => React.createElement(Embed, { key: props.id, ...props })))); });
  return rootNode;
}
const changeOnDisk = async (text) => {
  disk.set(FILE, text);
  await act(async () => { for (const fn of [...watchers]) fn('change', FILE); });
  await settle();
};

await check('two embeds of one file share one writer: an edit in one shows in the other, and its save is no outside change', async () => {
  disk.set(FILE, 'v0');
  const page = await mount({ id: 'a' }, { id: 'b' });
  writers.a.loaded('v0');
  await act(async () => { await writers.a.write('v1'); });
  assert.equal(shown.b, 'v1', 'the other embed shows the edit at once');
  assert.equal(shown.a, undefined, 'the embed that made it is not told its own edit');
  assert.deepEqual(writes.at(-1), { file: FILE, text: 'v1', base: sha('v0') }, 'the save carries the version it was based on');
  await changeOnDisk('v1'); // our own save coming back through the watcher
  assert.equal(writers.a.conflict, false);
  assert.equal(writers.b.conflict, false);
  // An edit in the other embed is based on the first one's save.
  await act(async () => { await writers.b.write('v2'); });
  assert.equal(writes.at(-1).base, sha('v1'));
  assert.equal(shown.a, 'v2');
  await act(async () => page.unmount());
});

await check('main refuses a save that would write over an outside change: the bar shows in every embed, not a save error', async () => {
  disk.set(FILE, 'v0');
  const page = await mount({ id: 'a' }, { id: 'b' });
  writers.a.loaded('v0');
  disk.set(FILE, 'theirs'); // changed outside before the save reached main
  answer = (file, text, base) => {
    if (base && sha(disk.get(file)) !== base) return { success: false, conflict: true, error: 'This file changed outside Neuron.' };
    disk.set(file, text);
    return { success: true };
  };
  await act(async () => { await writers.a.write('mine'); });
  assert.equal(disk.get(FILE), 'theirs', 'nothing written over it');
  assert.equal(writers.a.conflict, true);
  assert.equal(writers.b.conflict, true, 'one writer per file: the other embed shows it too');
  assert.equal(writers.a.saveError, null);
  // Nothing more is written while the user has not chosen.
  const before = writes.length;
  await act(async () => { await writers.a.write('mine, edited'); });
  assert.equal(writes.length, before);
  // Keep my version: sent again based on the file as it is now, and written.
  await act(async () => { await writers.b.keepMine(); });
  await settle();
  assert.deepEqual(writes.at(-1), { file: FILE, text: 'mine, edited', base: sha('theirs') });
  assert.equal(disk.get(FILE), 'mine, edited');
  assert.equal(writers.a.conflict, false);
  assert.equal(writers.b.conflict, false);
  await act(async () => page.unmount());
});

await check('an outside change to an edit not yet on disk asks; Use the file on disk adopts it in every embed', async () => {
  disk.set(FILE, 'v0');
  const page = await mount({ id: 'a' }, { id: 'b' });
  writers.a.loaded('v0');
  // The save hangs in main; meanwhile another program changes the file.
  let release;
  answer = () => new Promise((resolve) => { release = () => resolve({ success: false, conflict: true, error: 'This file changed outside Neuron.' }); });
  let pending;
  await act(async () => { pending = writers.a.write('mine'); });
  await changeOnDisk('theirs');
  assert.equal(writers.a.conflict, true, 'asked, not adopted');
  assert.equal(writers.b.conflict, true);
  assert.notEqual(shown.a, 'theirs');
  await act(async () => { release(); await pending; });
  await act(async () => { await writers.a.takeDisk(); });
  assert.equal(shown.a, 'theirs');
  assert.equal(shown.b, 'theirs');
  assert.equal(writers.a.conflict, false);
  assert.equal(writers.b.conflict, false);
  await act(async () => page.unmount());
});

await check('a writer that cannot ask (no askOnConflict) sends no base, so main compares nothing', async () => {
  answer = (file, text) => { disk.set(file, text); return { success: true }; };
  function Plain() { writers.plain = useFileWriter('meta.json'); return null; }
  const container = document.createElement('div');
  const rootNode = createRoot(container);
  await act(async () => { rootNode.render(React.createElement(Plain)); });
  await act(async () => { await writers.plain.write('{}'); });
  assert.deepEqual(writes.at(-1), { file: 'meta.json', text: '{}', base: undefined });
  await act(async () => rootNode.unmount());
});

await check('the embedded table uses this writer, one per file, and shows the external-change bar', () => {
  const view = readFileSync(path.join(root, 'src/renderer/components/DbView.tsx'), 'utf8');
  assert.match(view, /useFileWriter\(rel, show, \{ askOnConflict: true, perFile: true \}\)/);
  assert.ok(view.includes('<ExternalChangeBar path={rel} onKeepMine={() => { void writer.keepMine(); }} onUseDisk={() => { void writer.takeDisk(); }} />'));
});

console.log(`file-writer: ${checks} checks passed`);
