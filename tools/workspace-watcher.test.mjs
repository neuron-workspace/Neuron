import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const out = mkdtempSync(join(tmpdir(), 'neuron-watcher-test-'));
const bundle = join(out, 'workspace-watcher.cjs');
let checks = 0;
const check = async (what, fn) => {
  try { await fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
  console.log(`  ok  ${what}`);
};
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await delay(25);
  assert.ok(predicate(), message);
};
const remove = (target) => {
  assert.ok(resolve(target).startsWith(resolve(out) + sep));
  rmSync(target, { recursive: true, force: true });
};

try {
  await build({ entryPoints: ['src/main/workspace-watcher.ts'], outfile: bundle, format: 'cjs', bundle: true, platform: 'node', external: ['fsevents'] });
  const { watchWorkspace } = (await import(pathToFileURL(bundle).href)).default;
  const modes = process.platform === 'win32' || process.platform === 'darwin' ? [true, false] : [false];
  for (const useNative of modes) {
    const mode = useNative ? 'native' : 'chokidar';
    const dir = join(out, mode);
    const source = join(out, mode + '-source');
    mkdirSync(dir);
    mkdirSync(source);
    writeFileSync(join(source, 'one.md'), 'one');
    writeFileSync(join(source, 'two.bin'), 'two');
    const events = [];
    // What a listener reading the file at that moment would see.
    const contents = (path) => { try { return readFileSync(join(dir, path), 'utf8'); } catch { return null; } };
    const watcher = watchWorkspace(dir, (event, path) => events.push({ event, path, text: contents(path) }), { useNative });
    const has = (event, path) => events.some(e => e.event === event && e.path === path);
    const settle = async () => { await delay(400); events.length = 0; };
    try {
      // Chokidar has no public readiness signal through this wrapper.
      await delay(1000);
      await check(mode + ': create file emits add', async () => {
        writeFileSync(join(dir, 'note.md'), '');
        await waitFor(() => has('add', 'note.md'), JSON.stringify(events));
      });
      await settle();
      await check(mode + ': modify file emits a non-unlink event', async () => {
        writeFileSync(join(dir, 'note.md'), 'modified');
        await waitFor(() => events.some(e => e.path === 'note.md'), 'Missing modification');
        assert.ok(events.filter(e => e.path === 'note.md').every(e => e.event !== 'unlink'));
      });
      await settle();
      await check(mode + ': 20 rapid writes emit exactly one event', async () => {
        for (let i = 0; i < 20; i++) writeFileSync(join(dir, 'note.md'), String(i));
        await waitFor(() => events.length > 0, 'Missing debounced event');
        await delay(500);
        assert.equal(events.length, 1);
        assert.equal(events[0].path, 'note.md');
        assert.notEqual(events[0].event, 'unlink');
      });
      await settle();
      // An in-place rewrite is a truncate and then a write. Chokidar used to
      // report the truncate and drop the write, so a reader saw an empty file
      // and was never told about the finished one.
      await check(mode + ': a file rewritten in place is reported once it is whole', async () => {
        const fd = openSync(join(dir, 'note.md'), 'w');
        await delay(20);
        writeSync(fd, 'finished');
        closeSync(fd);
        await waitFor(() => events.some(e => e.path === 'note.md'), 'Missing rewrite event');
        await delay(500);
        const seen = events.filter(e => e.path === 'note.md');
        assert.equal(seen.at(-1).text, 'finished', JSON.stringify(seen));
      });
      await settle();
      await check(mode + ': delete file emits unlink', async () => {
        remove(join(dir, 'note.md'));
        await waitFor(() => has('unlink', 'note.md'), 'Missing file unlink');
      });
      await settle();
      await check(mode + ': copied folder emits add for both files', async () => {
        cpSync(source, join(dir, 'copied'), { recursive: true });
        await waitFor(() => has('add', 'copied/one.md') && has('add', 'copied/two.bin'), 'Missing copied files: ' + JSON.stringify(events));
        assert.ok(events.every(e => !e.path.includes('\\')));
      });
      await settle();
      await check(mode + ': removed folder emits directory or descendant unlinks', async () => {
        remove(join(dir, 'copied'));
        await waitFor(() => has('unlink', 'copied') || (has('unlink', 'copied/one.md') && has('unlink', 'copied/two.bin')), 'Missing folder unlink');
      });
      await settle();
      // A folder moved in or out (Explorer, Finder) is one rename of the folder,
      // with no events for the files inside it.
      await check(mode + ': folder moved in emits add for its files, moved out emits unlink', async () => {
        renameSync(source, join(dir, 'moved'));
        await waitFor(() => has('add', 'moved/one.md') && has('add', 'moved/two.bin'), 'Missing moved-in files: ' + JSON.stringify(events));
        await settle();
        renameSync(join(dir, 'moved'), source);
        await waitFor(() => has('unlink', 'moved') || (has('unlink', 'moved/one.md') && has('unlink', 'moved/two.bin')), 'Missing moved-out unlink: ' + JSON.stringify(events));
      });
      await settle();
      await check(mode + ': dotfolders are ignored', async () => {
        mkdirSync(join(dir, '.git'));
        writeFileSync(join(dir, '.git', 'x'), 'ignored');
        await delay(600);
        assert.deepEqual(events, []);
      });
      await check(mode + ': save temp files emit no events', async () => {
        const file = join(dir, 'note.md.123.456.abcdef.tmp');
        writeFileSync(file, 'temporary');
        await delay(600);
        writeFileSync(file, 'partial');
        await delay(600);
        remove(file);
        await delay(600);
        assert.deepEqual(events, []);
      });
      await check(mode + ': .neuron config is watched', async () => {
        mkdirSync(join(dir, '.neuron'));
        writeFileSync(join(dir, '.neuron', 'config.json'), '{}');
        await waitFor(() => events.some(e => e.path === '.neuron/config.json' && e.event !== 'unlink'), 'Missing config event');
      });
      await settle();
      await check(mode + ': close cancels pending and future callbacks', async () => {
        writeFileSync(join(dir, 'pending.md'), 'pending');
        if (useNative) await delay(30);
        watcher.close();
        events.length = 0;
        writeFileSync(join(dir, 'after-close.md'), 'closed');
        await delay(600);
        assert.deepEqual(events, []);
        watcher.close();
      });
    } finally {
      watcher.close();
    }
  }
  console.log(`\nworkspace-watcher: ${checks} checks passed`);
} finally {
  assert.ok(resolve(out).startsWith(resolve(tmpdir()) + sep));
  rmSync(out, { recursive: true, force: true });
}
