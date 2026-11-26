import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadSync, makeHelpers, root } from './sync-test-helpers.mjs';

const start = performance.now();
const s = await loadSync('sync-engine');
const helpers = makeHelpers(s);
const enc = new TextEncoder();
const text = (b) => b === null ? null : new TextDecoder().decode(b);
const tmp = fs.mkdtempSync(path.join(root, 'tools', '.sync-engine-'));
let fixtureId = 0, tests = 0;
const counts = {};
async function test(name, fn) {
  if (process.env.SYNC_TEST && !name.includes(process.env.SYNC_TEST)) return;
  await fn(); tests++; counts[name] = (counts[name] ?? 0) + 1;
  if (!name.startsWith('seed ')) process.stdout.write(`ok ${name}\n`);
}

// Fast, serialized fault/convergence model. The same engine also runs against
// FolderStore + StateStore in every filesystem/adversarial integration above.
class MemoryStore {
  objects = new Map();
  async putOnce(name, bytes) { s.checkObjectName(name); if (this.objects.has(name)) return 'exists'; this.objects.set(name, bytes.slice()); return 'created'; }
  async get(name, max) { s.checkObjectName(name); const b = this.objects.get(name); if (b && b.length > max) throw new s.SyncError('size', 'oversized'); return b?.slice() ?? null; }
  async list(prefix, after) { s.checkListPrefix(prefix, after); return [...this.objects.keys()].filter((n) => n.startsWith(prefix) && (!after || n > after)).sort(); }
  async remove(name) { s.checkObjectName(name); if (!name.startsWith('mailbox/')) throw new Error('immutable'); this.objects.delete(name); }
}
class MemoryState {
  json = null;
  async read(schema) { return this.json === null ? null : schema.parse(JSON.parse(this.json)); }
  async write(value, schema) { this.json = JSON.stringify(schema.parse(value)); }
}

class Workspace {
  files = new Map(); journal = []; tick = 1; captureFailure = false; cap = 16 * 1024 * 1024;
  hook = null; beforeRead = null;
  edit(p, value) {
    const bytes = typeof value === 'string' ? enc.encode(value) : value;
    if (this.files.has(p)) this.journal.push(this.files.get(p).bytes.slice());
    this.files.set(p, { bytes: bytes.slice(), mtimeMs: ++this.tick });
  }
  delete(p) { if (this.files.has(p)) this.journal.push(this.files.get(p).bytes.slice()); this.files.delete(p); }
  async list() { this.hook?.('list'); return [...this.files].map(([p, f]) => ({ path: p, size: f.bytes.length, mtimeMs: f.mtimeMs, ...(f.extra ?? {}) })); }
  async read(p, max) { this.hook?.('read'); this.beforeRead?.(p); const b = this.files.get(p)?.bytes; if (b && b.length > max) throw new Error('read cap'); return b?.slice() ?? null; }
  async write(p, b, label) {
    this.hook?.('write-before');
    assert.equal(s.unsafePath(p), null, `unsafe workspace write: ${p}`);
    const old = this.files.get(p);
    if (old && (this.captureFailure || old.bytes.length > this.cap)) {
      const destination = `journal-conflict-${s.commitHash(b).slice(0, 16)}.md`;
      this.edit(destination, b); this.hook?.('write-after');
      return { path: destination, conflict: true };
    }
    this.edit(p, b); this.hook?.('write-after'); return { path: p, conflict: false };
  }
  async remove(p) {
    this.hook?.('remove-before');
    const old = this.files.get(p);
    if (old && (this.captureFailure || old.bytes.length > this.cap)) return { success: false };
    this.delete(p); this.hook?.('remove-after'); return { success: true };
  }
  contents() { return Object.fromEntries([...this.files].sort(([a], [b]) => a < b ? -1 : 1).map(([p, f]) => [p, text(f.bytes)])); }
}

async function fixture(n = 2, model = false) {
  const dir = path.join(tmp, String(++fixtureId));
  const remoteDir = path.join(dir, 'remote');
  if (!model) fs.mkdirSync(remoteDir, { recursive: true });
  const store = model ? new MemoryStore() : new s.FolderStore(remoteDir), recoveryKey = s.generateRecoveryKey();
  const devices = [];
  for (let i = 0; i < n; i++) {
    const device = s.generateDeviceKeys(), workspace = new Workspace();
    const credentials = i === 0 ? await s.createRemote(store, device, recoveryKey, `Device ${i}`) : await s.joinWithRecoveryKey(store, device, recoveryKey, `Device ${i}`);
    const state = model ? new MemoryState() : new s.StateStore(path.join(dir, `state-${i}`));
    const options = { ...credentials, store, state, device, workspace, now: () => Date.UTC(2026, 10, 26) };
    devices.push({ device, workspace, state, options, engine: new s.SyncEngine(options) });
  }
  const f = { dir, remoteDir, store, recoveryKey, devices };
  return f;
}

