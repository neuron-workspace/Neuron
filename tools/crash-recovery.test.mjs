// A latched crash stops all further I/O, including finally-block cleanup. This
// models process interruption, not just a recoverable exception from one call.
import { build } from 'esbuild';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = fs.mkdtempSync(join(root, 'tools/.crash-recovery-'));
const old = Buffer.from('old complete — 日本語\r\n'.repeat(20));
const incoming = Buffer.from('new complete — naïve\n'.repeat(30));
const crash = () => Object.assign(new Error('simulated process crash'), { code: 'ECRASH' });
const busy = () => Object.assign(new Error('rename blocked'), { code: 'EPERM' });
let controller;
const descriptors = new Set();
const handles = new Set();
const syncOps = new Set(['openSync', 'readFileSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync', 'mkdirSync', 'readdirSync']);
const asyncOps = new Set(['open', 'rename', 'unlink']);
function point(label) {
  if (!controller) return;
  if (controller.dead) throw crash();
  controller.trace.push(label);
  if (controller.trace.length === controller.at) { controller.dead = true; throw crash(); }
}
function live() { if (controller?.dead) throw crash(); }
function wrapHandle(handle) {
  handles.add(handle);
  return new Proxy(handle, { get(target, key) {
    const fn = target[key];
    if (typeof fn !== 'function') return fn;
    return async (...args) => {
      if (key === 'close') { handles.delete(handle); return fn.apply(target, args); }
      live();
      const tracked = ['writeFile', 'truncate', 'sync'].includes(key);
      if (tracked) point(`handle.${key}:before`);
      let result;
      if (key === 'writeFile') {
        const bytes = Buffer.from(args[0]);
        const mid = Math.floor(bytes.length / 2);
        await target.writeFile(bytes.subarray(0, mid));
        point('handle.writeFile:partial');
        await target.writeFile(bytes.subarray(mid));
      } else result = await fn.apply(target, args);
      if (tracked) point(`handle.${key}:after`);
      return result;
    };
  } });
}
const promises = new Proxy(fs.promises, { get(target, key) {
  const fn = target[key];
  if (typeof fn !== 'function') return fn;
  return async (...args) => {
    live();
    if (asyncOps.has(key)) point(`async.${key}:before`);
    if (key === 'rename' && controller?.blockRename) throw busy();
    const result = await fn.apply(target, args);
    const value = key === 'open' ? wrapHandle(result) : result;
    if (asyncOps.has(key)) point(`async.${key}:after`);
    return value;
  };
} });
const injected = new Proxy(fs, { get(target, key) {
  if (key === 'promises') return promises;
  const fn = target[key];
  if (typeof fn !== 'function') return fn;
  const wrapped = (...args) => {
    if (key === 'closeSync') { descriptors.delete(args[0]); return fn(...args); }
    live();
    const label = key === 'openSync' ? `openSync:${args[1] & fs.constants.O_CREAT ? 'create' : 'read'}` : key;
    if (syncOps.has(key)) point(`${label}:before`);
    let result;
    if (key === 'writeFileSync') {
      const bytes = Buffer.from(args[1]);
      const mid = Math.floor(bytes.length / 2);
      fs.writeFileSync(args[0], bytes.subarray(0, mid));
      point('writeFileSync:partial');
      if (typeof args[0] === 'number') fs.writeFileSync(args[0], bytes.subarray(mid));
      else fs.appendFileSync(args[0], bytes.subarray(mid));
    } else result = fn(...args);
    if (key === 'openSync') descriptors.add(result);
    if (syncOps.has(key)) point(`${label}:after`);
    return result;
  };
  if (key === 'realpathSync') wrapped.native = (...args) => { live(); return fs.realpathSync.native(...args); };
  return wrapped;
} });
globalThis.__crashRecoveryFs = injected;
const bundle = join(scratch, 'crash.cjs');
await build({ stdin: { contents: `export * from './src/main/save-file'; export * from './src/main/journal';`, loader: 'ts', resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, plugins: [{ name: 'crashing-fs', setup(build) {
  build.onResolve({ filter: /^fs$/ }, () => ({ path: 'fs', namespace: 'crash' }));
  build.onLoad({ filter: /.*/, namespace: 'crash' }, () => ({ contents: 'module.exports = globalThis.__crashRecoveryFs;' }));
} }] });
const m = createRequire(import.meta.url)(bundle);
const noWait = async () => {};
let cases = 0;
let seq = 0;
async function reboot() {
  controller = undefined;
  for (const fd of descriptors) { try { fs.closeSync(fd); } catch {} }
  descriptors.clear();
  for (const handle of handles) { try { await handle.close(); } catch {} }
  handles.clear();
}
function complete(bytes, label) { assert.ok(bytes.equals(old) || bytes.equals(incoming), `${label}: partial or empty destination`); }

// The SaveFs contract includes directory fsync even on Windows, where the real
// implementation cannot fsync directories. Keep that boundary in the matrix.
function memoryIo(blockRename = false) {
  const files = new Map([['note', old]]);
  return { files, io: {
    async open(file, exclusive) {
      point('open:before');
      if (exclusive && files.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      if (exclusive) files.set(file, Buffer.alloc(0));
      point('open:after');
      return {
        async truncate() { point('truncate:before'); files.set(file, Buffer.alloc(0)); point('truncate:after'); },
        async writeFile(data) {
          point('write:before');
          const bytes = Buffer.from(data);
          files.set(file, bytes.subarray(0, Math.floor(bytes.length / 2)));
          point('write:partial');
          files.set(file, bytes);
          point('write:after');
        },
        async sync() { point('fsync:before'); point('fsync:after'); },
        async close() {},
      };
    },
    async rename(from, to) {
      point('rename:before');
      if (blockRename) throw busy();
      assert.ok(files.has(from), 'rename source exists');
      files.set(to, files.get(from)); files.delete(from);
      point('rename:after');
    },
    async syncDirectory() { point('directory-fsync:before'); point('directory-fsync:after'); },
    async unlink(file) { point('cleanup:before'); files.delete(file); point('cleanup:after'); },
  } };
}

try {
  for (const [name, strict, blocked] of [['default atomic path', false, false], ['sync atomic path', true, false], ['sync blocked rename and cleanup', true, true]]) {
    await test(`writeAtomically crash matrix: ${name}`, async () => {
      async function run(at) {
        const { files, io } = memoryIo(blocked);
        controller = { trace: [], at, dead: false };
        await m.writeAtomically('note', incoming, 'note.first.tmp', { io, noInPlaceFallback: strict }, noWait).catch(error => {
          assert.ok(['ECRASH', 'EPERM'].includes(error.code));
        });
        const trace = [...controller.trace];
        if (at) assert.equal(controller.dead, true, `crash ${at} reached`);
        controller = undefined;
        complete(files.get('note'), name);
        if (!at && !blocked) assert.deepEqual(files.get('note'), incoming, 'successful save publishes all bytes');
        if (strict && blocked) assert.deepEqual(files.get('note'), old);
        // Production callers use fresh random temp names. An orphan from a dead
        // process cannot collide with the next save; it is never a destination.
        const nextIo = { ...io, rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); } };
        await m.writeAtomically('note', incoming, 'note.next.tmp', { io: nextIo, noInPlaceFallback: true }, noWait);
        assert.deepEqual(files.get('note'), incoming);
        assert.equal(files.has('note.next.tmp'), false);
        cases++;
        return trace;
      }
      const trace = await run();
      for (let at = 1; at <= trace.length; at++) await run(at);
    });
  }

  await test('default in-place fallback is crash atomic', { skip: 'By design the typing fallback truncates when rename stays blocked; a crash after truncate or a partial write loses atomicity. Sync disables this fallback.' }, async () => {
    const { files, io } = memoryIo(true);
    controller = { trace: [], at: Infinity, dead: false };
    const original = io.open;
    io.open = async (file, exclusive) => {
      const handle = await original(file, exclusive);
      if (!exclusive) handle.writeFile = async data => { files.set(file, Buffer.from(data).subarray(0, 2)); controller.dead = true; throw crash(); };
      return handle;
    };
    try { await m.writeAtomically('note', incoming, 'note.tmp', { io }, noWait); } catch {}
    controller = undefined;
    complete(files.get('note'), 'fallback');
  });

  await test('beforeReplace refuses outside changes at every retry and before fallback', async () => {
    for (let changedAt = 1; changedAt <= m.RENAME_ATTEMPTS + 1; changedAt++) {
      const { files, io } = memoryIo(true);
      let checks = 0;
      const external = Buffer.from('external complete');
      await assert.rejects(m.writeAtomically('note', incoming, 'note.tmp', { io, beforeReplace: async () => {
        if (++checks === changedAt) files.set('note', external);
        if (m.isOutsideChange(files.get('note').toString(), m.textHash(old.toString()), undefined)) throw m.saveConflict();
      } }, noWait), { code: m.SAVE_CONFLICT });
      assert.equal(checks, changedAt);
      assert.deepEqual(files.get('note'), external);
      assert.equal(files.has('note.tmp'), false);
      cases++;
    }
  });

  function fixture(limits = {}) {
    const dir = join(scratch, `case-${seq++}`), ws = join(dir, 'workspace'), ud = join(dir, 'userData');
    fs.mkdirSync(ws, { recursive: true }); fs.mkdirSync(ud);
    const file = join(ws, 'note.md'); fs.writeFileSync(file, old);
    let tick = 0;
    const journal = new m.WriteJournal(ud, { limits: { coalesceMs: 0, ...limits }, now: () => 1800000000000 + tick++, reportError: () => {} });
    return { dir, ws, ud, file, journal };
  }
  function checkEntries(f) {
    const fresh = new m.WriteJournal(f.ud, { reportError: () => {} });
    for (const entry of fresh.list(f.ws)) {
      assert.equal(entry.state, 'captured');
      const store = join(f.ud, 'journal', fs.readdirSync(join(f.ud, 'journal'))[0]);
      const bytes = fs.readFileSync(join(store, entry.id + '.bin'));
      assert.equal(bytes.length, entry.originalBytes, 'published capture has complete bytes');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    }
    return fresh;
  }

  for (const action of ['capture', 'capture-prune', 'restore', 'unattended', 'conflict']) {
    await test(`journal crash matrix: ${action}`, async () => {
      async function run(at) {
        const f = fixture(action === 'capture-prune' ? { maxEntries: 1 } : {});
        let entry;
        if (action === 'capture-prune') f.journal.capturePreImage(f.ws, f.file, 'overwrite');
        if (action === 'restore') {
          entry = f.journal.capturePreImage(f.ws, f.file, 'overwrite').entry;
          fs.writeFileSync(f.file, incoming);
        }
        if (action === 'conflict') {
          // Required capture fails because userData is a file. No mock result:
          // exercise the real conflict-copy branch and its reservation.
          fs.rmdirSync(f.ud); fs.writeFileSync(f.ud, 'unwritable store');
        }
        controller = { trace: [], at, dead: false };
        let result, error;
        try {
          if (action.startsWith('capture')) result = f.journal.capturePreImage(f.ws, f.file, 'overwrite');
          else if (action === 'restore') result = f.journal.restore(f.ws, entry.id);
          else result = await f.journal.writeUnattended(f.ws, f.file, incoming, 'device');
        } catch (e) { error = e; }
        const trace = [...controller.trace];
        const dead = controller.dead;
        await reboot();
        if (at) assert.equal(dead, true, `${action} crash ${at} reached`);
        else {
          assert.equal(error, undefined);
          if (action.startsWith('capture')) assert.equal(result.status, 'captured');
          else if (action === 'restore') { assert.equal(result.success, true); assert.deepEqual(fs.readFileSync(f.file), old); }
          else { assert.equal(result.conflict, action === 'conflict'); assert.deepEqual(fs.readFileSync(result.path), incoming); }
        }
        complete(fs.readFileSync(f.file), `${action} ${at}`);
        if (action.startsWith('capture') || action === 'conflict') assert.deepEqual(fs.readFileSync(f.file), old);
        // Before restore's atomic rename, the current bytes must be intact.
        if (action === 'restore' && !trace.includes('renameSync:after')) assert.deepEqual(fs.readFileSync(f.file), incoming);
        if (action !== 'conflict') {
          const fresh = checkEntries(f);
          if (!at && action.startsWith('capture')) assert.ok(fresh.list(f.ws).some(e => e.id === result.entry.id), 'successful capture is published');
          const retry = fresh.capturePreImage(f.ws, f.file, 'overwrite', { coalesce: false });
          assert.equal(retry.status, 'captured', 'restart can capture despite orphan files');
          assert.equal(fresh.restore(f.ws, retry.entry.id).success, true, 'restart can restore');
        }
        const retry = await f.journal.writeUnattended(f.ws, f.file, incoming, 'device');
        assert.deepEqual(fs.readFileSync(retry.path), incoming, 'next unattended save completes');
        if (action === 'conflict') assert.deepEqual(fs.readFileSync(f.file), old);
        cases++;
        fs.rmSync(f.dir, { recursive: true, force: true });
        return trace;
      }
      const trace = await run();
      for (let at = 1; at <= trace.length; at++) await run(at);
    });
  }
  await test('unattended blocked rename never enters the truncating fallback', async () => {
    const f = fixture();
    controller = { trace: [], at: Infinity, dead: false, blockRename: true };
    try { await assert.rejects(f.journal.writeUnattended(f.ws, f.file, incoming, 'device'), { code: 'EPERM' }); }
    finally { await reboot(); }
    assert.deepEqual(fs.readFileSync(f.file), old);
    assert.equal(fs.readdirSync(f.ws).some(name => name.endsWith('.tmp')), false);
    checkEntries(f);
  });
  await test('conflict copy publication never leaves an empty reservation after a crash', { skip: 'Known gap: writeUnattended reserves the conflict name with an empty file before atomic replacement. A process crash can leave that empty sibling; the original remains intact. Fix needs atomic no-replace publication or persisted reservation recovery.' }, async () => {
    const f = fixture();
    fs.rmdirSync(f.ud); fs.writeFileSync(f.ud, 'unwritable store');
    controller = { trace: [], at: Infinity, dead: false };
    // The first create is the conflict name reservation; stop after it exists.
    // Find that boundary from a completed run, then replay in a fresh fixture.
    await f.journal.writeUnattended(f.ws, f.file, incoming, 'device');
    const at = controller.trace.indexOf('openSync:create:after') + 1;
    assert.ok(at > 0);
    await reboot();
    const broken = fixture();
    fs.rmdirSync(broken.ud); fs.writeFileSync(broken.ud, 'unwritable store');
    controller = { trace: [], at, dead: false };
    await broken.journal.writeUnattended(broken.ws, broken.file, incoming, 'device').catch(() => {});
    assert.equal(controller.dead, true);
    await reboot();
    const copies = fs.readdirSync(broken.ws).filter(name => name.includes('(conflict') && !name.endsWith('.tmp'));
    assert.ok(copies.length > 0);
    for (const name of copies) assert.deepEqual(fs.readFileSync(join(broken.ws, name)), incoming);
  });
  console.log(`crash-recovery: ${cases} interruption/restart cases checked`);
} finally {
  await reboot();
  delete globalThis.__crashRecoveryFs;
  fs.rmSync(scratch, { recursive: true, force: true });
}
