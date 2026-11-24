// Runnable checks for src/main/sync/chunker.ts (keyed FastCDC) -- no test framework.
// Run: node tools/sync-chunker.test.mjs   (first creation of the vector: --write-vectors)
import assert from 'node:assert/strict';
import { loadSync, makeHelpers } from './sync-test-helpers.mjs';

const sync = await loadSync('sync-chunker');
const { s, hex, labelBytes, prng, checkVectors } = makeHelpers(sync);
const { CDC } = sync;
const KiB = 1024;
const MiB = 1024 * KiB;
let checks = 0;

const fixedWk = Uint8Array.from({ length: 32 }, (_, i) => i); // keys.json workspaceKey
const cdcKey = sync.deriveSubkey(fixedWk, 'cdc');
const blobidKey = sync.deriveSubkey(fixedWk, 'blobid');
const otherCdcKey = sync.deriveSubkey(Uint8Array.from({ length: 32 }, (_, i) => 255 - i), 'cdc');

assert.deepEqual({ min: CDC.min, avg: CDC.avg, max: CDC.max }, { min: 128 * KiB, avg: 512 * KiB, max: 2 * MiB });

// --- Gear table ---------------------------------------------------------------
{
  const table = sync.gearTable(cdcKey);
  assert.equal(table.length, 256);
  const stream = s.crypto_stream_xchacha20_xor(new Uint8Array(1024), new Uint8Array(24), cdcKey);
  const view = new DataView(stream.buffer, stream.byteOffset, 1024);
  for (let i = 0; i < 256; i++) assert.equal(table[i], view.getUint32(i * 4, true), `gear[${i}] = keystream word ${i} (LE)`);
  assert.deepEqual(sync.gearTable(cdcKey), table, 'deterministic');
  assert.notDeepEqual(sync.gearTable(otherCdcKey), table, 'keyed');
  assert.throws(() => sync.gearTable(new Uint8Array(31)), sync.SyncFormatError);
  checks += 5;
}

// --- shape of the output ----------------------------------------------------------
function checkShape(data, chunks, what) {
  let offset = 0;
  chunks.forEach((c, i) => {
    assert.equal(c.offset, offset, `${what}: contiguous at chunk ${i}`);
    assert.ok(c.length >= 1 && c.length <= CDC.max, `${what}: chunk ${i} length ${c.length} within max`);
    if (i < chunks.length - 1) assert.ok(c.length >= CDC.min, `${what}: chunk ${i} length ${c.length} within min`);
    offset += c.length;
  });
  assert.equal(offset, data.length, `${what}: chunks cover the input`);
}
{
  assert.deepEqual(sync.chunkBoundaries(new Uint8Array(0), cdcKey), [], 'empty file = zero chunks');
  for (const n of [1, 1000, 128 * KiB - 1, 128 * KiB, 128 * KiB + 1]) {
    assert.deepEqual(sync.chunkBoundaries(labelBytes('tiny', n), cdcKey), [{ offset: 0, length: n }], `${n} bytes = one chunk`);
  }
  // Constant input never matches the mask: chunks are cut at exactly max.
  const zeros = sync.chunkBoundaries(new Uint8Array(5 * MiB), cdcKey);
  checkShape(new Uint8Array(5 * MiB), zeros, 'zeros');
  assert.ok(zeros.slice(0, -1).every((c) => c.length === CDC.max), 'max enforced on input with no cut point');
  checks += 8;
}

// --- determinism and keying ---------------------------------------------------------
const input = labelBytes('cdc-input-5mib', 5 * MiB);
const original = sync.chunkBoundaries(input, cdcKey);
{
  checkShape(input, original, '5 MiB');
  assert.deepEqual(sync.chunkBoundaries(input.slice(), cdcKey), original, 'same input + key -> same boundaries');
  const other = sync.chunkBoundaries(input, otherCdcKey);
  checkShape(input, other, '5 MiB, other key');
  assert.notDeepEqual(other.map((c) => c.length), original.map((c) => c.length), 'different keys -> different boundaries');
  const table = sync.gearTable(cdcKey);
  assert.deepEqual(sync.chunkWithTable(input, table), original, 'precomputed table gives the same result');
  checks += 5;
}