async function pass(d, approve = true) {
  let result = await d.engine.syncOnce();
  if (result.status === 'approval-required' && approve) {
    await d.engine.approveMassChange(result.massChange.token);
    result = await d.engine.syncOnce();
  }
  assert.equal(result.status, 'synced', JSON.stringify(result));
  return result;
}
async function quiet(f, rounds = 3) { for (let i = 0; i < rounds; i++) for (const d of f.devices) await pass(d); }
function converge(f) { for (const d of f.devices.slice(1)) assert.deepEqual(d.workspace.contents(), f.devices[0].workspace.contents()); }
const full = (f, name) => path.join(f.remoteDir, ...name.split('/'));
async function sign(f, index, changes = [], ops = [], overrides = {}) {
  const d = f.devices[index];
  const view = await s.verifyRemote(f.store, d.options);
  const seq = (view.hwm[d.device.deviceId] ?? 0) + 1;
  const epoch = overrides.epoch ?? view.epoch;
  const bytes = s.encodeCommit({ workspaceId: d.options.workspaceId, epoch, seq, body: {
    parents: view.heads, seenVector: view.hwm, epoch, time: Date.UTC(2026, 10, 26), changes, deviceOps: ops, ...overrides.body,
  } }, d.options.keys.get(epoch), d.device);
  const name = s.logName(d.device.deviceId, seq);
  await f.store.putOnce(name, bytes); return { name, bytes };
}
async function content(f, index, value) {
  const d = f.devices[index], bytes = enc.encode(value), key = d.options.keys.get(1);
  const id = s.blobId(bytes, s.deriveSubkey(key, 'blobid')), blobKey = s.blobKeyFor(bytes, s.deriveSubkey(key, 'blobkey'));
  await f.store.putOnce(s.blobName(id), s.encodeBlob(bytes, blobKey));
  return { chunks: [{ blobId: id, blobKey: s.toHex(blobKey), size: bytes.length }], size: bytes.length, sha: id };
}

