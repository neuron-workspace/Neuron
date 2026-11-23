// P0 prerequisites, on real files; no Electron or browser process.
import { build } from 'esbuild';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const { outputFiles } = await build({ stdin: { contents: `
  export * from './src/main/safe-fs';
  export * from './src/main/save-file';
  export * from './src/main/journal';
  export * from './src/main/file-protocol';
  export * from './src/main/htmx/trust';
  export * from './src/main/htmx/server';
  export * from './src/main/htmx/sessions';
  export * from './src/main/htmx/pathPolicy';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const scratch = fs.mkdtempSync(path.join(tmpdir(), 'neuron-safe-fs-'));
let sequence = 0, checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log(`  ok  ${name}`); }
  catch (error) { failures++; console.error(`  FAIL ${name}: ${error.message}`); }
  finally { m.setSafeFsTestHook(); }
}
function fixture() {
  const base = path.join(scratch, String(sequence++));
  const root = path.join(base, 'workspace'), outside = path.join(base, 'outside'), folder = path.join(root, 'folder');
  fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(outside);
  const file = path.join(folder, 'note.md');
  fs.writeFileSync(file, 'original'); fs.writeFileSync(path.join(outside, 'note.md'), 'outside secret');
  const journal = new m.WriteJournal(path.join(base, 'userData'), { reportError: () => {} });
  return { root, outside, folder, file, base, journal };
}
async function useHandle(root, file, mode = 'read') {
  const handle = await m.openSafe(root, file, mode);
  try {
    if (mode === 'write') { await handle.truncate(0); await handle.writeFile('incoming'); }
    else await handle.readFile();
  } finally { await handle.close(); }
}
function swap(f, phase, match = (file) => file.startsWith(f.folder + path.sep)) {
  let hit = false;
  m.setSafeFsTestHook((at, file) => {
    if (hit || at !== phase || !match(file)) return;
    // Windows can pin a directory while its child is open. Move that open
    // child first (its handle stays open), then swap the now-unpinned parent.
    const held = path.join(f.root, 'held-open-file');
    const relocate = process.platform === 'win32' && phase === 'after-open';
    if (relocate) fs.renameSync(file, held);
    fs.renameSync(f.folder, `${f.folder}-original`);
    fs.symlinkSync(f.outside, f.folder, process.platform === 'win32' ? 'junction' : 'dir');
    if (relocate) fs.renameSync(held, path.join(`${f.folder}-original`, path.basename(file)));
    hit = true;
  });
  return () => {
    assert.ok(hit, 'race hook must run');
    assert.equal(fs.readFileSync(path.join(f.outside, 'note.md'), 'utf8'), 'outside secret');
    assert.deepEqual(fs.readdirSync(f.outside), ['note.md'], 'nothing outside was created or deleted');
  };
}
try {
  for (const phase of ['before-open', 'after-open']) {
    await check(`async read refuses parent swap ${phase}`, async () => {
      const f = fixture(), verify = swap(f, phase);
      await assert.rejects(useHandle(f.root, f.file), /Unsafe/); verify();
    });
    await check(`sync read refuses parent swap ${phase}`, () => {
      const f = fixture(), verify = swap(f, phase);
      assert.throws(() => m.readSafeSync(f.root, f.file), /Unsafe/); verify();
    });
    await check(`handle write refuses parent swap ${phase}`, async () => {
      const f = fixture(), verify = swap(f, phase);
      await assert.rejects(useHandle(f.root, f.file, 'write'), /Unsafe/); verify();
      assert.equal(fs.readFileSync(path.join(`${f.folder}-original`, 'note.md'), 'utf8'), 'original');
    });
  }
  await check('unlink refuses a parent junction (a dir symlink off Windows) swapped before its final re-check', () => {
    const f = fixture(), verify = swap(f, 'before-path-check');
    assert.throws(() => m.unlinkSafeSync(f.root, f.file), /Unsafe/); verify();
  });
  if (process.platform !== 'win32') console.log('  skip Windows junction case: junctions exist only on Windows (the case above ran with a POSIX dir symlink)');
  // A file symlink: on Windows this needs Developer Mode or admin, so it is
  // tried and skipped (with the reason) only when the OS refuses to create one.
  let fileLinks = true;
  try { const probe = path.join(scratch, 'probe-link'); fs.symlinkSync(path.join(scratch, 'nowhere'), probe, 'file'); fs.unlinkSync(probe); }
  catch (error) { if (error.code !== 'EPERM') throw error; fileLinks = false; }
  if (!fileLinks) console.log('  skip final-file symlink swap: this Windows account may not create symlinks (EPERM)');
  else for (const phase of ['before-open', 'after-open']) for (const mode of ['read', 'write']) {
    await check(`final-file symlink swap ${phase} (${mode})`, async () => {
      const f = fixture(); let hit = false;
      m.setSafeFsTestHook((at, file) => {
        if (hit || at !== phase || file !== f.file) return;
        hit = true; fs.renameSync(file, `${file}.old`); fs.symlinkSync(path.join(f.outside, 'note.md'), file, 'file');
      });
      await assert.rejects(useHandle(f.root, f.file, mode), /Unsafe|ELOOP/);
      assert.ok(hit); assert.equal(fs.readFileSync(path.join(f.outside, 'note.md'), 'utf8'), 'outside secret');
    });
  }
  await check('a workspace opened through a link still works (root link is pinned, not refused)', async () => {
    const f = fixture();
    const linked = path.join(f.base, 'linked-workspace');
    fs.symlinkSync(f.root, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const lexical = path.join(linked, 'folder', 'note.md');
    // Lexical paths under the link (resolveInside) and real paths (resolveInWorkspace) both resolve.
    assert.equal(m.readSafeSync(linked, lexical).toString(), 'original');
    assert.equal(m.readSafeSync(linked, f.file).toString(), 'original');
    const handle = await m.openSafe(linked, lexical); await handle.close();
    await m.writeAtomically(lexical, 'saved', `${lexical}.tmp`, { root: linked });
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'saved');
    const capture = f.journal.capturePreImage(linked, lexical, 'overwrite');
    assert.equal(capture.status, 'captured');
    fs.writeFileSync(f.file, 'later');
    assert.equal(f.journal.restore(linked, capture.entry.id).success, true);
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'saved');
    // Retargeting the root link between check and use is still refused.
    let hit = false;
    m.setSafeFsTestHook((at) => {
      if (hit || at !== 'after-open') return;
      hit = true;
      fs.rmSync(linked, { recursive: false, force: true }); fs.mkdirSync(path.join(f.outside, 'folder'));
      fs.writeFileSync(path.join(f.outside, 'folder', 'note.md'), 'outside secret');
      fs.symlinkSync(f.outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    });
    assert.throws(() => m.readSafeSync(linked, lexical), /Unsafe/); assert.ok(hit);
  });
  await check('same-path inode replacement is refused even without a link', async () => {
    const f = fixture();
    m.setSafeFsTestHook((at, file) => { if (at === 'after-open') { fs.renameSync(file, `${file}.old`); fs.writeFileSync(file, 'replacement'); } });
    await assert.rejects(useHandle(f.root, f.file), /Unsafe/);
  });
  await check('rename rechecks source and destination before path use', async () => {
    const f = fixture(), verify = swap(f, 'before-path-check');
    await assert.rejects(m.renameSafe(f.root, f.file, path.join(f.folder, 'renamed.md')), /Unsafe/); verify();
  });
  await check('atomic rename refuses a swapped final target', async () => {
    const f = fixture(); let hit = false;
    m.setSafeFsTestHook((at, file) => {
      if (at === 'before-path-check' && file === f.file) {
        hit = true; fs.renameSync(file, `${file}.old`); fs.symlinkSync(f.outside, file, process.platform === 'win32' ? 'junction' : 'dir');
      }
    });
    await assert.rejects(m.writeAtomically(f.file, 'incoming', `${f.file}.tmp`, { root: f.root }), /Unsafe/);
    assert.ok(hit); assert.equal(fs.readFileSync(path.join(f.outside, 'note.md'), 'utf8'), 'outside secret');
  });
  await check('accepted post-check rename window reports destination verification failure', async () => {
    const f = fixture();
    const source = path.join(f.root, 'source.md'); fs.writeFileSync(source, 'incoming');
    // THE ACCEPTED WINDOW (P0-1 reviewer decision; see the ponytail comment at
    // the top of src/main/safe-fs.ts). Node's rename takes paths, so a parent
    // swapped for a junction AFTER the final re-check is followed and the file
    // lands outside. This is not prevented and not undone through the link;
    // the test asserts only that the post-rename verification reports it.
    swap(f, 'after-path-check');
    await assert.rejects(m.renameSafe(f.root, source, path.join(f.folder, 'renamed.md')), /destination verification FAILED/);
  });
  await check('media handler refuses a swap before streaming any bytes', async () => {
    const f = fixture(); fs.renameSync(f.file, path.join(f.folder, 'image.png'));
    const verify = swap(f, 'after-open');
    const result = await m.respondWithFile(new Request('neuron-file://w/1/token/folder%2Fimage.png'), () => ({ repo: f.root, token: 'token' }));
    assert.equal(result.status, 403); assert.equal(await result.text(), ''); verify();
  });
  await check('readTrusted refuses a swap even when outside bytes have the trusted hash', () => {
    const f = fixture(); fs.writeFileSync(f.file, 'outside secret');
    const trusted = new Map([['folder/note.md', m.sha256Bytes(Buffer.from('outside secret'))]]);
    const verify = swap(f, 'after-open');
    assert.equal(m.readTrusted(trusted, f.root, 'folder/note.md', 100), null); verify();
  });
  await check('journal capture refuses a swapped parent', () => {
    const f = fixture(), verify = swap(f, 'after-open');
    assert.equal(f.journal.capturePreImage(f.root, f.file, 'overwrite').status, 'failed'); verify();
    assert.deepEqual(f.journal.list(f.root), []);
  });
  await check('journal restore refuses a swapped parent before its temp write', () => {
    const f = fixture();
    const capture = f.journal.capturePreImage(f.root, f.file, 'overwrite');
    const verify = swap(f, 'before-open');
    assert.equal(f.journal.restore(f.root, capture.entry.id).success, false); verify();
  });
  for (const operation of ['read', 'update', 'delete']) await check(`htmx file ${operation} refuses a parent swap`, async () => {
    const f = fixture();
    const sessions = new m.SessionManager();
    const session = sessions.create({ root: f.root, name: 'test', theme: 'dark', viewPath: 'view.html', trusted: new Map(),
      caps: new Set(['workspace.files.read', 'workspace.files.write', 'workspace.files.delete']),
      readPolicy: [m.compileGlob('**')], writePolicy: [m.compileGlob('**')] });
    const server = await m.createViewServer(sessions, 'unused');
    m.configureWriteJournal(path.join(f.base, 'userData'), { reportError: () => {} });
    const verify = swap(f, operation === 'delete' ? 'before-path-check' : operation === 'update' ? 'before-open' : 'after-open',
      (file) => file.startsWith(f.folder + path.sep) && (operation !== 'update' || file.endsWith('.tmp')));
    try {
      const response = await fetch(`${server.origin}/api/v1/${operation === 'delete' ? 'files' : 'files/content'}?path=folder%2Fnote.md`, {
        method: operation === 'read' ? 'GET' : operation === 'update' ? 'PUT' : 'DELETE',
        headers: { cookie: `nv=${session.id}:${session.cookieToken}`, 'content-type': 'application/json' },
        ...(operation === 'update' ? { body: JSON.stringify({ path: 'folder/note.md', content: 'incoming' }) } : {}),
      });
      assert.ok(response.status >= 400, `got ${response.status}`);
      assert.ok(!(await response.text()).includes('outside secret')); verify();
    } finally { server.close(); }
  });
  for (const reason of ['size', 'store', 'budget']) await check(`required capture failure (${reason}) preserves original and writes conflict`, async () => {
    const f = fixture();
    const blocked = path.join(f.base, 'blocked'); fs.writeFileSync(blocked, 'not a directory');
    const journal = new m.WriteJournal(reason === 'store' ? path.join(blocked, 'userData') : path.join(f.base, 'userData'), {
      writerLimits: reason === 'size' ? { maxFileBytes: 2 } : reason === 'budget' ? { maxTotalBytes: 2 } : {}, reportError: () => {}, now: () => 1700000000000,
    });
    assert.equal(journal.capturePreImage(f.root, f.file, 'overwrite', { required: true, writer: 'sync' }).status, 'failed');
    const first = await journal.writeUnattended(f.root, f.file, Buffer.from([0, 255, 128]), 'Laptop');
    assert.equal(first.conflict, true); assert.match(path.basename(first.path), /^note \(conflict Laptop .+\)\.md$/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'original'); assert.deepEqual(fs.readFileSync(first.path), Buffer.from([0, 255, 128]));
    const second = await journal.writeUnattended(f.root, f.file, 'second', 'Laptop');
    assert.notEqual(second.path, first.path); assert.deepEqual(fs.readFileSync(first.path), Buffer.from([0, 255, 128]));
  });
  await check('required captures bypass typing coalescing and successful unattended writes retain pre-images', async () => {
    const f = fixture();
    f.journal.capturePreImage(f.root, f.file, 'overwrite');
    fs.writeFileSync(f.file, 'edited');
    const result = await f.journal.writeUnattended(f.root, f.file, 'incoming', 'Laptop');
    assert.equal(result.conflict, false); assert.equal(fs.readFileSync(f.file, 'utf8'), 'incoming');
    const entries = f.journal.list(f.root); assert.equal(entries.length, 2);
    const sync = entries.find((e) => e.writer === 'sync'); assert.ok(sync);
    assert.equal(f.journal.restore(f.root, sync.id).success, true); assert.equal(fs.readFileSync(f.file, 'utf8'), 'edited');
  });
  await check('required capture cannot coalesce away the current pre-image', () => {
    const f = fixture();
    f.journal.capturePreImage(f.root, f.file, 'overwrite', { writer: 'sync' });
    fs.writeFileSync(f.file, 'next pre-image');
    const capture = f.journal.capturePreImage(f.root, f.file, 'overwrite', { required: true, writer: 'sync' });
    assert.equal(capture.status, 'captured');
    assert.equal(f.journal.list(f.root).length, 2);
    assert.equal(f.journal.restore(f.root, capture.entry.id).success, true);
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'next pre-image');
  });
  for (const cap of ['count', 'bytes', 'age']) await check(`writer ${cap} retention is independent in both directions`, () => {
    const f = fixture(); let now = 100000;
    const writerLimits = { coalesceMs: 0, maxEntries: cap === 'count' ? 2 : 100, maxTotalBytes: cap === 'bytes' ? 16 : 10000, maxAgeMs: cap === 'age' ? 3 : 10000 };
    const journal = new m.WriteJournal(path.join(f.base, 'budgetData'), { limits: { coalesceMs: 0, maxEntries: 2, maxTotalBytes: 1000, maxAgeMs: 10000 }, writerLimits, now: () => now, reportError: () => {} });
    const user = journal.capturePreImage(f.root, f.file, 'overwrite').entry;
    for (let i = 0; i < 6; i++) { now++; journal.capturePreImage(f.root, f.file, 'overwrite', { writer: 'sync', required: true }); }
    const entries = journal.list(f.root);
    assert.ok(entries.some((e) => e.id === user.id));
    const auto = entries.filter((e) => e.writer);
    assert.equal(auto.length, cap === 'age' ? 4 : 2);
    for (let i = 0; i < 5; i++) journal.capturePreImage(f.root, f.file, 'overwrite');
    assert.deepEqual(journal.list(f.root).filter((e) => e.writer).map((e) => e.id).sort(), auto.map((e) => e.id).sort());
  });
  await check('trash captures first, refuses absent/failing trash, and never unlinks as fallback', async () => {
    const f = fixture();
    assert.equal((await f.journal.deleteUnattended(f.root, f.file)).success, false);
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'original');
    assert.deepEqual(f.journal.list(f.root), [], 'no trash: refused before any capture');
    assert.equal((await f.journal.deleteUnattended(f.root, f.file, async () => { throw new Error('unavailable'); })).success, false);
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'original');
    let called = false;
    const result = await f.journal.deleteUnattended(f.root, f.file, async (file) => {
      called = true;
      assert.ok(f.journal.list(f.root).some((e) => e.writer === 'sync' && e.operation === 'delete'));
      fs.renameSync(file, path.join(f.base, 'fake-trash'));
    });
    assert.ok(called); assert.equal(result.success, true); assert.equal(fs.existsSync(f.file), false);
    assert.equal(fs.readFileSync(path.join(f.base, 'fake-trash'), 'utf8'), 'original');
  });
  await check('trash is never called after required capture fails', async () => {
    const f = fixture(); const j = new m.WriteJournal(path.join(f.base, 'ud'), { writerLimits: { maxFileBytes: 1 }, reportError: () => {} });
    let called = false;
    assert.equal((await j.deleteUnattended(f.root, f.file, async () => { called = true; })).success, false);
    assert.equal(called, false);
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'original');
  });
  await check('trash rechecks the path after capture', async () => {
    const f = fixture(), verify = swap(f, 'before-path-check');
    let called = false;
    assert.equal((await f.journal.deleteUnattended(f.root, f.file, async () => { called = true; })).success, false);
    assert.equal(called, false); verify();
  });
} finally { m.setSafeFsTestHook(); fs.rmSync(scratch, { recursive: true, force: true }); }
console.log(`safe-fs / unattended journal: ${checks} passed, ${failures} failed`);
assert.equal(failures, 0);
