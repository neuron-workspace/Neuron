// Sync Phase 1 (B2): the app-side wiring, end to end without Electron. Two
// "devices", each with its own workspace folder, write journal, trash, keychain
// stand-in and SyncHost, share one FolderStore. The worker runs as a real child
// process (a Node fork standing in for Electron's utilityProcess) and reaches
// the workspace only through the host's WorkspaceIO.
// Run: node tools/sync-wiring.test.mjs
import { build } from 'esbuild';
import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { root } from './sync-test-helpers.mjs';

const scratch = fs.mkdtempSync(join(root, 'tools', '.sync-wiring-'));
const bundle = async (contents, file) => {
  const out = join(scratch, file);
  await build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' });
  return out;
};
const workerFile = await bundle(`import './src/main/sync/worker';`, 'worker.cjs');
const m = createRequire(import.meta.url)(await bundle(
  ['sync/host', 'sync/workspace-io', 'sync/ignore', 'journal', 'save-file'].map((p) => `export * from './src/main/${p}';`).join('\n'), 'host.cjs'));

let passed = 0;
const children = new Set();
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (error) { console.error(`  FAIL ${name}`); throw error; }
}

// A keychain stand-in: reversible, and the plaintext never appears in the file.
const codec = (available = true) => ({
  available,
  encrypt: (v) => Buffer.from(Buffer.from(v).map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString(),
});

function spawnWorker() {
  const child = fork(workerFile, [], { env: { ...process.env, NEURON_SYNC_WORKER: '1' }, serialization: 'advanced', stdio: 'inherit' });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return {
    port: { postMessage: (msg) => child.send(msg), onMessage: (f) => child.on('message', f) },
    kill: () => child.kill(),
    onExit: (f) => child.on('exit', f),
  };
}

function device(name, store, options = {}) {
  const dir = join(scratch, name);
  const ws = join(dir, 'workspace'), userData = join(dir, 'userData'), trash = join(dir, 'trash');
  for (const d of [ws, userData, trash]) fs.mkdirSync(d, { recursive: true });
  const journal = new m.WriteJournal(userData);
  let trashed = 0;
  const io = m.createWorkspaceIO({
    root: ws, journal, queue: m.createSaveQueue(),
    trash: async (file) => { fs.renameSync(file, join(trash, `${trashed++}`)); },
  });
  const statuses = [];
  const host = new m.SyncHost({
    spawn: spawnWorker, io, userData, codec: codec(options.keychain ?? true),
    readIgnore: async () => { try { return fs.readFileSync(join(ws, '.neuron', 'sync-ignore'), 'utf8'); } catch { return ''; } },
    onStatus: (s) => statuses.push(s),
    timers: options.timers,
    now: options.now,
  });
  const file = (p) => join(ws, ...p.split('/'));
  return {
    ws, userData, trash, journal, host, statuses, store,
    write(p, text) { fs.mkdirSync(join(file(p), '..'), { recursive: true }); fs.writeFileSync(file(p), text); },
    read(p) { try { return fs.readFileSync(file(p), 'utf8'); } catch { return null; } },
    async pass() { const status = await host.pass(); assert.ok(['idle'].includes(status.state), `${name}: ${status.state} ${status.reason ?? ''}`); return status; },
  };
}

try {
  await test('ignore rules: comments, negation, anchoring, folders, ** and case', () => {
    const { match, dropped } = m.parseIgnore([
      '# comment', '', 'drafts/', '/top.md', '*.log', '!keep.log', 'docs/**/secret.md', 'a?c.txt', '**/cache/**', '*'.repeat(20),
    ].join('\n'));
    assert.equal(dropped, 1, 'a pattern with too many wildcards is dropped, not compiled');
    const cases = {
      'drafts/x.md': true, 'notes/drafts/x.md': true, 'drafts.md': false,
      'top.md': true, 'sub/top.md': false,
      'a.log': true, 'x/y/a.log': true, 'keep.log': false, 'x/keep.log': false,
      'docs/secret.md': true, 'docs/a/b/secret.md': true, 'secret.md': false,
      'abc.txt': true, 'ac.txt': false, 'TOP.MD': true,
      'x/cache/y/z.md': true, 'cache.md': false, 'notes/plain.md': false,
    };
    for (const [p, expected] of Object.entries(cases)) assert.equal(!!match(p), expected, p);
    assert.match(match('drafts/x.md'), /sync-ignore \(drafts\/\)/);
  });

  await test('mass-change rule: over 50, or at least 10 that are over 20%', async () => {
    const { massChange } = createRequire(import.meta.url)(await bundle(`export * from './src/main/sync/planner';`, 'planner.cjs'));
    for (const [n, files, expected] of [[1, 1, false], [9, 9, false], [10, 40, true], [10, 50, false], [51, 100_000, true], [50, 100_000, false]]) {
      assert.equal(massChange(n, files), expected, `${n} of ${files}`);
    }
  });

  const store = join(scratch, 'store');
  fs.mkdirSync(store);
  const a = device('a', store), b = device('b', store);
  let recoveryKey;

  await test('create: device and workspace keys are wrapped by the keychain, the recovery key comes back once', async () => {
    const made = await a.host.create(store, 'Laptop');
    recoveryKey = made.recoveryKey;
    assert.match(recoveryKey, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){13}$|^[0-9A-Z-]+$/);
    await a.host.start(made.config);
    const deviceFile = fs.readFileSync(join(a.userData, 'sync', 'device.json'), 'utf8');
    const keysFile = fs.readFileSync(join(a.userData, 'sync', made.config.workspaceId, 'keys.json'), 'utf8');
    const device = await a.host.device();
    assert.ok(!deviceFile.includes(device.signPriv) && !deviceFile.includes(device.boxPriv), 'no plaintext private key on disk');
    assert.ok(!keysFile.includes(recoveryKey.replace(/-/g, '')), 'no recovery key on disk');
    for (const f of ['neuron-sync.json', `devices/${device.deviceId}.json`]) assert.ok(fs.existsSync(join(store, f)), f);
    a.config = made.config;
  });

  await test('a note written on one device reaches the other through the store, never in plaintext', async () => {
    a.write('notes/hello.md', '# Hello from A, a secret phrase');
    await a.pass();
    const config = await b.host.join(store, recoveryKey, 'Desktop');
    assert.equal(config.workspaceId, a.config.workspaceId);
    await b.host.start(config);
    await b.pass();
    assert.equal(b.read('notes/hello.md'), '# Hello from A, a secret phrase');
    const everything = fs.readdirSync(store, { recursive: true }).filter((p) => fs.statSync(join(store, p)).isFile())
      .map((p) => fs.readFileSync(join(store, p)).toString('latin1')).join('\n');
    assert.ok(!everything.includes('secret phrase') && !everything.includes('hello.md'), 'store holds no file names or content in plaintext');
  });

  await test('edits go both ways; a remote overwrite is journalled first', async () => {
    b.write('notes/hello.md', '# Edited on B');
    await b.pass(); await a.pass();
    assert.equal(a.read('notes/hello.md'), '# Edited on B');
    const entries = a.journal.list(a.ws).filter((e) => e.writer === 'sync');
    assert.ok(entries.length >= 1, 'pre-image captured before the overwrite');
  });

  await test('a remote delete goes to the OS trash after capture, never unlink', async () => {
    a.write('notes/old.md', 'to be removed'); await a.pass(); await b.pass();
    assert.equal(b.read('notes/old.md'), 'to be removed');
    fs.rmSync(join(a.ws, 'notes', 'old.md')); await a.pass(); await b.pass();
    assert.equal(b.read('notes/old.md'), null);
    assert.equal(fs.readdirSync(b.trash).map((f) => fs.readFileSync(join(b.trash, f), 'utf8')).includes('to be removed'), true);
  });

  await test('sync-ignore: an ignored folder is neither sent nor received, and never deleted elsewhere', async () => {
    a.write('private/a.md', 'A private'); await a.pass(); await b.pass();
    assert.equal(b.read('private/a.md'), 'A private');
    b.write('.neuron/sync-ignore', 'private/\n');
    b.write('private/b.md', 'B private');
    fs.rmSync(join(b.ws, 'private', 'a.md'));
    await b.pass(); await a.pass();
    assert.equal(a.read('private/a.md'), 'A private', 'deleting an ignored file on B does not delete it on A');
    assert.equal(a.read('private/b.md'), null, 'B does not send what it ignores');
    a.write('private/c.md', 'new on A'); await a.pass(); await b.pass();
    assert.equal(b.read('private/c.md'), null, 'B does not receive what it ignores');
    assert.equal(a.read('.neuron/sync-ignore'), null, 'the ignore file itself is per device');
    const report = b.host.current().report;
    assert.ok(report.notSynced.some((n) => n.path === 'private/b.md' && /sync-ignore/.test(n.reason)), 'listed as not synced');
  });

  await test('an unreadable ignore file pauses the pass instead of syncing what was meant to stay', async () => {
    const c = device('c', store);
    c.host.deps.readIgnore = async () => { throw new Error('EACCES'); };
    const config = await c.host.join(store, recoveryKey, 'Third');
    await c.host.start(config);
    const status = await c.host.pass();
    assert.equal(status.state, 'paused');
    assert.match(status.reason, /EACCES/);
    c.host.stop();
  });

  await test('no keychain: sync refuses to set up, with the existing message', async () => {
    const d = device('d', store, { keychain: false });
    await assert.rejects(d.host.join(store, recoveryKey, 'No keychain'), /keychain/i);
    assert.equal(fs.existsSync(join(d.userData, 'sync', 'device.json')), false);
    d.host.stop();
  });

  await test('the worker reaches the workspace only through main', () => {
    const source = fs.readFileSync(join(root, 'src/main/sync/worker.ts'), 'utf8');
    for (const banned of ['../journal', '../save-file', '../safe-fs', './workspace-io', "from 'electron'", "'node:fs'", "'fs'"]) assert.ok(!source.includes(banned), banned);
  });

  await test('schedule: edits wait for quiet, but never past the maximum delay; one pass at a time', async () => {
    let clock = 0;
    const timers = [];
    const fake = {
      setTimeout: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; },
      clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    };
    let passes = 0;
    const h = new m.SyncHost({ spawn: spawnWorker, io: {}, userData: scratch, codec: codec(), readIgnore: async () => '', timers: fake, now: () => clock });
    h.pass = async () => { passes++; return {}; };
    const advance = (ms) => { clock += ms; for (const t of [...timers].sort((x, y) => x.at - y.at)) if (t.at <= clock) { timers.splice(timers.indexOf(t), 1); t.fn(); } };
    h.touch(); advance(10_000); h.touch(); advance(10_000); h.touch();
    assert.equal(passes, 0, 'still typing: no pass yet');
    advance(m.SCHEDULE.quietMs);
    assert.equal(passes, 1, 'one pass after things go quiet');
    for (let i = 0; i < 40; i++) { h.touch(); advance(10_000); }
    assert.ok(passes >= 2, 'constant edits still pass by the maximum delay');
    h.stop(); h.touch(); advance(m.SCHEDULE.maxDelayMs);
    const after = passes; advance(m.SCHEDULE.maxDelayMs);
    assert.equal(passes, after, 'stopped: no more passes');
  });

  a.host.stop(); b.host.stop();
  console.log(`sync-wiring: ${passed} checks passed`);
} finally {
  for (const child of children) child.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
}
