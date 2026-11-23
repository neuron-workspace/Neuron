// Runnable check for src/main/save-file.ts (how notes:write puts text on
// disk): bundle with esbuild, then drive it with an in-memory file system.
// Run: node tools/save-file.test.mjs
import { build } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(tmpdir(), 'neuron-save-file-'));
let checks = 0;
const check = async (what, fn) => {
  try { await fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
  console.log(`  ok  ${what}`);
};

/** A file system in memory. `onRename` decides each rename: throw, wait, or let it through. */
function memoryFs({ onRename = async () => {}, onWrite = async () => {} } = {}) {
  const files = new Map();
  const calls = [];
  return {
    files,
    calls,
    io: {
      open: async (file) => ({
        writeFile: async (content) => { calls.push(['write', file]); await onWrite(file, content); files.set(file, content); },
        truncate: async () => {},
        sync: async () => { calls.push(['fsync', file]); },
        close: async () => {},
      }),
      syncDirectory: async (directory) => { calls.push(['fsync-directory', directory]); },
      rename: async (from, to) => {
        calls.push(['rename', from, to]);
        await onRename(from, to);
        if (!files.has(from)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        files.set(to, files.get(from));
        files.delete(from);
      },
      unlink: async (file) => {
        calls.push(['unlink', file]);
        if (!files.delete(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    },
  };
}
const busy = (code = 'EPERM') => Object.assign(new Error(code), { code });
const temps = (files) => [...files.keys()].filter((file) => file.endsWith('.tmp'));

try {
  const { outputFiles } = await build({ entryPoints: [path.join(root, 'src/main/save-file.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
  const modulePath = path.join(temp, 'save-file.mjs');
  fs.writeFileSync(modulePath, outputFiles[0].text);
  const { writeAtomically, createSaveQueue, saveKey, RENAME_ATTEMPTS } = await import(pathToFileURL(modulePath));
  const noWait = async () => {};

  await check('binary writes round trip every byte value', async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, n) => n));
    const file = path.join(temp, 'binary.bin');
    await writeAtomically(file, bytes, `${file}.tmp`, { noInPlaceFallback: true });
    assert.deepEqual(fs.readFileSync(file), bytes);
  });

  await check('required atomic rename failure never truncates the old file', async () => {
    const { files, io } = memoryFs({ onRename: async () => { throw busy(); } });
    files.set('note.md', 'old');
    await assert.rejects(writeAtomically('note.md', Buffer.from('new'), 'note.md.tmp', { io, noInPlaceFallback: true }, noWait), /EPERM/);
    assert.equal(files.get('note.md'), 'old');
    assert.deepEqual(temps(files), []);
  });

  await check('temp fsync precedes rename and directory fsync follows it', async () => {
    const { calls, io } = memoryFs();
    await writeAtomically('note.md', 'new', 'note.md.tmp', io, noWait);
    assert.deepEqual(calls.map(([op]) => op), ['write', 'fsync', 'rename', 'fsync-directory', 'unlink']);
  });

  await check('a failed temp fsync leaves the old file and removes the temp', async () => {
    const { files, io } = memoryFs();
    const open = io.open;
    io.open = async (...args) => ({ ...await open(...args), sync: async () => { throw busy('EIO'); } });
    files.set('note.md', 'old');
    await assert.rejects(writeAtomically('note.md', 'new', 'note.md.tmp', io, noWait), /EIO/);
    assert.equal(files.get('note.md'), 'old');
    assert.deepEqual(temps(files), []);
  });

  await check('a save goes through a temporary file that is gone afterwards', async () => {
    const { files, io, calls } = memoryFs();
    await writeAtomically('note.md', 'text', 'note.md.1.tmp', io, noWait);
    assert.equal(files.get('note.md'), 'text');
    assert.deepEqual(temps(files), []);
    assert.deepEqual(calls.map(([op]) => op), ['write', 'fsync', 'rename', 'fsync-directory', 'unlink']);
  });

  await check('a rename held for a moment is retried after an awaited wait, then lands', async () => {
    let failures = 2;
    const { files, io } = memoryFs({ onRename: async () => { if (failures-- > 0) throw busy('EBUSY'); } });
    const waits = [];
    await writeAtomically('note.md', 'retried', 'note.md.2.tmp', io, async (ms) => { waits.push(ms); });
    assert.equal(files.get('note.md'), 'retried');
    assert.deepEqual(waits, [15, 30]);
    assert.deepEqual(temps(files), []);
  });

  await check('a rename still held after every attempt writes in place, and the temp file is gone', async () => {
    let renames = 0;
    const { files, io } = memoryFs({ onRename: async () => { renames++; throw busy('EACCES'); } });
    const waits = [];
    files.set('note.md', 'old');
    await writeAtomically('note.md', 'in place', 'note.md.3.tmp', io, async (ms) => { waits.push(ms); });
    assert.equal(renames, RENAME_ATTEMPTS);
    assert.equal(RENAME_ATTEMPTS, 6);
    assert.deepEqual(waits, [15, 30, 45, 60, 75], 'at most 225 ms, awaited');
    assert.equal(files.get('note.md'), 'in place');
    assert.deepEqual(temps(files), []);
  });

  await check('any other rename error fails the save and still removes the temp file', async () => {
    const { files, io } = memoryFs({ onRename: async () => { throw busy('ENOSPC'); } });
    files.set('note.md', 'old');
    await assert.rejects(writeAtomically('note.md', 'new', 'note.md.4.tmp', io, noWait), /ENOSPC/);
    assert.equal(files.get('note.md'), 'old');
    assert.deepEqual(temps(files), []);
  });

  await check('a failed write of the temp file fails the save and removes what was written of it', async () => {
    const { files, io } = memoryFs({ onWrite: async (file) => { files.set(file, 'partial'); throw busy('ENOSPC'); } });
    await assert.rejects(writeAtomically('note.md', 'new', 'note.md.5.tmp', io, noWait), /ENOSPC/);
    assert.equal(files.has('note.md'), false);
    assert.deepEqual(temps(files), []);
  });

  await check('a failed in-place fallback fails the save and removes the temp file', async () => {
    const { files, io } = memoryFs({
      onRename: async () => { throw busy(); },
      onWrite: async (file) => { if (!file.endsWith('.tmp')) throw busy('EROFS'); },
    });
    await assert.rejects(writeAtomically('note.md', 'new', 'note.md.6.tmp', io, noWait), /EROFS/);
    assert.deepEqual(temps(files), []);
  });

  // The ordering bug 2B fixes. Save one waits out a held rename; save two of
  // the same file lands meanwhile; save one then renames its OLDER text over it.
  const overlapping = async (queued) => {
    let releaseFirst;
    const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
    let first = true;
    const { files, io } = memoryFs({
      onRename: async (from) => {
        if (from === 'note.md.one.tmp' && first) { first = false; await firstHeld; throw busy(); }
      },
    });
    const queue = createSaveQueue();
    const run = (text) => {
      const save = () => writeAtomically('note.md', text, `note.md.${text}.tmp`, io, noWait);
      return queued ? queue(saveKey('note.md'), save) : save();
    };
    const one = run('one');
    const two = run('two');
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseFirst();
    await Promise.all([one, two]);
    return { text: files.get('note.md'), temps: temps(files) };
  };

  await check('without the queue, overlapping saves can leave the older text on disk', async () => {
    assert.equal((await overlapping(false)).text, 'one');
  });

  await check('with the queue, overlapping saves of one file end with the newer text', async () => {
    const { text, temps: left } = await overlapping(true);
    assert.equal(text, 'two');
    assert.deepEqual(left, []);
  });

  await check('the queue runs one file\'s saves in call order, and a failure does not stop the next', async () => {
    const queue = createSaveQueue();
    const order = [];
    const task = (name, ms, fail = false) => () => new Promise((resolve, reject) => setTimeout(() => {
      order.push(name);
      if (fail) reject(new Error(name)); else resolve(name);
    }, ms));
    const results = await Promise.allSettled([
      queue('a', task('a1', 30)),
      queue('a', task('a2', 1, true)),
      queue('a', task('a3', 1)),
      queue('b', task('b1', 1)),
    ]);
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    assert.equal(results[2].value, 'a3');
    assert.deepEqual(order.filter((name) => name.startsWith('a')), ['a1', 'a2', 'a3']);
    assert.ok(order.indexOf('b1') < order.indexOf('a1'), 'another file is not held up');
  });

  await check('one file however its name is cased, where the file system ignores case', async () => {
    assert.equal(saveKey('C:\\W\\Note.md', 'win32'), saveKey('c:\\w\\note.md', 'win32'));
    assert.equal(saveKey('/w/Note.md', 'darwin'), saveKey('/w/note.md', 'darwin'));
    assert.notEqual(saveKey('/w/Note.md', 'linux'), saveKey('/w/note.md', 'linux'));
  });

  await check('on a real disk: the file holds the text and no temp file is left', async () => {
    const file = path.join(temp, 'real.md');
    fs.writeFileSync(file, 'old');
    await writeAtomically(file, 'naïve — 日本語\r\n', `${file}.1.2.abc.tmp`);
    assert.equal(fs.readFileSync(file, 'utf8'), 'naïve — 日本語\r\n');
    assert.deepEqual(fs.readdirSync(temp).filter((name) => name.endsWith('.tmp')), []);
  });

  await check('notes:write no longer freezes the main process with Atomics.wait', () => {
    const main = fs.readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
    assert.ok(!main.includes('Atomics.wait'));
    assert.match(main, /saveQueue\(saveKey\(resolved\.fullPath\)/);
  });

  console.log(`save-file: ${checks} checks passed`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