// --- one-byte insert -------------------------------------------------------------------
// The true FastCDC property (design's "at most the touched chunks" is too strong):
// (a) every chunk ending at or before the insert offset is identical;
// (b) from some boundary after the edit, the rest are the original's shifted by one;
// (c) at most 4 chunks differ.
const ids = (data, chunks) => chunks.map((c) => sync.blobId(data.subarray(c.offset, c.offset + c.length), blobidKey));
function insertCase(data, at, byte, what, { binding = true } = {}) {
  const edited = new Uint8Array(data.length + 1);
  edited.set(data.subarray(0, at));
  edited[at] = byte;
  edited.set(data.subarray(at), at + 1);
  const before = sync.chunkBoundaries(data, cdcKey);
  const after = sync.chunkBoundaries(edited, cdcKey);
  checkShape(edited, after, `${what} (edited)`);
  const idsBefore = ids(data, before);
  const idsAfter = ids(edited, after);

  // (a)
  let prefix = 0;
  while (prefix < before.length && before[prefix].offset + before[prefix].length <= at) {
    assert.deepEqual(after[prefix], before[prefix], `${what}: chunk ${prefix} before the edit is unchanged`);
    assert.equal(idsAfter[prefix], idsBefore[prefix]);
    prefix++;
  }
  // (b) longest common suffix, shifted by the insert.
  let suffix = 0;
  for (;;) {
    const b = before[before.length - 1 - suffix];
    const a = after[after.length - 1 - suffix];
    if (!a || !b || before.length - 1 - suffix < prefix || after.length - 1 - suffix < prefix) break;
    if (a.offset !== b.offset + 1 || a.length !== b.length) break;
    assert.equal(idsAfter[after.length - 1 - suffix], idsBefore[before.length - 1 - suffix], `${what}: shifted chunk has the same blob ID`);
    suffix++;
  }
  const lastBefore = before[before.length - 1];
  const editInLastChunk = at >= lastBefore.offset;
  const resynced = suffix > 0 || editInLastChunk;
  if (binding) assert.ok(resynced, `${what}: boundaries never resynchronised after the edit`);
  if (suffix > 0) assert.ok(before[before.length - suffix].offset >= at, `${what}: resync point is after the edit`);
  const changed = after.length - prefix - suffix;
  const removed = before.length - prefix - suffix;
  checks += 4;
  return { what, at, chunks: before.length, changed, removed, resynced, binding, before, after };
}

const results = [];
{
  const frozenAt = 5 * MiB / 2;
  const frozen = insertCase(input, frozenAt, 0x5a, 'frozen vector');
  results.push(frozen);
  const vector = {
    note: 'cdc key = crypto_kdf(keys.json workspaceKey, id 4, "nsyncv1_"). Input = XChaCha20 keystream under BLAKE2b-256("cdc-input-5mib"), 5 MiB; then the same with byte 0x5a inserted at 2.5 MiB.',
    cdcKey: hex(cdcKey),
    gearTableHash: hex(s.crypto_generichash(32, new Uint8Array(sync.gearTable(cdcKey).buffer), null)),
    gearTableFirst8: Array.from(sync.gearTable(cdcKey).slice(0, 8)),
    inputLength: input.length,
    inputHash: hex(s.crypto_generichash(32, input, null)),
    insertOffset: frozenAt,
    insertByte: 0x5a,
    boundaries: frozen.before.map((c) => [c.offset, c.length]),
    insertedBoundaries: frozen.after.map((c) => [c.offset, c.length]),
    changedChunks: frozen.changed,
  };
  checkVectors('chunker.json', vector);
  checks++;

  // Not part of the binding ≤ 4 property, measured and reported: an insert in the
  // 31 bytes before a cut changes the Gear window that chose the cut, so that
  // boundary can disappear. Normalised chunking then cuts the following chunks
  // elsewhere until both alignments meet a common cut point; in a 5 MiB file
  // that can be end of file. Property (a) still holds and is asserted.
  const k = 4;
  const cut = original[k].offset + original[k].length;
  for (const [name, at] of [['at a boundary', original[k].offset], ['1 before a cut', cut - 1], ['16 before a cut', cut - 16], ['32 before a cut', cut - 32], ['min into chunk', original[k].offset + CDC.min]]) {
    results.push(insertCase(input, at, 0xa5, name, { binding: false }));
  }

  for (let seed = 1; seed <= 20; seed++) {
    const next = prng(seed);
    const data = labelBytes(`cdc-seed-${seed}`, 5 * MiB);
    const at = MiB + (next() % (3 * MiB));
    results.push(insertCase(data, at, next() & 255, `seed ${seed}`));
  }
}
console.log('  one-byte insert: case | offset | chunks | new chunks changed | old chunks replaced | resynced before EOF');
for (const r of results) {
  console.log(`    ${(r.binding ? '' : '(near cut) ') + r.what}`.padEnd(32) + ` | ${String(r.at).padStart(7)} | ${String(r.chunks).padStart(2)} | ${r.changed} | ${r.removed} | ${r.resynced ? 'yes' : 'NO'}`);
}
const bindingResults = results.filter((r) => r.binding);
assert.equal(bindingResults.length, 21, 'frozen vector + 20 seeds');
const worst = bindingResults.reduce((a, b) => (b.changed > a.changed ? b : a));
const over = bindingResults.filter((r) => r.changed > 4);
assert.equal(over.length, 0, `changed chunks above 4: ${over.map((r) => `${r.what}=${r.changed}`).join(', ')}`);
checks += bindingResults.length;
console.log(`  frozen vector + 20 seeds: worst ${worst.what} with ${worst.changed} changed chunk(s)`);
const nearCut = results.filter((r) => !r.binding);
console.log(`  near-cut inserts (informational): changed ${nearCut.map((r) => r.changed).join(', ')}; not resynced before EOF: ${nearCut.filter((r) => !r.resynced).length}`);
console.log(`sync-chunker: all checks passed (${checks} total)`);