try {
  await test('folder store hard-link refusal and immutable publication', async () => {
    const dir = path.join(tmp, 'no-links'); fs.mkdirSync(dir);
    assert.throws(() => new s.FolderStore(dir, () => { throw Object.assign(new Error('unsupported'), { code: 'EPERM' }); }), (e) => e.code === 'no-hard-links');
    assert.deepEqual(fs.readdirSync(dir), []);
    const store = new s.FolderStore(dir);
    assert.equal(await store.putOnce('neuron-sync.json', enc.encode('first')), 'created');
    assert.equal(await store.putOnce('neuron-sync.json', enc.encode('second')), 'exists');
    assert.equal(text(await store.get('neuron-sync.json', 5)), 'first');
    await assert.rejects(store.get('neuron-sync.json', 4), /size limit/);
    for (const name of ['../x', '/abs', 'log/x/1.c', 'keys/01/recovery.env', 'blobs/aa/' + 'b'.repeat(64), 'log/' + 'a'.repeat(32) + '/9007199254740992.c']) await assert.rejects(store.putOnce(name, enc.encode('x')), /Invalid/);
    await assert.rejects(store.remove('neuron-sync.json'), /Only mailbox/);
    fs.writeFileSync(path.join(dir, 'desktop.ini'), 'clutter'); fs.writeFileSync(path.join(dir, '.dropbox'), 'clutter');
    assert.deepEqual(await store.list(''), ['neuron-sync.json']);
    const mailbox = `mailbox/${'a'.repeat(32)}.m`;
    await store.putOnce(mailbox, enc.encode('m')); await store.remove(mailbox);
    assert.equal(await store.get(mailbox, 10), null);
    const linkFailure = new s.FolderStore(dir, (a, b) => { if (b.endsWith('.link')) fs.linkSync(a, b); else throw Object.assign(new Error('link failed later'), { code: 'EPERM' }); });
    await assert.rejects(linkFailure.putOnce('neuron-sync.json', enc.encode('overwrite')), /link failed/);
    assert.equal(text(await store.get('neuron-sync.json', 10)), 'first');
  });

  await test('two devices upload and remote-first parent heads', async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('one.md', 'one'); await pass(a); await pass(b);
    assert.equal(b.workspace.contents()['one.md'], 'one');
    a.workspace.edit('two.md', 'two'); await pass(a);
    const before = await s.verifyRemote(f.store, a.options);
    b.workspace.edit('three.md', 'three'); await pass(b);
    const after = await s.verifyRemote(f.store, b.options);
    const latest = after.logs.filter((l) => l.commit.header.deviceId === b.device.deviceId).at(-1);
    assert.deepEqual(latest.commit.body.parents, before.heads);
    await quiet(f); converge(f);
  });

  for (const scenario of ['edit/edit', 'edit/delete', 'delete/edit', 'delete/delete', 'rename/edit', 'same-content']) await test(`conflict ${scenario}`, async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('note.md', 'base'); await quiet(f);
    if (scenario.startsWith('delete')) a.workspace.delete('note.md');
    else if (scenario === 'rename/edit') { a.workspace.delete('note.md'); a.workspace.edit('renamed.md', 'base'); }
    else a.workspace.edit('note.md', scenario === 'same-content' ? 'same' : 'A');
    if (scenario.endsWith('delete')) b.workspace.delete('note.md'); else b.workspace.edit('note.md', scenario === 'same-content' ? 'same' : 'B');
    await quiet(f, 5); converge(f);
    const values = Object.values(a.workspace.contents());
    if (scenario === 'edit/edit') { assert.ok(values.includes('A')); assert.ok(values.includes('B')); assert.equal(values.length, 2); }
    if (scenario === 'edit/delete') assert.deepEqual(values, ['A']);
    if (scenario === 'delete/edit') assert.deepEqual(values, ['B']);
    if (scenario === 'delete/delete') assert.deepEqual(values, []);
    if (scenario === 'rename/edit') { assert.ok(values.includes('base')); assert.ok(values.includes('B')); }
    if (scenario === 'same-content') assert.deepEqual(values, ['same']);
  });
  await test('mass deletion approves exactly the reviewed plan', async () => {
    const f = await fixture(); const [a, b] = f.devices;
    for (let i = 0; i < 60; i++) a.workspace.edit(`n${i}.md`, `${i}`);
    await quiet(f, 2);
    for (let i = 0; i < 60; i++) a.workspace.delete(`n${i}.md`);
    await pass(a);
    const r = await b.engine.syncOnce();
    assert.equal(r.status, 'approval-required'); assert.equal(r.massChange.paths.length, 60);
    assert.equal(b.workspace.files.size, 60);
    await assert.rejects(b.engine.approveMassChange('0'.repeat(64)), /does not match/);
    await b.engine.approveMassChange(r.massChange.token); await pass(b, false);
    assert.equal(b.workspace.files.size, 0);
  });

  await test('re-read before apply preserves a late edit (bite)', async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('note.md', 'base'); await quiet(f, 2);
    a.workspace.edit('note.md', 'incoming'); await pass(a);
    const r = await b.engine.syncOnce(); assert.equal(r.status, 'approval-required');
    await b.engine.approveMassChange(r.massChange.token);
    let reads = 0;
    b.workspace.beforeRead = (p) => { if (p === 'note.md' && ++reads === 1) { b.workspace.edit(p, 'late typing'); b.workspace.beforeRead = null; } };
    const result = await pass(b, false);
    assert.equal(b.workspace.contents()['note.md'], 'late typing');
    assert.ok(Object.values(b.workspace.contents()).includes('incoming'));
    assert.ok(result.conflicts.length);
  });

  for (const fail of ['capture', 'cap']) await test(`journal ${fail} keeps original`, async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('note.md', 'base'); await quiet(f, 2);
    a.workspace.edit('note.md', 'incoming'); await pass(a);
    if (fail === 'capture') b.workspace.captureFailure = true; else b.workspace.cap = 2;
    const r = await pass(b);
    assert.equal(b.workspace.contents()['note.md'], 'base');
    assert.ok(Object.values(b.workspace.contents()).includes('incoming')); assert.ok(r.conflicts.length);
  });

  for (const attack of ['../x', '/abs', 'C:\\x', '.git/hooks/x', 'GIT~1/x', 'a.md::$DATA', 'con.md', 'x\0y', 'x'.repeat(2000)]) await test(`path attack ${attack.slice(0, 24)}`, async () => {
    const f = await fixture(); const [a, b] = f.devices;
    const ref = await content(f, 0, 'preserved hostile path content');
    const change = { path: attack, kind: 'put', base: null, content: ref, mode: 'file' };
    if (attack.includes('\0') || attack.length > 1024) {
      await assert.rejects(sign(f, 0, [change]), /path|body/);
      const view = await s.verifyRemote(f.store, a.options), seq = view.hwm[a.device.deviceId] + 1;
      const header = s.canonicalHeader([['format', 'neuron-sync'], ['version', 1], ['workspaceId', a.options.workspaceId], ['epoch', 1], ['deviceId', a.device.deviceId], ['seq', seq]]);
      const ad = s.concatBytes(enc.encode('NSYC'), new Uint8Array([1]), s.u16be(header.length), header);
      const nonce = new Uint8Array(24);
      const body = { epoch: 1, time: 0, parents: view.heads, seenVector: view.hwm, changes: [change], deviceOps: [] };
      const ciphertext = s.sodium().crypto_aead_xchacha20poly1305_ietf_encrypt(enc.encode(JSON.stringify(body)), ad, null, nonce, s.deriveSubkey(a.options.keys.get(1), 'commit'));
      const signed = s.concatBytes(ad, nonce, ciphertext);
      await f.store.putOnce(s.logName(a.device.deviceId, seq), s.concatBytes(signed, s.sodium().crypto_sign_detached(signed, a.device.signPrivateKey)));
      const r = await b.engine.syncOnce(); assert.equal(r.status, 'alarm'); assert.equal(b.workspace.files.size, 0);
      return;
    }
    await sign(f, 0, [change]); const r = await pass(b);
    assert.ok(!b.workspace.files.has(attack));
    assert.ok(Object.values(b.workspace.contents()).includes('preserved hostile path content'));
    assert.ok(r.notSynced.length);
  });

  for (const pair of [['Note.md', 'note.md'], ['café.md', 'cafe\u0301.md'], ['Docs/a.md', 'docs/b.md']]) await test(`portable collision ${pair[0]}`, async () => {
    const f = await fixture();
    const refs = await Promise.all([content(f, 0, 'left'), content(f, 0, 'right')]);
    await sign(f, 0, pair.map((p, i) => ({ path: p, kind: 'put', base: null, content: refs[i], mode: 'file' })));
    await quiet(f, 3); converge(f);
    const values = Object.values(f.devices[0].workspace.contents());
    assert.ok(values.includes('left')); assert.ok(values.includes('right'));
  });

  for (const kind of ['blob', 'commit', 'manifest', 'envelope', 'checkpoint']) await test(`tamper ${kind}`, async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('note.md', 'secret'); await pass(a);
    let name;
    if (kind === 'blob') name = (await f.store.list('blobs/'))[0];
    if (kind === 'commit') name = (await f.store.list(`log/${a.device.deviceId}/`)).at(-1);
    if (kind === 'manifest') name = 'neuron-sync.json';
    if (kind === 'envelope') name = 'keys/1/recovery.env';
    if (kind === 'checkpoint') {
      const view = await s.verifyRemote(f.store, a.options);
      const bytes = s.encodeCheckpoint({ workspaceId: a.options.workspaceId, epoch: 1, seq: view.hwm[a.device.deviceId], body: s.snapshot(view) }, a.options.keys.get(1), a.device);
      name = `checkpoints/${s.commitHash(bytes)}.k`; await f.store.putOnce(name, bytes);
    }
    const bytes = fs.readFileSync(full(f, name)); bytes[Math.floor(bytes.length / 2)] ^= 1; fs.writeFileSync(full(f, name), bytes);
    if (kind === 'envelope') {
      const before = await f.store.list('');
      await assert.rejects(s.joinWithRecoveryKey(f.store, s.generateDeviceKeys(), f.recoveryKey, 'join'));
      assert.deepEqual(await f.store.list(''), before);
    } else {
      const before = b.workspace.contents(); const result = await b.engine.syncOnce();
      assert.ok(['alarm', 'paused'].includes(result.status), JSON.stringify(result));
      assert.deepEqual(b.workspace.contents(), before);
    }
  });

  await test('wrong workspace and wrong recovery key make no writes', async () => {
    const f = await fixture(), foreign = await fixture(1); const d = f.devices[0];
    const before = await foreign.store.list('');
    const engine = new s.SyncEngine({ ...d.options, store: foreign.store });
    const r = await engine.syncOnce(); assert.equal(r.status, 'paused'); assert.match(r.reason, /another workspace/);
    assert.deepEqual(await foreign.store.list(''), before);
    await assert.rejects(s.joinWithRecoveryKey(f.store, s.generateDeviceKeys(), foreign.recoveryKey, 'wrong key'));
  });

  for (const kind of ['hide-newest', 'delete-log', 'equivocation', 'replay', 'hwm-regression', 'seen-vector']) await test(`rollback ${kind} (bite)`, async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('note.md', 'value'); await quiet(f, 2);
    const names = await f.store.list(`log/${a.device.deviceId}/`), latest = names.at(-1);
    if (kind === 'hide-newest') fs.unlinkSync(full(f, latest));
    if (kind === 'delete-log') for (const name of names) fs.unlinkSync(full(f, name));
    if (kind === 'equivocation') {
      const old = await f.store.get(latest, s.LIMITS.commitMax);
      const decoded = s.decodeCommit(old, { workspaceId: a.options.workspaceId, signPublicKey: a.device.signPublicKey, workspaceKeyForEpoch: () => a.options.keys.get(1) });
      fs.writeFileSync(full(f, latest), s.encodeCommit({ ...decoded.header, body: { ...decoded.body, time: decoded.body.time + 1 } }, a.options.keys.get(1), a.device));
    }
    if (kind === 'replay') await f.store.putOnce(s.logName(a.device.deviceId, 3), await f.store.get(latest, s.LIMITS.commitMax));
    if (kind === 'hwm-regression') {
      const file = path.join(f.dir, 'state-1', 'state.json'), state = JSON.parse(fs.readFileSync(file));
      state.hwm[a.device.deviceId] = 1; fs.writeFileSync(file, JSON.stringify(state));
    }
    if (kind === 'seen-vector') await sign(f, 0, [], [], { body: { seenVector: { [a.device.deviceId]: 2, [b.device.deviceId]: 999 } } });
    b.workspace.edit('offline.md', 'must not upload');
    const before = await f.store.list(''); const disk = b.workspace.contents();
    const r = await b.engine.syncOnce(); assert.ok(['alarm', 'paused'].includes(r.status), JSON.stringify(r));
    assert.deepEqual(await f.store.list(''), before); assert.deepEqual(b.workspace.contents(), disk);
    b.engine = new s.SyncEngine(b.options);
    const later = await b.engine.syncOnce(); assert.ok(['alarm', 'paused'].includes(later.status));
  });

  await test('missing blob defers the whole commit then applies', async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('one.md', 'one'); a.workspace.edit('two.md', 'two'); await pass(a);
    const name = (await f.store.list('blobs/'))[0], saved = fs.readFileSync(full(f, name)); fs.unlinkSync(full(f, name));
    const result = await b.engine.syncOnce(); assert.equal(result.status, 'waiting'); assert.equal(b.workspace.files.size, 0);
    fs.writeFileSync(full(f, name), saved); await pass(b); assert.equal(b.workspace.files.size, 2);
  });

  await test('unregistered signer, seq-2 self-add, revoked signer and old epoch refused', async () => {
    for (const kind of ['unknown', 'self-add', 'revoked', 'old-epoch']) {
      const f = await fixture(); const [a, b] = f.devices;
      if (kind === 'unknown') {
        const unknown = s.generateDeviceKeys();
        await f.store.putOnce(`devices/${unknown.deviceId}.json`, enc.encode(s.serialisePublicIdentity(unknown)));
        const view = await s.verifyRemote(f.store, a.options);
        const bytes = s.encodeCommit({ workspaceId: a.options.workspaceId, epoch: 1, seq: 1, body: { epoch: 1, time: 0, parents: view.heads, seenVector: view.hwm, changes: [], deviceOps: [] } }, a.options.keys.get(1), unknown);
        await f.store.putOnce(s.logName(unknown.deviceId, 1), bytes);
      } else if (kind === 'self-add') {
        await sign(f, 0, [], [{ op: 'add', deviceId: a.device.deviceId, signPub: s.toHex(a.device.signPublicKey), boxPub: s.toHex(a.device.boxPublicKey), label: 'Again' }]);
      } else {
        const ops = kind === 'revoked' ? [{ op: 'remove', deviceId: b.device.deviceId }] : [{ op: 'rotate', epoch: 2 }];
        await sign(f, 0, [], ops);
        await sign(f, 1, [], [], { epoch: 1 });
      }
      const r = await a.engine.syncOnce(); assert.equal(r.status, 'alarm', `${kind}: ${JSON.stringify(r)}`);
    }
  });

  await test('default exclusions are reported and never propagated as deletes', async () => {
    const f = await fixture(); const [a, b] = f.devices;
    for (const p of ['.neuron/layout.json', '.neuron/cache/x', '.neuron/window.json', '.neuron/journal/x', '.DS_Store', 'Thumbs.db', 'desktop.ini', 'a.tmp', '~$a.md', 'run.exe']) a.workspace.edit(p, 'excluded');
    const shared = ['.neuron/styles/a.css', '.neuron/fragments/a.html', '.neuron/templates/a.html', '.neuron/manifests/a.json', '.neuron/tables/a.json', '.neuron/variables.json', '.neuron/config.json', 'view.html'];
    for (const p of shared) a.workspace.edit(p, 'shared');
    a.workspace.edit('link.md', 'link'); a.workspace.files.get('link.md').extra = { symlink: true };
    const r = await pass(a); assert.equal(r.notSynced.length, 11); await pass(b);
    assert.deepEqual([...b.workspace.files.keys()].sort(), [...shared].sort());
  });
  await test('checkpoint known-answer, signature-first, canonical body and domain separation', async () => {
    const device = s.keysTestSeams.deviceKeysFromSeeds(helpers.labelBytes('checkpoint-box', 32), helpers.labelBytes('checkpoint-sign', 32));
    const wk = helpers.labelBytes('checkpoint-workspace-key', 32), workspaceId = 'ca'.repeat(16);
    const body = { epoch: 1, tree: [], registry: [{ deviceId: device.deviceId, boxPub: s.toHex(device.boxPublicKey), signPub: s.toHex(device.signPublicKey), label: 'Vector', active: true }], covered: [{ deviceId: device.deviceId, seq: 1, hash: 'ab'.repeat(32) }], heads: ['ab'.repeat(32)] };
    const bytes = s.formatTestSeams.encodeCheckpointWith(helpers.seqRng('checkpoint-nonce'), { workspaceId, epoch: 1, seq: 1, body }, wk, device);
    const vector = helpers.checkVectors('checkpoint.json', { workspaceId, key: s.toHex(wk), signPub: s.toHex(device.signPublicKey), body, encoded: s.toHex(bytes), hash: s.commitHash(bytes) });
    const expect = { workspaceId, signPublicKey: device.signPublicKey, workspaceKeyForEpoch: () => wk, seq: 1 };
    assert.deepEqual(s.decodeCheckpoint(s.fromHex(vector.encoded), expect).body, body);
    assert.throws(() => s.decodeCommit(bytes, expect), /NSYC/);
    const tampered = bytes.slice(); tampered[40] ^= 1;
    let decrypts = 0;
    assert.throws(() => s.decodeCheckpoint(tampered, { ...expect, workspaceKeyForEpoch: () => { decrypts++; return wk; } }), /signature/);
    assert.equal(decrypts, 0);
    assert.throws(() => s.decodeCheckpoint(new Uint8Array(s.LIMITS.commitMax + 1), expect), /size/);
    assert.throws(() => s.encodeCheckpoint({ workspaceId, epoch: 1, seq: 1, body: { ...body, unknown: true } }, wk, device), /body/);
  });

  await test('checkpoint threshold, verified recovery join and rollback', async () => {
    const f = await fixture(1), a = f.devices[0];
    let parents = (await s.verifyRemote(f.store, a.options)).heads;
    for (let seq = 2; seq <= 200; seq++) {
      const bytes = s.encodeCommit({ workspaceId: a.options.workspaceId, epoch: 1, seq, body: { epoch: 1, time: 0, parents, seenVector: { [a.device.deviceId]: seq - 1 }, changes: [], deviceOps: [] } }, a.options.keys.get(1), a.device);
      await f.store.putOnce(s.logName(a.device.deviceId, seq), bytes); parents = [s.commitHash(bytes)];
    }
    await pass(a); const checkpoints = await f.store.list('checkpoints/'); assert.equal(checkpoints.length, 1);
    const device = s.generateDeviceKeys();
    const credentials = await s.joinWithRecoveryKey(f.store, device, f.recoveryKey, 'Checkpoint join');
    assert.equal(credentials.workspaceId, a.options.workspaceId);
    fs.unlinkSync(full(f, checkpoints[0]));
    const r = await a.engine.syncOnce(); assert.equal(r.status, 'alarm'); assert.match(r.reason, /checkpoint disappeared/);
  });

  await test('crash after commit publication adopts the in-flight sequence (bite)', async () => {
    const f = await fixture(); const [a, b] = f.devices;
    a.workspace.edit('note.md', 'crash version');
    let published;
    const original = f.store.putOnce.bind(f.store);
    f.store.putOnce = async (name, bytes) => {
      const result = await original(name, bytes);
      if (name.startsWith('log/')) { published = { name, bytes: bytes.slice() }; throw new Error('crash after commit put'); }
      return result;
    };
    const r = await a.engine.syncOnce(); assert.equal(r.status, 'paused'); assert.ok(published);
    f.store.putOnce = original; a.engine = new s.SyncEngine(a.options);
    await quiet(f, 2); converge(f);
    assert.deepEqual(await f.store.get(published.name, s.LIMITS.commitMax), Buffer.from(published.bytes));
    assert.equal((await f.store.list(`log/${a.device.deviceId}/`)).length, 2);
  });

  await test('crash at every store/state boundary and each apply', async () => {
    async function run(failAt) {
      const f = await fixture(2, true), [a, b] = f.devices;
      for (let i = 0; i < 10; i++) a.workspace.edit(`base-${i}.md`, `base-${i}`);
      await quiet(f, 2);
      a.workspace.edit('base-0.md', 'remote update'); a.workspace.delete('base-1.md');
      a.workspace.edit('new-1.md', 'remote one'); a.workspace.edit('new-2.md', 'remote two'); await pass(a);
      b.workspace.edit('local-1.md', 'local one'); b.workspace.edit('local-2.md', 'local two');
      let operation = 0;
      const hit = () => { if (++operation === failAt) throw new Error('simulated crash'); };
      const originals = [], publications = new Map();
      for (const [object, methods] of [[f.store, ['get', 'putOnce', 'list', 'remove']], [b.state, ['read', 'write']]]) for (const method of methods) {
        const original = object[method].bind(object); originals.push(() => { object[method] = original; });
        object[method] = async (...args) => {
          hit();
          if (method === 'putOnce' && args[0].startsWith('log/')) {
            const hash = s.commitHash(args[1]);
            assert.ok(!publications.has(args[0]) || publications.get(args[0]) === hash, 'device attempted self-equivocation');
            publications.set(args[0], hash);
          }
          const result = await original(...args); hit(); return result;
        };
      }
      b.workspace.hook = hit;
      try { await b.engine.syncOnce(); } finally { originals.forEach((restore) => restore()); b.workspace.hook = null; }
      const count = operation;
      b.engine = new s.SyncEngine(b.options); await quiet(f, 3); converge(f);
      const view = await s.verifyRemote(f.store, b.options);
      for (const log of view.logs) for (const change of log.commit.body.changes) if (change.content) {
        for (const chunk of change.content.chunks) assert.ok(await f.store.get(s.blobName(chunk.blobId), s.BLOB_MAX_BYTES), 'published commit references missing blob');
      }
      for (const [name, hash] of publications) assert.equal(s.commitHash(await f.store.get(name, s.LIMITS.commitMax)), hash);
      assert.equal(b.workspace.contents()['base-0.md'], 'remote update');
      assert.equal(b.workspace.contents()['local-1.md'], 'local one');
      return count;
    }
    const operations = await run(Infinity);
    for (let i = 1; i <= operations; i++) await run(i);
    process.stdout.write(`  crash matrix: ${operations} injected boundaries\n`);
  });

  await test('clock skew and 1999 clocks do not control merge order', async () => {
    const f = await fixture(3, true);
    const clocks = [Date.UTC(2026, 10, 28), Date.UTC(2026, 10, 24), Date.UTC(1999, 0, 1)];
    f.devices.forEach((d, i) => { d.options.now = () => clocks[i]; d.engine = new s.SyncEngine(d.options); });
    f.devices[0].workspace.edit('note.md', 'base'); await quiet(f, 2);
    f.devices.forEach((d, i) => d.workspace.edit('note.md', `version-${i}`));
    await quiet(f, 3); converge(f);
    for (let i = 0; i < 3; i++) assert.ok(Object.values(f.devices[0].workspace.contents()).includes(`version-${i}`));
    const view = await s.verifyRemote(f.store, f.devices[0].options);
    const winner = view.tree.get('note.md').filter((v) => v.content).sort((a, b) => a.hash > b.hash ? -1 : 1)[0];
    assert.equal(text(await s.readContent(f.store, f.devices[0].options, winner)), f.devices[0].workspace.contents()['note.md']);
  });

  await test('corrupt state is never reset, symlinks refused, library has no workspace fs writes', async () => {
    const f = await fixture(1), a = f.devices[0], file = path.join(f.dir, 'state-0', 'state.json');
    await pass(a);
    fs.writeFileSync(file, '{broken'); const r = await a.engine.syncOnce(); assert.equal(r.status, 'paused'); assert.match(r.reason, /corrupt/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
    const outside = path.join(tmp, 'junction-target'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.remoteDir, 'blobs'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.store.list(''), /symlink|junction/);
    await assert.rejects(f.store.putOnce(s.blobName('a'.repeat(64)), enc.encode('x')), /escapes|symlink|junction/);
    assert.deepEqual(fs.readdirSync(outside), []);
    for (const name of fs.readdirSync(path.join(root, 'src/main/sync'))) {
      const code = fs.readFileSync(path.join(root, 'src/main/sync', name), 'utf8');
      assert.ok(!/from ['"]electron['"]/.test(code));
      if (!['folder-store.ts', 'state-store.ts'].includes(name)) assert.ok(!/\bfs\.(?:write\w*|unlink\w*|rename\w*|mkdir\w*|rm\w*)\s*\(/.test(code), name);
    }
  });

  const seedCount = Number(process.env.SYNC_SEEDS ?? 200);
  await test('commit size batching, file/workspace limits and no redundant equal-content commit', async () => {
    const ref = { chunks: Array.from({ length: 800 }, () => ({ blobId: 'ab'.repeat(32), blobKey: 'cd'.repeat(32), size: 128 * 1024 })), size: 100 * 1024 * 1024, sha: 'ef'.repeat(32) };
    const changes = Array.from({ length: 150 }, (_, i) => ({ path: `${i}.bin`, kind: 'put', base: null, content: ref, mode: 'file' }));
    const batches = s.splitChanges(changes); assert.ok(batches.length > 1); assert.equal(batches.flat().length, changes.length);
    for (const batch of batches) assert.ok(Buffer.byteLength(JSON.stringify(batch)) < s.LIMITS.commitMax - 1024);
    assert.equal(s.excluded({ path: 'huge.bin', size: s.LIMITS.fileMax + 1, mtimeMs: 0 }), 'over 100 MiB');
    const f = await fixture(2, true), [a, b] = f.devices;
    a.workspace.edit('note.md', 'base'); await quiet(f, 2);
    a.workspace.edit('note.md', 'same'); b.workspace.edit('note.md', 'same'); await pass(a);
    const before = await f.store.list(`log/${b.device.deviceId}/`); await pass(b);
    assert.deepEqual(await f.store.list(`log/${b.device.deviceId}/`), before);
    b.workspace.list = async () => Array.from({ length: 20001 }, (_, i) => ({ path: `${i}.md`, size: 0, mtimeMs: 0 }));
    assert.equal((await b.engine.syncOnce()).status, 'alarm');
  });

  await test('latest recovery epoch, discovery box key has no authority, sequence gaps wait', async () => {
    const f = await fixture(2, true), [a, b] = f.devices;
    await pass(a);
    const identity = JSON.parse(s.serialisePublicIdentity(a.device)); identity.boxPub = 'ab'.repeat(32);
    f.store.objects.set(`devices/${a.device.deviceId}.json`, enc.encode(JSON.stringify(identity)));
    const before = await s.verifyRemote(f.store, a.options);
    assert.equal(before.registry.get(a.device.deviceId).boxPub, s.toHex(a.device.boxPublicKey));
    const nextKey = s.generateWorkspaceKey(); a.options.keys.set(2, nextKey); b.options.keys.set(2, nextKey);
    await f.store.putOnce('keys/2/recovery.env', s.encodeRecoveryEnvelope(nextKey, { workspaceId: a.options.workspaceId, epoch: 2 }, f.recoveryKey));
    await sign(f, 0, [], [{ op: 'rotate', epoch: 2 }]);
    const device = s.generateDeviceKeys();
    const creds = await s.joinWithRecoveryKey(f.store, device, f.recoveryKey, 'latest');
    assert.ok(s.bytesEqual(creds.keys.get(2), nextKey));
    const joined = s.decodeCommit(await f.store.get(s.logName(device.deviceId, 1), s.LIMITS.commitMax), { workspaceId: creds.workspaceId, signPublicKey: device.signPublicKey, workspaceKeyForEpoch: (e) => creds.keys.get(e) });
    assert.equal(joined.header.epoch, 2);
    const g = await fixture(1, true), d = g.devices[0];
    const view = await s.verifyRemote(g.store, d.options);
    const bytes = s.encodeCommit({ workspaceId: d.options.workspaceId, epoch: 1, seq: 3, body: { epoch: 1, time: 0, parents: view.heads, seenVector: { [d.device.deviceId]: 2 }, changes: [], deviceOps: [] } }, d.options.keys.get(1), d.device);
    await g.store.putOnce(s.logName(d.device.deviceId, 3), bytes);
    assert.equal((await d.engine.syncOnce()).status, 'waiting');
  });

  await test('completed conflict copies can be edited and deleted', async () => {
    const f = await fixture(2, true), [a, b] = f.devices;
    a.workspace.edit('note.md', 'base'); await quiet(f, 2);
    a.workspace.edit('note.md', 'left'); b.workspace.edit('note.md', 'right'); await quiet(f, 3); converge(f);
    const conflict = [...a.workspace.files.keys()].find((p) => p.includes('(conflict,')); assert.ok(conflict);
    a.workspace.edit(conflict, 'edited conflict'); await quiet(f, 3); converge(f);
    assert.equal(a.workspace.contents()[conflict], 'edited conflict');
    b.workspace.delete(conflict); await quiet(f, 3); converge(f);
    assert.ok(!a.workspace.files.has(conflict));
  });

  await test('local case and NFD spellings converge to portable paths', async () => {
    for (const names of [['Note.md', 'note.md'], ['cafe\u0301.md', 'café.md']]) {
      const f = await fixture(2, true), [a, b] = f.devices;
      a.workspace.edit(names[0], 'left'); b.workspace.edit(names[1], 'right');
      await quiet(f, 4); converge(f);
      assert.ok(Object.values(a.workspace.contents()).includes('left'));
      assert.ok(Object.values(a.workspace.contents()).includes('right'));
    }
  });
  for (let seed = 1; seed <= seedCount; seed++) await test(`seed ${seed}`, async () => {
    const f = await fixture(3, true), next = helpers.prng(seed), versions = new Set();
    for (let step = 0; step < 8; step++) {
      const d = f.devices[next() % 3], p = `note-${next() % 3}.md`, kind = next() % 4;
      if (kind <= 1) { const value = `seed-${seed}-version-${step}`; versions.add(value); d.workspace.edit(p, value); }
      if (kind === 2) d.workspace.delete(p);
      if (kind === 3 && d.workspace.files.has(p)) { const b = d.workspace.files.get(p).bytes; d.workspace.delete(p); d.workspace.edit(`renamed-${step}.md`, b); }
      if (next() % 2) await pass(f.devices[next() % 3]);
    }
    await quiet(f, 3); converge(f);
    const retained = new Set(f.devices.flatMap((d) => [...Object.values(d.workspace.contents()), ...d.workspace.journal.map(text)]));
    for (const v of versions) assert.ok(retained.has(v), `seed ${seed} lost ${v}`);
  });
  process.stdout.write(`ok ${seedCount} seeded three-device convergence runs\n`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.stdout.write(`Sync engine: ${tests} tests; ${((performance.now() - start) / 1000).toFixed(2)} s\n`);
