// Runnable check for src/main/journal.ts -- no test framework needed:
// transpile with vite's bundled esbuild, then assert.
// Run: node tools/journal.test.mjs
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/main/journal.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const tmpModule = join(root, 'tools/.journal.tmp.mjs');
writeFileSync(tmpModule, code);
const { WriteJournal, DEFAULT_JOURNAL_LIMITS } = await import(pathToFileURL(tmpModule));
rmSync(tmpModule);

const scratch = mkdtempSync(join(tmpdir(), 'neuron-journal-test-'));
let seq = 0;
const newWorkspace = () => {
  const dir = join(scratch, `ws-${seq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const newUserData = () => {
  const dir = join(scratch, `ud-${seq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// --- pre-image capture and exact-byte restore --------------------------------
{
  const ws = newWorkspace();
  const journal = new WriteJournal(newUserData());
  const file = join(ws, 'note.md');

  // Bytes chosen to catch the two ways a naive implementation corrupts content:
  // CRLF normalisation and multi-byte UTF-8 mangling.
  const original = Buffer.from('# Title\r\n\r\nnaïve — 日本語 🎉\r\nline\n', 'utf-8');
  writeFileSync(file, original);

  const captured = journal.capturePreImage(ws, file, 'overwrite');
  assert.equal(captured.status, 'captured');
  assert.equal(captured.entry.operation, 'overwrite');
  assert.equal(captured.entry.relativePath, 'note.md');

  writeFileSync(file, 'destroyed');
  const restored = journal.restore(ws, captured.entry.id);
  assert.equal(restored.success, true, restored.error);
  assert.deepEqual(readFileSync(file), original, 'restore must return the exact prior bytes');
}

// --- delete is recoverable ---------------------------------------------------
{
  const ws = newWorkspace();
  const journal = new WriteJournal(newUserData());
  const file = join(ws, 'sub', 'deep.md');
  mkdirSync(dirname(file), { recursive: true });
  const original = Buffer.from('gone soon\n');
  writeFileSync(file, original);

  const captured = journal.capturePreImage(ws, file, 'delete');
  assert.equal(captured.status, 'captured');
  assert.equal(captured.entry.relativePath, 'sub/deep.md', 'relative paths are posix-normalised');
  rmSync(file);
  assert.equal(existsSync(file), false);

  const restored = journal.restore(ws, captured.entry.id);
  assert.equal(restored.success, true, restored.error);
  assert.deepEqual(readFileSync(file), original);
}

// --- creating a new file records nothing -------------------------------------
{
  const ws = newWorkspace();
  const journal = new WriteJournal(newUserData());
  const result = journal.capturePreImage(ws, join(ws, 'brand-new.md'), 'overwrite');
  assert.equal(result.status, 'not-needed', 'a create has no pre-image');
  assert.equal(journal.list(ws).length, 0);
}

// --- oversize files record a skip marker, never a silent omission ------------
{
  const ws = newWorkspace();
  const journal = new WriteJournal(newUserData(), { limits: { maxFileBytes: 64 } });
  const file = join(ws, 'big.bin');
  writeFileSync(file, Buffer.alloc(500, 7));

  const result = journal.capturePreImage(ws, file, 'overwrite');
  assert.equal(result.status, 'skipped');
  assert.equal(result.entry.state, 'skipped');
  assert.equal(result.entry.skipReason, 'file-too-large');

  // The entry is listed, so the user can see the gap...
  assert.equal(journal.list(ws).length, 1);
  // ...and restore refuses instead of claiming success for bytes it never held.
  const restored = journal.restore(ws, result.entry.id);
  assert.equal(restored.success, false);
  assert.match(restored.error, /size limit/i);
}

// --- retention: entry count --------------------------------------------------
{
  const ws = newWorkspace();
  let clock = 1_000_000;
  const journal = new WriteJournal(newUserData(), { limits: { maxEntries: 3, coalesceMs: 0 }, now: () => clock++ });
  const file = join(ws, 'churn.md');
  for (let i = 0; i < 10; i++) {
    writeFileSync(file, `version ${i}\n`);
    journal.capturePreImage(ws, file, 'overwrite');
  }
  const entries = journal.list(ws);
  assert.equal(entries.length, 3, 'entry count cap is enforced');
  // list() is newest-first, and the survivors must be the newest ones.
  const restored = journal.restore(ws, entries[0].id);
  assert.equal(restored.success, true, restored.error);
  assert.equal(readFileSync(file, 'utf-8'), 'version 9\n', 'oldest are pruned, not newest');
}

// --- retention: age ----------------------------------------------------------
{
  const ws = newWorkspace();
  let clock = 1_000_000;
  const journal = new WriteJournal(newUserData(), { limits: { maxAgeMs: 100, coalesceMs: 0 }, now: () => clock });
  const file = join(ws, 'aged.md');

  writeFileSync(file, 'old\n');
  journal.capturePreImage(ws, file, 'overwrite');
  assert.equal(journal.list(ws).length, 1);

  clock += 10_000; // well past maxAgeMs
  writeFileSync(file, 'new\n');
  journal.capturePreImage(ws, file, 'overwrite');

  const entries = journal.list(ws);
  assert.equal(entries.length, 1, 'entries older than maxAgeMs are pruned');
  assert.equal(entries[0].createdAt, clock);
}

// --- retention: total bytes --------------------------------------------------
{
  const ws = newWorkspace();
  let clock = 1_000_000;
  const journal = new WriteJournal(newUserData(), { limits: { maxTotalBytes: 300, coalesceMs: 0 }, now: () => clock++ });
  const file = join(ws, 'fat.md');
  for (let i = 0; i < 6; i++) {
    writeFileSync(file, Buffer.alloc(100, 65 + i));
    journal.capturePreImage(ws, file, 'overwrite');
  }
  const entries = journal.list(ws);
  const total = entries.reduce((sum, e) => sum + e.originalBytes, 0);
  assert.ok(total <= 300, `byte cap enforced, got ${total}`);
  assert.ok(entries.length >= 1, 'pruning never empties the store completely');
}

// --- a journal failure must never throw ------------------------------------
{
  const ws = newWorkspace();
  // userData points *through* a regular file, so creating the store directory
  // fails with ENOTDIR on every platform -- portable stand-in for an unwritable
  // or full store. The caller ignores the result, so the only thing that matters
  // is that this returns instead of throwing: a throw here would propagate into
  // notes:write and stop the user saving.
  const blocked = join(scratch, 'not-a-dir');
  writeFileSync(blocked, 'x');
  const journal = new WriteJournal(join(blocked, 'userData'), { reportError: () => {} });

  const file = join(ws, 'note.md');
  writeFileSync(file, 'content\n');
  const result = journal.capturePreImage(ws, file, 'overwrite');
  assert.equal(result.status, 'failed', 'an unwritable store reports failure');
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.deepEqual(journal.list(ws), [], 'a broken store lists nothing rather than throwing');
}

// --- overwrites coalesce; deletes never do ----------------------------------
{
  const ws = newWorkspace();
  let clock = 1_000_000;
  const journal = new WriteJournal(newUserData(), { limits: { coalesceMs: 1000 }, now: () => clock });
  const file = join(ws, 'typed.md');

  // Neuron saves on every keystroke. Nine "keystrokes" inside the window must
  // leave ONE entry, holding the text from before the session -- not the text
  // from one keystroke ago, which is what makes history worth having.
  const original = 'the original sentence';
  writeFileSync(file, original);
  for (let i = 0; i < 9; i++) {
    journal.capturePreImage(ws, file, 'overwrite');
    writeFileSync(file, original + ' typing'.repeat(i + 1));
    clock += 50;
  }
  const entries = journal.list(ws);
  assert.equal(entries.length, 1, 'rapid overwrites coalesce into one entry');

  const restored = journal.restore(ws, entries[0].id);
  assert.equal(restored.success, true, restored.error);
  assert.equal(readFileSync(file, 'utf-8'), original, 'the kept entry is the OLDEST in the window');

  // Past the window, a new entry is recorded again.
  clock += 5000;
  writeFileSync(file, 'much later');
  journal.capturePreImage(ws, file, 'overwrite');
  assert.equal(journal.list(ws).length, 2, 'a later edit starts a new entry');

  // A delete is never coalesced away -- it is the operation with no second chance.
  clock += 10;
  journal.capturePreImage(ws, file, 'delete');
  const afterDelete = journal.list(ws);
  assert.equal(afterDelete.length, 3, 'delete captures even inside the coalesce window');
  assert.equal(afterDelete[0].operation, 'delete');
}

// --- workspaces do not share a store ----------------------------------------
{
  const userData = newUserData();
  const wsA = newWorkspace();
  const wsB = newWorkspace();
  const journal = new WriteJournal(userData);

  const fileA = join(wsA, 'shared-name.md');
  const fileB = join(wsB, 'shared-name.md');
  writeFileSync(fileA, 'from A\n');
  writeFileSync(fileB, 'from B\n');
  const a = journal.capturePreImage(wsA, fileA, 'overwrite');
  journal.capturePreImage(wsB, fileB, 'overwrite');

  assert.equal(journal.list(wsA).length, 1);
  assert.equal(journal.list(wsB).length, 1);
  // A's entry id must be meaningless in B's store, or one workspace could
  // restore another's content over an identically named file.
  assert.equal(journal.restore(wsB, a.entry.id).success, false, 'entry ids do not cross workspaces');
  assert.equal(readFileSync(fileB, 'utf-8'), 'from B\n');
}

// --- paths outside the workspace are never journaled ------------------------
{
  const ws = newWorkspace();
  const journal = new WriteJournal(newUserData());
  const outside = join(scratch, 'outside-secret.md');
  writeFileSync(outside, 'secret\n');

  for (const candidate of [outside, join(ws, '..', 'outside-secret.md'), ws]) {
    const result = journal.capturePreImage(ws, candidate, 'overwrite');
    assert.notEqual(result.status, 'captured', `must not journal ${candidate}`);
  }
  assert.equal(journal.list(ws).length, 0);
}

// --- a forged entry id cannot escape the store ------------------------------
{
  const ws = newWorkspace();
  const journal = new WriteJournal(newUserData());
  for (const forged of ['../../etc/passwd', '..', '', 'not-an-id', '1234-zzzz']) {
    assert.equal(journal.restore(ws, forged).success, false, `forged id rejected: ${forged}`);
  }
}

// --- defaults are sane ------------------------------------------------------
{
  for (const [name, value] of Object.entries(DEFAULT_JOURNAL_LIMITS)) {
    assert.ok(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer`);
  }
  assert.ok(DEFAULT_JOURNAL_LIMITS.maxFileBytes < DEFAULT_JOURNAL_LIMITS.maxTotalBytes,
    'a single file must not be allowed to fill the whole store');
}

rmSync(scratch, { recursive: true, force: true });
console.log('journal: all checks passed');
