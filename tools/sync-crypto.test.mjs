// Runnable checks for src/main/sync (keys, object formats) -- no test framework:
// bundle with esbuild, load, assert. Run: node tools/sync-crypto.test.mjs
// First creation of the known-answer files: node tools/sync-crypto.test.mjs --write-vectors
// (it never overwrites an existing fixture; a deliberate format change deletes them first).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import assert from 'node:assert/strict';
import { loadSync, makeHelpers, root } from './sync-test-helpers.mjs';

const sync = await loadSync('sync-crypto');
const { s, enc, hex, unhex, labelBytes, seqRng, prng, withDeterministicSodium, spy, rejects, checkVectors } = makeHelpers(sync);
const { LIMITS, MAGIC, keysTestSeams, formatTestSeams } = sync;
const counts = {};
const tally = (suite, n = 1) => { counts[suite] = (counts[suite] ?? 0) + n; };

const concat = (...parts) => sync.concatBytes(...parts);
const u16 = (n) => new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
const prefix = (magic) => concat(enc.encode(magic), new Uint8Array([1]));
const KiB = 1024;
const MiB = 1024 * KiB;

// --- guards: where the library may be used -----------------------------------
{
  const walk = (dir) => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|js|mjs|cjs)$/.test(full) ? [full] : [];
  });
  const files = walk(join(root, 'src')).map((file) => ({ rel: relative(root, file).split(sep).join('/'), text: readFileSync(file, 'utf-8') }));
  const syncFiles = files.filter((f) => f.rel.startsWith('src/main/sync/'));
  assert.ok(syncFiles.length >= 5, 'sync modules found');
  for (const f of syncFiles) {
    assert.ok(!/(?:from\s+|require\(\s*|import\(\s*)['"]electron['"]/.test(f.text), `${f.rel} must not import electron (D41: runs in a utility process and plain Node)`);
  }
  for (const f of files) {
    if (/['"]libsodium-wrappers-sumo['"]|['"]libsodium-sumo['"]/.test(f.text)) assert.equal(f.rel, 'src/main/sync/sodium.ts', `${f.rel}: only sodium.ts loads libsodium`);
    if (/\b(keysTestSeams|formatTestSeams)\b/.test(f.text)) {
      assert.ok(['src/main/sync/keys.ts', 'src/main/sync/format.ts'].includes(f.rel), `${f.rel}: test seams must not be reachable from production code`);
    }
  }
  tally('guards', 3);
}

// --- keys -------------------------------------------------------------------
const deviceA = keysTestSeams.deviceKeysFromSeeds(labelBytes('device-a-box-seed', 32), labelBytes('device-a-sign-seed', 32));
const deviceB = keysTestSeams.deviceKeysFromSeeds(labelBytes('device-b-box-seed', 32), labelBytes('device-b-sign-seed', 32));
{
  const fresh = sync.generateDeviceKeys();
  assert.equal(fresh.boxPublicKey.length, 32);
  assert.equal(fresh.boxPrivateKey.length, 32);
  assert.equal(fresh.signPublicKey.length, 32);
  assert.equal(fresh.signPrivateKey.length, 64);
  assert.match(fresh.deviceId, /^[0-9a-f]{32}$/);
  assert.equal(fresh.deviceId, hex(s.crypto_generichash(32, fresh.signPublicKey, null).subarray(0, 16)), 'deviceId = first 16 bytes of BLAKE2b-256(signPub)');
  assert.notEqual(sync.generateDeviceKeys().deviceId, fresh.deviceId);
  tally('keys');

  const text = sync.serialisePublicIdentity(fresh);
  assert.ok(!text.includes('Private') && !text.includes(hex(fresh.signPrivateKey)), 'identity carries public halves only');
  const back = sync.parsePublicIdentity(text);
  assert.equal(back.deviceId, fresh.deviceId);
  assert.deepEqual(back.boxPublicKey, fresh.boxPublicKey);
  assert.deepEqual(back.signPublicKey, fresh.signPublicKey);
  const obj = JSON.parse(text);
  rejects(() => sync.parsePublicIdentity(JSON.stringify(obj, null, 1)), 'shape', 'identity with whitespace');
  rejects(() => sync.parsePublicIdentity(text.replace(fresh.deviceId, deviceB.deviceId)), 'shape', 'identity with a foreign deviceId');
  rejects(() => sync.parsePublicIdentity(text.replace('"version":1', '"version":2')), 'version', 'identity version 2');
  rejects(() => sync.parsePublicIdentity(text + ' '.repeat(600)), 'size', 'oversized identity');
  tally('keys', 5);

  const wk = keysTestSeams.generateWorkspaceKeyWith(seqRng('wk'));
  const subkeys = ['commit', 'blobid', 'history', 'cdc', 'blobkey'].map((p) => hex(sync.deriveSubkey(wk, p)));
  assert.equal(new Set([...subkeys, hex(wk)]).size, 6, 'subkeys are distinct from each other and from WK');
  assert.deepEqual(sync.SUBKEY_IDS, { commit: 1, blobid: 2, history: 3, cdc: 4, blobkey: 5 });
  assert.equal(subkeys[4], hex(s.crypto_kdf_derive_from_key(32, 5, 'nsyncv1_', wk)), 'blobkey = id 5');
  assert.equal(sync.WORKSPACE_KDF_CONTEXT, 'nsyncv1_');
  assert.equal(subkeys[0], hex(s.crypto_kdf_derive_from_key(32, 1, 'nsyncv1_', wk)));
  assert.equal(sync.generateWorkspaceKey().length, 32);
  tally('keys', 5);
}

// --- recovery key -----------------------------------------------------------
{
  const next = prng(7);
  for (let i = 0; i < 300; i++) {
    const key = i === 0 ? new Uint8Array(32) : i === 1 ? new Uint8Array(32).fill(255) : Uint8Array.from({ length: 32 }, () => next() & 255);
    const text = sync.formatRecoveryKey(key);
    assert.match(text, /^(?:[0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{2}$/, 'recovery key layout: 13 groups of 4, then a checksum pair');
    assert.deepEqual(sync.parseRecoveryKey(text), key);
    assert.deepEqual(sync.parseRecoveryKey(text.toLowerCase().replace(/-/g, ' ')), key, 'case and separators do not matter');
  }
  tally('recovery', 3);

  const key = labelBytes('recovery-key', 32);
  const text = sync.formatRecoveryKey(key);
  // I and L read as 1, O as 0.
  const confusable = text.replace(/1/g, (c, i) => (i % 2 ? 'I' : 'l')).replace(/0/g, 'o');
  assert.deepEqual(sync.parseRecoveryKey(`  ${confusable.replace(/-/g, ' - ')}  `), key);
  rejects(() => sync.parseRecoveryKey(text.slice(0, -1)), 'shape', 'recovery key one character short');
  rejects(() => sync.parseRecoveryKey(`${text}0`), 'shape', 'recovery key one character long');
  rejects(() => sync.parseRecoveryKey(text.replace(/^./, 'U')), 'shape', 'U is not Crockford');
  rejects(() => sync.parseRecoveryKey(''), 'shape', 'empty recovery key');
  tally('recovery', 5);

  // Every single-character substitution, and every adjacent transposition.
  const plain = text.replace(/-/g, '');
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let tried = 0;
  let missed = 0;
  let checksumErrors = 0;
  for (let pos = 0; pos < plain.length; pos++) {
    for (const c of alphabet) {
      if (c === plain[pos]) continue;
      tried++;
      const typo = plain.slice(0, pos) + c + plain.slice(pos + 1);
      try {
        sync.parseRecoveryKey(typo);
        missed++;
      } catch (error) {
        assert.ok(error instanceof sync.SyncFormatError);
        if (error.code === 'checksum') checksumErrors++;
      }
    }
  }
  let swaps = 0;
  let swapsMissed = 0;
  for (let pos = 0; pos + 1 < plain.length; pos++) {
    if (plain[pos] === plain[pos + 1]) continue;
    swaps++;
    const typo = plain.slice(0, pos) + plain[pos + 1] + plain[pos] + plain.slice(pos + 2);
    try { sync.parseRecoveryKey(typo); swapsMissed++; } catch (error) { assert.ok(error instanceof sync.SyncFormatError); }
  }
  assert.equal(checksumErrors, tried - missed, 'a typo is reported as a checksum error');
  assert.ok(missed / tried < 0.01, `substitutions missed: ${missed}/${tried}`);
  assert.ok(swapsMissed / swaps < 0.02, `transpositions missed: ${swapsMissed}/${swaps}`);
  console.log(`  recovery key typo detection: ${tried - missed}/${tried} substitutions, ${swaps - swapsMissed}/${swaps} transpositions caught`);
  tally('recovery', 3);
}

// --- padding buckets ----------------------------------------------------------
{
  const cases = [
    [0, 4 * KiB], [1, 4 * KiB], [4 * KiB, 4 * KiB], [4 * KiB + 1, 8 * KiB],
    [60 * KiB + 1, 64 * KiB], [64 * KiB, 64 * KiB], [64 * KiB + 1, 128 * KiB],
    [MiB - 1, MiB], [MiB, MiB], [MiB + 1, MiB + 256 * KiB],
    [2 * MiB, 2 * MiB], [2 * MiB + 1, 2 * MiB + 256 * KiB],
  ];
  for (const [needed, bucket] of cases) assert.equal(sync.bucketSize(needed), bucket, `bucketSize(${needed})`);
  // A chunk of n bytes needs n + 1 (sodium_pad's marker byte).
  const padded = [[1, 4 * KiB], [4095, 4 * KiB], [4096, 8 * KiB], [65535, 64 * KiB], [65536, 128 * KiB], [MiB - 1, MiB], [MiB, MiB + 256 * KiB], [2 * MiB, 2 * MiB + 256 * KiB]];
  for (const [length, size] of padded) assert.equal(sync.paddedSize(length), size, `paddedSize(${length})`);
  assert.throws(() => sync.bucketSize(-1), RangeError);
  tally('padding', cases.length + padded.length + 1);
}

// --- blob -------------------------------------------------------------------
const wk1 = keysTestSeams.generateWorkspaceKeyWith(seqRng('wk-epoch-1'));
const blobidKey = sync.deriveSubkey(wk1, 'blobid');
const blobkeyKey = sync.deriveSubkey(wk1, 'blobkey');
const keyOf = (chunk) => sync.blobKeyFor(chunk, blobkeyKey);
const smallChunk = labelBytes('small-chunk', 3000);
const blobKey = keyOf(smallChunk);
const smallBlob = sync.encodeBlob(smallChunk, blobKey);
{
  for (const length of [1, 4095, 4096, 65535, 65536, 200 * KiB, MiB, 2 * MiB]) {
    const chunk = labelBytes(`chunk-${length}`, length);
    const key = keyOf(chunk);
    const bytes = sync.encodeBlob(chunk, key);
    const paddedLength = sync.paddedSize(length);
    assert.equal(bytes.length, 29 + paddedLength + Math.ceil(paddedLength / (64 * KiB)) * 17, `blob length for ${length}`);
    assert.deepEqual(sync.decodeBlob(bytes, key), chunk);
    const id = sync.blobId(chunk, blobidKey);
    assert.deepEqual(sync.decodeBlob(bytes, key, { blobidKey, blobId: id }), chunk);
    assert.equal(id, hex(s.crypto_generichash(32, chunk, blobidKey)));
    assert.notDeepEqual(sync.encodeBlob(chunk, key), bytes, 'a fresh stream header each time');
  }
  assert.equal(sync.blobId(smallChunk, blobidKey), sync.blobId(smallChunk.slice(), blobidKey));
  assert.notEqual(sync.blobId(smallChunk, blobidKey), sync.blobId(smallChunk, sync.deriveSubkey(keysTestSeams.generateWorkspaceKeyWith(seqRng('other')), 'blobid')));
  rejects(() => sync.encodeBlob(new Uint8Array(0), blobKey), 'size', 'empty chunk');
  rejects(() => sync.encodeBlob(new Uint8Array(2 * MiB + 1), blobKey), 'size', 'chunk over 2 MiB');
  tally('blob', 8 * 4 + 4);

  // Convergent blob keys (subkey id 5): two devices encoding the same chunk
  // independently, under the same WK, can each open the other's copy.
  {
    const chunk = labelBytes('shared-chunk', 70 * KiB);
    const keyOnA = sync.blobKeyFor(chunk, sync.deriveSubkey(wk1, 'blobkey'));
    const keyOnB = sync.blobKeyFor(chunk.slice(), sync.deriveSubkey(wk1.slice(), 'blobkey'));
    assert.deepEqual(keyOnA, keyOnB, 'same chunk, same WK -> same blob key on both devices');
    const copyA = sync.encodeBlob(chunk, keyOnA);
    const copyB = sync.encodeBlob(chunk, keyOnB);
    assert.notDeepEqual(copyA, copyB, 'ciphertexts still differ (random stream header)');
    const idA = sync.blobId(chunk, blobidKey);
    assert.equal(sync.blobId(chunk.slice(), sync.deriveSubkey(wk1.slice(), 'blobid')), idA, 'same blob ID on both devices');
    // Whichever copy won the write-once name, either device's commit opens it.
    for (const stored of [copyA, copyB]) {
      for (const key of [keyOnA, keyOnB]) assert.deepEqual(sync.decodeBlob(stored, key, { blobidKey, blobId: idA }), chunk);
    }
    // Different workspace key -> different blob key and blob ID.
    const wkX = keysTestSeams.generateWorkspaceKeyWith(seqRng('wk-x'));
    const keyX = sync.blobKeyFor(chunk, sync.deriveSubkey(wkX, 'blobkey'));
    assert.notDeepEqual(keyX, keyOnA, 'another WK gives another blob key');
    assert.notEqual(sync.blobId(chunk, sync.deriveSubkey(wkX, 'blobid')), idA, 'another WK gives another blob ID');
    rejects(() => sync.decodeBlob(copyA, keyX), 'auth', 'blob opened with another workspace\'s derived key');
    // The blobkey and blobid subkeys differ, so the key is never the (public) ID.
    assert.notDeepEqual(blobkeyKey, blobidKey, 'blobkey subkey != blobid subkey');
    assert.notEqual(hex(keyOnA), idA, 'blob key != blob ID for the same chunk');
    assert.notDeepEqual(keyOf(smallChunk), keyOf(chunk), 'different chunks -> different keys');
    rejects(() => sync.blobKeyFor(chunk, new Uint8Array(31)), 'shape', 'blobkey subkey of the wrong length');
    tally('blob', 13);
  }

  // Tamper: every byte, by class.
  const L = smallBlob.length;
  const classes = (i) => (i < 4 ? 'magic' : i === 4 ? 'version' : 'auth'); // stream header, message tag, ciphertext, MAC
  for (let i = 0; i < L; i++) {
    for (const bit of [0x01, 0x80]) {
      const t = smallBlob.slice();
      t[i] ^= bit;
      rejects(() => sync.decodeBlob(t, blobKey), classes(i), `blob byte ${i} ^ ${bit}`);
    }
  }
  tally('blob', 2 * L);

  // Wrong key, wrong expected ID.
  rejects(() => sync.decodeBlob(smallBlob, keyOf(labelBytes('another-chunk', 3000))), 'auth', 'blob under another key');
  rejects(() => sync.decodeBlob(smallBlob, blobKey, { blobidKey, blobId: '00'.repeat(32) }), 'auth', 'blob under the wrong ID');
  tally('blob', 2);

  // Truncation: a multi-message stream missing its final message ends on TAG_MESSAGE.
  const bigChunk = labelBytes('chunk-200k', 200 * KiB);
  const bigKey = keyOf(bigChunk);
  const big = sync.encodeBlob(bigChunk, bigKey); // 256 KiB padded = 4 messages
  const fullMessage = 64 * KiB + 17;
  assert.equal(big.length, 29 + 4 * fullMessage);
  // Dropping whole messages leaves 192 KiB and 128 KiB: both legal buckets, so only the missing TAG_FINAL catches it.
  for (const kept of [3, 2]) {
    const err = rejects(() => sync.decodeBlob(big.subarray(0, 29 + kept * fullMessage), bigKey), 'auth', `blob stream cut to ${kept} messages`);
    assert.match(err.message, /truncated/);
  }
  const big2Chunk = labelBytes('chunk-130k', 130 * KiB);
  const big2 = sync.encodeBlob(big2Chunk, keyOf(big2Chunk)); // 192 KiB padded = 3 messages
  assert.equal(big2.length, 29 + 3 * fullMessage);
  const extra = rejects(() => sync.decodeBlob(concat(big2, big2.subarray(29, 29 + fullMessage)), keyOf(big2Chunk)), 'auth', 'blob with a message after TAG_FINAL');
  assert.match(extra.message, /unexpected tag/);
  rejects(() => sync.decodeBlob(new Uint8Array(0), blobKey), 'size', 'empty blob');
  rejects(() => sync.decodeBlob(smallBlob.subarray(0, 29), blobKey), 'size', 'header only');
  rejects(() => sync.decodeBlob(smallBlob.subarray(0, L - 1), blobKey), 'size', 'blob one byte short');
  rejects(() => sync.decodeBlob(concat(smallBlob, new Uint8Array(1)), blobKey), 'size', 'blob one byte long');
  rejects(() => sync.decodeBlob(smallBlob.subarray(0, 4), blobKey), 'size', 'blob cut inside the version byte');
  tally('blob', 8);

  // Reordered messages authenticate individually but not in sequence.
  const swapped = concat(big.subarray(0, 29), big.subarray(29 + fullMessage, 29 + 2 * fullMessage), big.subarray(29, 29 + fullMessage), big.subarray(29 + 2 * fullMessage));
  rejects(() => sync.decodeBlob(swapped, bigKey), 'auth', 'reordered blob messages');
  tally('blob');

  // Size before anything: an oversized buffer is refused without reading it or calling libsodium.
  const oversized = new Uint8Array(sync.BLOB_MAX_BYTES + 1);
  oversized.set(smallBlob.subarray(0, 29));
  const calls = spy(['crypto_secretstream_xchacha20poly1305_init_pull', 'crypto_secretstream_xchacha20poly1305_pull', 'unpad'], () => {
    rejects(() => sync.decodeBlob(oversized, blobKey), 'size', 'oversized blob');
    rejects(() => sync.decodeBlob(new Proxy(new Uint8Array(sync.BLOB_MAX_BYTES + 1), { get: (t, p) => (p === 'length' ? t.length : assert.fail(`read ${String(p)}`)) }), blobKey), 'size', 'oversized blob (unreadable)');
  });
  assert.deepEqual(Object.values(calls), [0, 0, 0], 'no decrypt attempted on an oversized blob');
  tally('blob', 3);
}

// --- commit -------------------------------------------------------------------
const workspaceId = hex(labelBytes('workspace-a', 16));
const otherWorkspaceId = hex(labelBytes('workspace-b', 16));
const wk2 = keysTestSeams.generateWorkspaceKeyWith(seqRng('wk-epoch-2'));
const wkOther = keysTestSeams.generateWorkspaceKeyWith(seqRng('wk-other-workspace'));
const keyFor = (map) => (epoch) => map[epoch];
const keysA = keyFor({ 1: wk1, 2: wk2 });
const hashOf = (label) => hex(labelBytes(label, 32));
const sampleBody = (epoch = 1) => ({
  parents: [hashOf('parent-1')],
  seenVector: { [deviceA.deviceId]: 6, [deviceB.deviceId]: 3 },
  epoch,
  time: 1764000000000,
  changes: [
    { path: 'notes/Hello wörld.md', kind: 'put', base: null, content: { chunks: [{ blobId: hashOf('b1'), blobKey: hashOf('k1'), size: 131072 }, { blobId: hashOf('b2'), blobKey: hashOf('k2'), size: 10 }], size: 131082, sha: hashOf('sha1') }, mode: 'file' },
    { path: 'old.md', kind: 'delete', base: hashOf('sha0'), content: null, mode: 'file' },
  ],
  deviceOps: [
    { op: 'add', deviceId: deviceB.deviceId, boxPub: hex(deviceB.boxPublicKey), signPub: hex(deviceB.signPublicKey), label: 'Laptop — 2' },
    { op: 'remove', deviceId: hashOf('gone').slice(0, 32) },
    { op: 'rotate', epoch: epoch + 1 },
  ],
});
const commitInput = (over = {}) => ({ workspaceId, epoch: 1, seq: 7, body: sampleBody(over.epoch ?? 1), ...over });
const expectA = (over = {}) => ({ workspaceId, signPublicKey: deviceA.signPublicKey, workspaceKeyForEpoch: keysA, ...over });

const headerOf = (fields) => enc.encode(`{${fields.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')}}`);
const commitHeaderFields = (over = {}) => Object.entries({ format: 'neuron-sync', version: 1, workspaceId, epoch: 1, deviceId: deviceA.deviceId, seq: 7, ...over });
/** Independent assembly of a commit, so tests can sign what the encoder would refuse to write. */
const assembleCommit = ({ headerBytes = headerOf(commitHeaderFields()), body = sampleBody(), bodyBytes, key = wk1, signer = deviceA, nonce = labelBytes('commit-nonce', 24) } = {}) => {
  const ad = concat(prefix('NSYC'), u16(headerBytes.length), headerBytes);
  const plaintext = bodyBytes ?? enc.encode(JSON.stringify(body));
  const signed = concat(ad, nonce, s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, ad, null, nonce, sync.deriveSubkey(key, 'commit')));
  return concat(signed, s.crypto_sign_detached(signed, signer.signPrivateKey));
};

const commit = formatTestSeams.encodeCommitWith(seqRng('commit-nonce-seam'), commitInput(), wk1, deviceA);
{
  const decoded = sync.decodeCommit(commit, expectA({ seq: 7 }));
  assert.deepEqual(decoded.header, { format: 'neuron-sync', version: 1, workspaceId, epoch: 1, deviceId: deviceA.deviceId, seq: 7 });
  assert.deepEqual(decoded.body, sampleBody());
  assert.equal(decoded.hash, hex(s.crypto_generichash(32, commit, null)));
  assert.equal(decoded.hash, sync.commitHash(commit));
  const viaPublic = sync.encodeCommit(commitInput(), wk1, deviceA);
  assert.notDeepEqual(viaPublic, commit, 'random nonce in production');
  assert.deepEqual(sync.decodeCommit(viaPublic, expectA()).body, sampleBody());
  // The test's own assembly reproduces the encoder byte for byte (layout check).
  assert.deepEqual(assembleCommit({ nonce: seqRng('commit-nonce-seam')(24) }), commit);
  tally('commit', 7);

  // Tamper: every byte, by class. The signature is checked first, so anything after the version is `signature`.
  const H = (commit[5] << 8) | commit[6];
  const classOf = (i) => (i < 4 ? ['magic'] : i === 4 ? ['version'] : i < 7 ? ['size', 'signature'] : ['signature']);
  for (let i = 0; i < commit.length; i++) {
    for (const bit of [0x01, 0x80]) {
      const t = commit.slice();
      t[i] ^= bit;
      rejects(() => sync.decodeCommit(t, expectA()), classOf(i), `commit byte ${i} ^ ${bit} (header ${7}..${7 + H})`);
    }
  }
  tally('commit', 2 * commit.length);

  // Signature before decrypt: a tampered ciphertext never reaches the AEAD.
  const t = commit.slice();
  t[t.length - 100] ^= 1;
  const calls = spy(['crypto_aead_xchacha20poly1305_ietf_decrypt', 'crypto_sign_verify_detached'], () => rejects(() => sync.decodeCommit(t, expectA()), 'signature', 'tampered ciphertext'));
  assert.equal(calls.crypto_sign_verify_detached, 1);
  assert.equal(calls.crypto_aead_xchacha20poly1305_ietf_decrypt, 0, 'signature-before-decrypt: no decrypt of an unverified commit');
  tally('commit', 2);

  // Wrong keys and mixed-up context.
  rejects(() => sync.decodeCommit(commit, expectA({ signPublicKey: deviceB.signPublicKey })), 'signature', 'another device\'s signing key');
  rejects(() => sync.decodeCommit(assembleCommit({ signer: deviceB }), expectA({ signPublicKey: deviceB.signPublicKey })), 'signature', 'signed by B, header names A');
  rejects(() => sync.decodeCommit(commit, expectA({ workspaceKeyForEpoch: keyFor({ 1: wkOther }) })), 'auth', 'another workspace\'s WK');
  rejects(() => sync.decodeCommit(commit, expectA({ workspaceKeyForEpoch: keyFor({}) })), 'auth', 'no key for the epoch');
  rejects(() => sync.decodeCommit(commit, expectA({ workspaceId: otherWorkspaceId })), 'auth', 'different workspaceId than expected');
  rejects(() => sync.decodeCommit(commit, expectA({ seq: 8 })), 'auth', 'seq differs from the object name');
  // A validly signed header claiming epoch 2 over a body encrypted under epoch 1.
  const epochLie = assembleCommit({ headerBytes: headerOf(commitHeaderFields({ epoch: 2 })), body: sampleBody(2) });
  rejects(() => sync.decodeCommit(epochLie, expectA()), 'auth', 'header epoch differs from the encryption epoch');
  const workspaceLie = assembleCommit({ headerBytes: headerOf(commitHeaderFields({ workspaceId: otherWorkspaceId })) });
  rejects(() => sync.decodeCommit(workspaceLie, expectA()), 'auth', 'header names another workspace');
  const epoch2 = formatTestSeams.encodeCommitWith(seqRng('e2'), commitInput({ epoch: 2 }), wk2, deviceA);
  assert.equal(sync.decodeCommit(epoch2, expectA()).header.epoch, 2);
  tally('commit', 9);

  // Canonical header: validly signed but not canonical is refused.
  const nonCanonical = {
    reordered: enc.encode(`{"version":1,"format":"neuron-sync","workspaceId":"${workspaceId}","epoch":1,"deviceId":"${deviceA.deviceId}","seq":7}`),
    whitespace: enc.encode(`{"format": "neuron-sync","version":1,"workspaceId":"${workspaceId}","epoch":1,"deviceId":"${deviceA.deviceId}","seq":7}`),
    trailingSpace: concat(headerOf(commitHeaderFields()), enc.encode(' ')),
    escaped: enc.encode(`{"format":"neuron\\u002dsync","version":1,"workspaceId":"${workspaceId}","epoch":1,"deviceId":"${deviceA.deviceId}","seq":7}`),
    duplicateKey: enc.encode(`{"format":"neuron-sync","version":1,"workspaceId":"${workspaceId}","epoch":1,"deviceId":"${deviceA.deviceId}","seq":7,"seq":7}`),
    floatEpoch: enc.encode(`{"format":"neuron-sync","version":1,"workspaceId":"${workspaceId}","epoch":1.0,"deviceId":"${deviceA.deviceId}","seq":7}`),
    extraField: headerOf([...commitHeaderFields(), ['x', 1]]),
  };
  for (const [name, headerBytes] of Object.entries(nonCanonical)) {
    rejects(() => sync.decodeCommit(assembleCommit({ headerBytes }), expectA()), 'shape', `non-canonical header: ${name}`);
  }
  assert.deepEqual(sync.decodeCommit(assembleCommit(), expectA()).body, sampleBody(), 'the canonical control decodes');
  rejects(() => sync.decodeCommit(assembleCommit({ headerBytes: headerOf(commitHeaderFields({ version: 2 })) }), expectA()), 'version', 'header version 2');
  rejects(() => sync.decodeCommit(assembleCommit({ headerBytes: headerOf(commitHeaderFields({ format: 'other' })) }), expectA()), 'shape', 'header format');
  rejects(() => sync.decodeCommit(assembleCommit({ headerBytes: headerOf(commitHeaderFields({ seq: 0 })) }), expectA()), 'shape', 'seq 0');
  rejects(() => sync.decodeCommit(assembleCommit({ headerBytes: headerOf(commitHeaderFields({ epoch: 2 ** 31 + 1 })) }), expectA()), 'shape', 'epoch over 2^31');
  tally('commit', Object.keys(nonCanonical).length + 5);

  // Body schema and bounds, behind a valid signature.
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const put = (path, extra = {}) => ({ path, kind: 'put', base: null, content: { chunks: [], size: 0, sha: hashOf('e') }, mode: 'file', ...extra });
  const badBodies = {
    'unknown top-level key': { ...sampleBody(), extra: 1 },
    'missing key': (({ time, ...rest }) => rest)(sampleBody()),
    '20 001 changes': { ...sampleBody(), changes: many(20_001, (i) => put(`f${i}`)) },
    'path of 1025 bytes': { ...sampleBody(), changes: [put('é'.repeat(512) + 'x')] },
    'empty path': { ...sampleBody(), changes: [put('')] },
    'NUL in path': { ...sampleBody(), changes: [put('a\u0000b')] },
    'lone surrogate in path': { ...sampleBody(), changes: [put('a\ud800b')] },
    'duplicate path': { ...sampleBody(), changes: [put('a'), put('a')] },
    '65 parents': { ...sampleBody(), parents: many(65, (i) => hashOf(`p${i}`)) },
    'duplicate parent': { ...sampleBody(), parents: [hashOf('p'), hashOf('p')] },
    'uppercase hash': { ...sampleBody(), parents: [hashOf('p').toUpperCase()] },
    '802 chunks': { ...sampleBody(), changes: [put('big', { content: { chunks: many(802, (i) => ({ blobId: hashOf(`c${i}`), blobKey: hashOf('k'), size: 1 })), size: 802, sha: hashOf('s') } })] },
    'chunk sizes do not add up': { ...sampleBody(), changes: [put('a', { content: { chunks: [{ blobId: hashOf('c'), blobKey: hashOf('k'), size: 5 }], size: 6, sha: hashOf('s') } })] },
    'chunk over 2 MiB': { ...sampleBody(), changes: [put('a', { content: { chunks: [{ blobId: hashOf('c'), blobKey: hashOf('k'), size: 2 * MiB + 1 }], size: 2 * MiB + 1, sha: hashOf('s') } })] },
    'delete with content': { ...sampleBody(), changes: [{ path: 'a', kind: 'delete', base: hashOf('b'), content: put('a').content, mode: 'file' }] },
    'delete without base': { ...sampleBody(), changes: [{ path: 'a', kind: 'delete', base: null, content: null, mode: 'file' }] },
    'unknown kind': { ...sampleBody(), changes: [{ ...put('a'), kind: 'rename' }] },
    'mode not file': { ...sampleBody(), changes: [put('a', { mode: 'symlink' })] },
    'body epoch differs from header': { ...sampleBody(), epoch: 2 },
    'negative time': { ...sampleBody(), time: -1 },
    'seenVector key not a device id': { ...sampleBody(), seenVector: { __proto__x: 1 } },
    'seenVector __proto__': JSON.parse(JSON.stringify(sampleBody()).replace('"seenVector":{', '"seenVector":{"__proto__":1,')),
    '1025 seenVector entries': { ...sampleBody(), seenVector: Object.fromEntries(many(1025, (i) => [hashOf(`d${i}`).slice(0, 32), 1])) },
    'unknown op': { ...sampleBody(), deviceOps: [{ op: 'promote', deviceId: deviceB.deviceId }] },
    'op with an extra key': { ...sampleBody(), deviceOps: [{ op: 'remove', deviceId: deviceB.deviceId, why: 'x' }] },
    '65 ops': { ...sampleBody(), deviceOps: many(65, () => ({ op: 'remove', deviceId: deviceB.deviceId })) },
    'add with a deviceId not derived from signPub': { ...sampleBody(), deviceOps: [{ ...sampleBody().deviceOps[0], deviceId: deviceA.deviceId }] },
    'add with a control character in the label': { ...sampleBody(), deviceOps: [{ ...sampleBody().deviceOps[0], label: 'a\u0007b' }] },
    'add with a bidi override in the label': { ...sampleBody(), deviceOps: [{ ...sampleBody().deviceOps[0], label: 'a‮b' }] },
    'add with a 65-byte label': { ...sampleBody(), deviceOps: [{ ...sampleBody().deviceOps[0], label: 'x'.repeat(65) }] },
    'add with an empty label': { ...sampleBody(), deviceOps: [{ ...sampleBody().deviceOps[0], label: '' }] },
    'rotate to the same epoch': { ...sampleBody(), deviceOps: [{ op: 'rotate', epoch: 1 }] },
    'rotate past 2^31': { ...sampleBody(), deviceOps: [{ op: 'rotate', epoch: 2 ** 31 + 1 }] },
    'two rotates': { ...sampleBody(), deviceOps: [{ op: 'rotate', epoch: 2 }, { op: 'rotate', epoch: 3 }] },
  };
  for (const [name, body] of Object.entries(badBodies)) {
    rejects(() => sync.decodeCommit(assembleCommit({ body }), expectA()), 'shape', `commit body: ${name}`);
    rejects(() => sync.encodeCommit(commitInput({ body }), wk1, deviceA), ['shape', 'size'], `encoder refuses body: ${name}`);
  }
  const okBodies = {
    '20 000 changes': { ...sampleBody(), changes: many(20_000, (i) => put(`f${i}`)) },
    'path of 1024 bytes': { ...sampleBody(), changes: [put('é'.repeat(512))] },
    '64 parents': { ...sampleBody(), parents: many(64, (i) => hashOf(`p${i}`)) },
    '801 chunks': { ...sampleBody(), changes: [put('big', { content: { chunks: many(801, (i) => ({ blobId: hashOf(`c${i}`), blobKey: hashOf('k'), size: 1 })), size: 801, sha: hashOf('s') } })] },
    'label of 64 bytes': { ...sampleBody(), deviceOps: [{ ...sampleBody().deviceOps[0], label: 'é'.repeat(32) }] },
    'first commit': { parents: [], seenVector: {}, epoch: 1, time: 0, changes: [], deviceOps: [] },
  };
  for (const [name, body] of Object.entries(okBodies)) {
    assert.deepEqual(sync.decodeCommit(sync.encodeCommit(commitInput({ body }), wk1, deviceA), expectA()).body, body, `commit body at the bound: ${name}`);
  }
  for (const [name, bodyBytes] of Object.entries({ 'not JSON': enc.encode('{nope'), 'not UTF-8': new Uint8Array([0x7b, 0xff, 0x7d]), 'JSON array': enc.encode('[]'), 'JSON null': enc.encode('null') })) {
    rejects(() => sync.decodeCommit(assembleCommit({ bodyBytes }), expectA()), 'shape', `commit body ${name}`);
  }
  tally('commit', 2 * Object.keys(badBodies).length + Object.keys(okBodies).length + 4);

  // Truncation around each length field.
  rejects(() => sync.decodeCommit(new Uint8Array(0), expectA()), 'size', 'empty commit');
  rejects(() => sync.decodeCommit(commit.subarray(0, 6), expectA()), 'size', 'commit cut inside the header length');
  rejects(() => sync.decodeCommit(commit.subarray(0, 7 + H + 24 + 16 + 64 - 1), expectA()), 'size', 'commit one byte short of header+nonce+tag+signature');
  rejects(() => sync.decodeCommit(commit.subarray(0, commit.length - 1), expectA()), 'signature', 'commit one byte short');
  const longHeader = commit.slice();
  longHeader[5] = 0xff;
  rejects(() => sync.decodeCommit(longHeader, expectA()), 'size', 'header length over the cap');
  const shortHeader = commit.slice();
  shortHeader[5] = 0; shortHeader[6] = 1;
  rejects(() => sync.decodeCommit(shortHeader, expectA()), 'size', 'header length 1');
  tally('commit', 6);

  // Size before anything.
  const oversized = new Uint8Array(LIMITS.commitMax + 1);
  oversized.set(commit.subarray(0, 64));
  const sizeCalls = spy(['crypto_aead_xchacha20poly1305_ietf_decrypt', 'crypto_sign_verify_detached'], () => {
    rejects(() => sync.decodeCommit(oversized, expectA()), 'size', 'oversized commit');
    rejects(() => sync.decodeCommit(new Proxy(new Uint8Array(LIMITS.commitMax + 1), { get: (t, p) => (p === 'length' ? t.length : assert.fail(`read ${String(p)}`)) }), expectA()), 'size', 'oversized commit (unreadable)');
  });
  assert.deepEqual(Object.values(sizeCalls), [0, 0], 'no verify or decrypt on an oversized commit');
  tally('commit', 3);
}

// --- envelopes --------------------------------------------------------------
const ctx = { workspaceId, epoch: 1 };
const recoveryKey = keysTestSeams.generateRecoveryKeyWith(seqRng('rk'));
const recoveryKeyOther = keysTestSeams.generateRecoveryKeyWith(seqRng('rk-other'));
const cheapKdf = (passphrase) => (salt) => s.crypto_generichash(32, concat(salt, enc.encode(passphrase)), null);
const deviceEnvelope = withDeterministicSodium(11, () => sync.encodeDeviceEnvelope(wk1, ctx, deviceA));
const recoveryEnvelope = formatTestSeams.encodeRecoveryEnvelopeWith(seqRng('rk-env'), wk1, ctx, recoveryKey);
// For tamper and fuzz runs, an envelope whose wrapping key comes from the cheap KDF.
const cheapPassphraseEnvelope = (() => {
  const salt = labelBytes('pp-salt', 16);
  const nonce = labelBytes('pp-nonce', 24);
  // Build through the real encoder, with a seam rng that returns salt then nonce, then rewrap with the cheap key.
  const real = formatTestSeams.encodePassphraseEnvelopeWith(((q) => () => q.shift())([salt, nonce]), wk1, ctx, 'correct horse battery staple');
  const boundEnd = real.length - 24 - 80;
  const bound = real.subarray(0, boundEnd);
  const sealed = concat(s.crypto_generichash(32, bound, null), wk1);
  return { real, cheap: concat(bound, nonce, s.crypto_aead_xchacha20poly1305_ietf_encrypt(sealed, bound, null, nonce, cheapKdf('pw')(salt))) };
})();
{
  assert.deepEqual(sync.openDeviceEnvelope(deviceEnvelope, ctx, deviceA), wk1);
  assert.deepEqual(sync.openDeviceEnvelope(sync.encodeDeviceEnvelope(wk2, { workspaceId, epoch: 2 }, deviceB), { workspaceId, epoch: 2 }, deviceB), wk2);
  assert.deepEqual(sync.openRecoveryEnvelope(recoveryEnvelope, ctx, recoveryKey), wk1);
  assert.deepEqual(sync.openRecoveryEnvelope(sync.encodeRecoveryEnvelope(wk1, ctx, recoveryKey), ctx, recoveryKey), wk1);
  assert.deepEqual(sync.openRecoveryEnvelope(recoveryEnvelope, ctx, sync.parseRecoveryKey(sync.formatRecoveryKey(recoveryKey).toLowerCase())), wk1, 'typed recovery key opens it');
  assert.deepEqual(formatTestSeams.openPassphraseEnvelopeWithKdf(cheapPassphraseEnvelope.cheap, ctx, cheapKdf('pw')), wk1);
  const t0 = Date.now();
  assert.deepEqual(sync.openPassphraseEnvelope(cheapPassphraseEnvelope.real, ctx, 'correct horse battery staple'), wk1);
  assert.deepEqual(sync.openPassphraseEnvelope(cheapPassphraseEnvelope.real, ctx, 'correct horse battery staple'.normalize('NFD')), wk1, 'NFC-normalised');
  rejects(() => sync.openPassphraseEnvelope(cheapPassphraseEnvelope.real, ctx, 'wrong horse battery staple'), 'auth', 'wrong passphrase');
  const fresh = sync.encodePassphraseEnvelope(wk2, ctx, 'p');
  assert.deepEqual(sync.openPassphraseEnvelope(fresh, ctx, 'p'), wk2);
  console.log(`  passphrase envelope: 5 Argon2id (MODERATE) derivations took ${Date.now() - t0} ms`);
  assert.equal(deviceEnvelope.length, 8 + deviceEnvelope[7] + 112);
  tally('envelope', 11);

  // Wrong recipient, wrong recovery key, mixed-up context.
  rejects(() => sync.openDeviceEnvelope(deviceEnvelope, ctx, deviceB), 'auth', 'device envelope opened by another device');
  rejects(() => sync.openDeviceEnvelope(deviceEnvelope, ctx, { ...deviceB, deviceId: deviceA.deviceId }), 'auth', 'device envelope with B\'s box key under A\'s id');
  rejects(() => sync.openRecoveryEnvelope(recoveryEnvelope, ctx, recoveryKeyOther), 'auth', 'recovery key of another workspace');
  const otherCtx = { workspaceId: otherWorkspaceId, epoch: 1 };
  const otherEnvelope = formatTestSeams.encodeRecoveryEnvelopeWith(seqRng('o'), wkOther, otherCtx, recoveryKeyOther);
  rejects(() => sync.openRecoveryEnvelope(otherEnvelope, ctx, recoveryKeyOther), 'auth', 'envelope from another workspace');
  rejects(() => sync.openRecoveryEnvelope(recoveryEnvelope, { workspaceId, epoch: 2 }, recoveryKey), 'auth', 'envelope for another epoch');
  rejects(() => sync.openRecoveryEnvelope(deviceEnvelope, ctx, recoveryKey), 'auth', 'device envelope opened as recovery');
  rejects(() => sync.openDeviceEnvelope(recoveryEnvelope, ctx, deviceA), 'auth', 'recovery envelope opened as device');
  tally('envelope', 7);

  // The header binding: swap a validly sealed payload under a different header.
  const forged = (() => {
    const header = enc.encode(`{"workspaceId":"${otherWorkspaceId}","epoch":1,"recipient":"recovery"}`);
    const bound = concat(prefix('NSYE'), new Uint8Array([2]), u16(header.length), header);
    return concat(bound, recoveryEnvelope.subarray(recoveryEnvelope.length - 104));
  })();
  rejects(() => sync.openRecoveryEnvelope(forged, otherCtx, recoveryKey), 'auth', 'sealed payload moved under another header');
  // box_seal has no AD: a payload sealed for A over a header naming epoch 2 must fail the hash check.
  const resealed = (() => {
    const header = enc.encode(`{"workspaceId":"${workspaceId}","epoch":2,"recipient":"${deviceA.deviceId}"}`);
    const bound = concat(prefix('NSYE'), new Uint8Array([1]), u16(header.length), header);
    const originalBound = deviceEnvelope.subarray(0, deviceEnvelope.length - 112);
    return concat(bound, s.crypto_box_seal(concat(s.crypto_generichash(32, originalBound, null), wk1), deviceA.boxPublicKey));
  })();
  const resealErr = rejects(() => sync.openDeviceEnvelope(resealed, { workspaceId, epoch: 2 }, deviceA), 'auth', 'box_seal payload bound to another header');
  assert.match(resealErr.message, /binding/);
  // Non-canonical envelope headers.
  for (const header of [
    `{"epoch":1,"workspaceId":"${workspaceId}","recipient":"recovery"}`,
    `{"workspaceId":"${workspaceId}", "epoch":1,"recipient":"recovery"}`,
    `{"workspaceId":"${workspaceId}","epoch":1,"recipient":"recovery","x":1}`,
  ]) {
    const h = enc.encode(header);
    const bound = concat(prefix('NSYE'), new Uint8Array([2]), u16(h.length), h);
    const nonce = labelBytes('n', 24);
    const sealed = s.crypto_aead_xchacha20poly1305_ietf_encrypt(concat(s.crypto_generichash(32, bound, null), wk1), bound, null, nonce, sync.deriveRecoveryWrappingKey(recoveryKey));
    rejects(() => sync.openRecoveryEnvelope(concat(bound, nonce, sealed), ctx, recoveryKey), 'shape', `non-canonical envelope header ${header.slice(0, 20)}…`);
  }
  tally('envelope', 5);

  // Tamper: every byte, by class.
  const tamperAll = (bytes, open, classOf, what) => {
    for (let i = 0; i < bytes.length; i++) {
      for (const bit of [0x01, 0x80]) {
        const t = bytes.slice();
        t[i] ^= bit;
        rejects(() => open(t), classOf(i), `${what} byte ${i} ^ ${bit}`);
      }
    }
    tally('envelope', 2 * bytes.length);
  };
  const envClass = (bytes) => {
    const headEnd = 8 + ((bytes[6] << 8) | bytes[7]);
    return (i) => (i < 4 ? ['magic'] : i === 4 ? ['version'] : i === 5 ? ['shape', 'size'] : i < 8 ? ['size'] : i < headEnd ? ['shape', 'auth'] : ['auth']);
  };
  tamperAll(deviceEnvelope, (t) => sync.openDeviceEnvelope(t, ctx, deviceA), envClass(deviceEnvelope), 'device envelope');
  tamperAll(recoveryEnvelope, (t) => sync.openRecoveryEnvelope(t, ctx, recoveryKey), envClass(recoveryEnvelope), 'recovery envelope');
  tamperAll(cheapPassphraseEnvelope.cheap, (t) => formatTestSeams.openPassphraseEnvelopeWithKdf(t, ctx, cheapKdf('pw')), envClass(cheapPassphraseEnvelope.cheap), 'passphrase envelope (cheap KDF)');
  // And once per class with the real Argon2id: salt, nonce, ciphertext, tag.
  const real = cheapPassphraseEnvelope.real;
  const headEnd = 8 + ((real[6] << 8) | real[7]);
  for (const [name, at] of [['salt', headEnd], ['nonce', headEnd + 16], ['ciphertext', headEnd + 40], ['tag', real.length - 1]]) {
    const t = real.slice();
    t[at] ^= 1;
    rejects(() => sync.openPassphraseEnvelope(t, ctx, 'correct horse battery staple'), 'auth', `passphrase envelope ${name} (Argon2id)`);
  }
  tally('envelope', 4);

  // Truncation and size.
  for (const [name, bytes] of [['device', deviceEnvelope], ['recovery', recoveryEnvelope]]) {
    const open = name === 'device' ? (t) => sync.openDeviceEnvelope(t, ctx, deviceA) : (t) => sync.openRecoveryEnvelope(t, ctx, recoveryKey);
    rejects(() => open(new Uint8Array(0)), 'size', `${name}: empty`);
    rejects(() => open(bytes.subarray(0, 7)), 'size', `${name}: cut inside the header length`);
    rejects(() => open(bytes.subarray(0, bytes.length - 1)), 'size', `${name}: one byte short`);
    rejects(() => open(concat(bytes, new Uint8Array(1))), 'size', `${name}: one byte long`);
  }
  const big = new Uint8Array(LIMITS.envelopeMax + 1);
  big.set(deviceEnvelope);
  const envCalls = spy(['crypto_box_seal_open', 'crypto_aead_xchacha20poly1305_ietf_decrypt', 'crypto_pwhash'], () => {
    rejects(() => sync.openDeviceEnvelope(big, ctx, deviceA), 'size', 'oversized device envelope');
    rejects(() => sync.openPassphraseEnvelope(new Proxy(new Uint8Array(LIMITS.envelopeMax + 1), { get: (t, p) => (p === 'length' ? t.length : assert.fail(`read ${String(p)}`)) }), ctx, 'pw'), 'size', 'oversized passphrase envelope (unreadable)');
  });
  assert.deepEqual(Object.values(envCalls), [0, 0, 0], 'no decrypt or Argon2 on an oversized envelope');
  tally('envelope', 11);
}

// --- seeded byte-mutation fuzz ------------------------------------------------
const MUTATIONS = Number(process.env.SYNC_FUZZ_MUTATIONS ?? 2500);
function mutate(bytes, next) {
  for (;;) {
    const out = (() => {
      const pick = (n) => next() % n;
      switch (pick(7)) {
        case 0: { const t = bytes.slice(); const i = pick(t.length); t[i] ^= 1 << pick(8); return t; }
        case 1: { const t = bytes.slice(); t[pick(t.length)] = pick(256); return t; }
        case 2: { const i = pick(bytes.length + 1); return concat(bytes.subarray(0, i), new Uint8Array([pick(256)]), bytes.subarray(i)); }
        case 3: { const i = pick(bytes.length); return concat(bytes.subarray(0, i), bytes.subarray(i + 1)); }
        case 4: return bytes.slice(0, pick(bytes.length));
        case 5: return concat(bytes, Uint8Array.from({ length: 1 + pick(16) }, () => pick(256)));
        default: {
          const t = bytes.slice();
          for (let k = 0, n = 2 + pick(6); k < n; k++) t[pick(t.length)] = pick(256);
          return t;
        }
      }
    })();
    if (!sync.bytesEqual(out, bytes)) return out;
  }
}
function fuzz(name, valid, decode, seed) {
  const next = prng(seed);
  const codes = {};
  for (let i = 0; i < MUTATIONS; i++) {
    const input = mutate(valid, next);
    let result;
    try {
      result = decode(input);
    } catch (error) {
      if (!(error instanceof sync.SyncFormatError)) throw new Error(`fuzz ${name} #${i}: threw ${error?.name}: ${error?.message}`);
      codes[error.code] = (codes[error.code] ?? 0) + 1;
      continue;
    }
    assert.fail(`fuzz ${name} #${i}: accepted a mutated input (${typeof result})`);
  }
  tally('fuzz', MUTATIONS);
  console.log(`  fuzz ${name}: ${MUTATIONS} mutations rejected (${Object.entries(codes).map(([c, n]) => `${c} ${n}`).join(', ')})`);
}
{
  fuzz('blob', smallBlob, (b) => sync.decodeBlob(b, blobKey), 1);
  fuzz('commit', commit, (b) => sync.decodeCommit(b, expectA()), 2);
  fuzz('device envelope', deviceEnvelope, (b) => sync.openDeviceEnvelope(b, ctx, deviceA), 3);
  fuzz('recovery envelope', recoveryEnvelope, (b) => sync.openRecoveryEnvelope(b, ctx, recoveryKey), 4);
  fuzz('passphrase envelope (cheap KDF)', cheapPassphraseEnvelope.cheap, (b) => formatTestSeams.openPassphraseEnvelopeWithKdf(b, ctx, cheapKdf('pw')), 5);
  const rkText = enc.encode(sync.formatRecoveryKey(recoveryKey));
  // A recovery-key mutation can be harmless (case, separators, I/L/O): those must decode to the same key.
  {
    const next = prng(6);
    let rejected = 0;
    let equivalent = 0;
    for (let i = 0; i < MUTATIONS; i++) {
      const input = new TextDecoder().decode(mutate(rkText, next));
      try {
        assert.deepEqual(sync.parseRecoveryKey(input), recoveryKey, `fuzz recovery key #${i}: "${input}" decoded to another key`);
        equivalent++;
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        if (!(error instanceof sync.SyncFormatError)) throw new Error(`fuzz recovery key #${i}: threw ${error?.name}`);
        rejected++;
      }
    }
    tally('fuzz', MUTATIONS);
    console.log(`  fuzz recovery key: ${MUTATIONS} mutations, ${rejected} rejected, ${equivalent} equivalent spellings of the same key, 0 other keys`);
  }
  // The public identity binds deviceId to signPub only; boxPub has no integrity of
  // its own (it travels over SAS pairing or inside a signed `add` op). So an
  // accepted mutation must keep the same deviceId and signPub.
  {
    const identity = enc.encode(sync.serialisePublicIdentity(deviceA));
    const next = prng(7);
    let rejected = 0;
    let boxOnly = 0;
    for (let i = 0; i < MUTATIONS; i++) {
      const input = new TextDecoder().decode(mutate(identity, next));
      let parsed;
      try {
        parsed = sync.parsePublicIdentity(input);
      } catch (error) {
        if (!(error instanceof sync.SyncFormatError)) throw new Error(`fuzz public identity #${i}: threw ${error?.name}`);
        rejected++;
        continue;
      }
      assert.equal(parsed.deviceId, deviceA.deviceId, `fuzz public identity #${i}`);
      assert.deepEqual(parsed.signPublicKey, deviceA.signPublicKey, `fuzz public identity #${i}`);
      assert.notDeepEqual(parsed.boxPublicKey, deviceA.boxPublicKey);
      boxOnly++;
    }
    tally('fuzz', MUTATIONS);
    console.log(`  fuzz public identity: ${MUTATIONS} mutations, ${rejected} rejected, ${boxOnly} changed boxPub only (not bound by the identity; see format-v1.md)`);
  }

  // Body fuzz: mutated plaintext JSON behind a valid signature and AEAD. Success is
  // allowed here (the input is authentic); anything thrown must be SyncFormatError.
  const next = prng(8);
  const bodyJson = enc.encode(JSON.stringify(sampleBody()));
  let accepted = 0;
  for (let i = 0; i < MUTATIONS; i++) {
    const bodyBytes = mutate(bodyJson, next);
    try {
      sync.decodeCommit(assembleCommit({ bodyBytes, nonce: labelBytes('fuzz', 24, i) }), expectA());
      accepted++;
    } catch (error) {
      if (!(error instanceof sync.SyncFormatError)) throw new Error(`fuzz commit body #${i}: threw ${error?.name}: ${error?.message}`);
      assert.equal(error.code, 'shape', `fuzz commit body #${i}`);
    }
  }
  tally('fuzz', MUTATIONS);
  console.log(`  fuzz commit body (validly signed): ${MUTATIONS} mutations, ${MUTATIONS - accepted} shape errors, ${accepted} still-valid bodies`);
}

// --- known-answer vectors -------------------------------------------------------
{
  const fixedWk = Uint8Array.from({ length: 32 }, (_, i) => i);
  const keyVectors = {
    note: 'Inputs are XChaCha20 keystreams under BLAKE2b-256(label) unless given as hex.',
    devices: [['device-a', deviceA], ['device-b', deviceB]].map(([label, d]) => ({
      boxSeed: hex(labelBytes(`${label}-box-seed`, 32)),
      signSeed: hex(labelBytes(`${label}-sign-seed`, 32)),
      boxPublicKey: hex(d.boxPublicKey),
      boxPrivateKey: hex(d.boxPrivateKey),
      signPublicKey: hex(d.signPublicKey),
      deviceId: d.deviceId,
      identity: sync.serialisePublicIdentity(d),
    })),
    workspaceKey: hex(fixedWk),
    subkeys: Object.fromEntries(['commit', 'blobid', 'history', 'cdc', 'blobkey'].map((p) => [p, hex(sync.deriveSubkey(fixedWk, p))])),
    recovery: [new Uint8Array(32), new Uint8Array(32).fill(255), fixedWk, recoveryKey].map((rk) => ({
      key: hex(rk), text: sync.formatRecoveryKey(rk), wrappingKey: hex(sync.deriveRecoveryWrappingKey(rk)),
    })),
    passphrase: { passphrase: 'correct horse battery staple', salt: hex(labelBytes('pp-salt', 16)), key: hex(sync.derivePassphraseKey('correct horse battery staple', labelBytes('pp-salt', 16))) },
  };
  const frozenKeys = checkVectors('keys.json', keyVectors);
  for (const d of frozenKeys.devices) {
    const back = sync.parsePublicIdentity(d.identity);
    assert.equal(back.deviceId, d.deviceId);
    assert.equal(hex(back.signPublicKey), d.signPublicKey);
  }
  for (const r of frozenKeys.recovery) assert.equal(hex(sync.parseRecoveryKey(r.text)), r.key);
  tally('vectors', 3);

  const blobkeyFixed = sync.deriveSubkey(fixedWk, 'blobkey');
  const blobidFixed = sync.deriveSubkey(fixedWk, 'blobid');
  const blobVectors = {
    note: 'WK = keys.json workspaceKey. Plaintext = XChaCha20 keystream under BLAKE2b-256("blob-<length>"). blobKey = BLAKE2b-256(key = blobkey subkey, chunk). The secretstream header comes from libsodium\'s RNG, made deterministic in the test with mulberry32(seed) feeding getRandomValue. Encodings over 16 KiB are given by BLAKE2b-256 hash.',
    blobkeySubkey: hex(blobkeyFixed),
    blobidKey: hex(blobidFixed),
    blobs: [1, 4095, 4096, 65535, 65536, MiB - 1, MiB, 2 * MiB].map((length, i) => {
      const chunk = labelBytes(`blob-${length}`, length);
      const key = sync.blobKeyFor(chunk, blobkeyFixed);
      const bytes = withDeterministicSodium(100 + i, () => sync.encodeBlob(chunk, key));
      return {
        chunkLength: length, rngSeed: 100 + i, paddedLength: sync.paddedSize(length), encodedLength: bytes.length,
        blobKey: hex(key),
        blobId: sync.blobId(chunk, blobidFixed),
        ...(bytes.length <= 16 * KiB ? { encoded: hex(bytes) } : { encodedHash: hex(s.crypto_generichash(32, bytes, null)) }),
      };
    }),
  };
  const frozenBlobs = checkVectors('blobs.json', blobVectors);
  for (const v of frozenBlobs.blobs.filter((b) => b.encoded)) {
    assert.deepEqual(sync.decodeBlob(unhex(v.encoded), unhex(v.blobKey), { blobidKey: blobidFixed, blobId: v.blobId }), labelBytes(`blob-${v.chunkLength}`, v.chunkLength), 'frozen blob decodes');
  }
  tally('vectors', 2);

  const commitVectorInput = { workspaceId, epoch: 1, seq: 7, body: sampleBody() };
  const commitBytes = formatTestSeams.encodeCommitWith(() => labelBytes('commit-nonce', 24), commitVectorInput, fixedWk, deviceA);
  const commitVectors = {
    note: 'Signer = devices[0] of keys.json; workspace key = keys.json workspaceKey; nonce = keystream("commit-nonce").',
    input: commitVectorInput,
    nonce: hex(labelBytes('commit-nonce', 24)),
    encoded: hex(commitBytes),
    hash: sync.commitHash(commitBytes),
  };
  const frozenCommit = checkVectors('commit.json', commitVectors);
  const decoded = sync.decodeCommit(unhex(frozenCommit.encoded), { workspaceId, signPublicKey: deviceA.signPublicKey, workspaceKeyForEpoch: (e) => (e === 1 ? fixedWk : undefined) });
  assert.deepEqual(decoded.body, frozenCommit.input.body);
  assert.equal(decoded.hash, frozenCommit.hash);
  tally('vectors', 2);

  const envCtx = { workspaceId, epoch: 1 };
  const rkFixed = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
  const queue = (...blocks) => () => blocks.shift();
  const envelopeVectors = {
    note: 'WK = keys.json workspaceKey. Device envelope: sealed-box ephemeral key from libsodium\'s RNG under mulberry32(seed). Recipient = keys.json devices[0].',
    context: envCtx,
    device: { rngSeed: 21, encoded: hex(withDeterministicSodium(21, () => sync.encodeDeviceEnvelope(fixedWk, envCtx, deviceA))) },
    recovery: { recoveryKey: hex(rkFixed), nonce: hex(labelBytes('rk-nonce', 24)), encoded: hex(formatTestSeams.encodeRecoveryEnvelopeWith(queue(labelBytes('rk-nonce', 24)), fixedWk, envCtx, rkFixed)) },
    passphrase: {
      passphrase: 'correct horse battery staple', salt: hex(labelBytes('pp-salt', 16)), nonce: hex(labelBytes('pp-nonce', 24)),
      encoded: hex(formatTestSeams.encodePassphraseEnvelopeWith(queue(labelBytes('pp-salt', 16), labelBytes('pp-nonce', 24)), fixedWk, envCtx, 'correct horse battery staple')),
    },
  };
  const frozenEnv = checkVectors('envelopes.json', envelopeVectors);
  assert.deepEqual(sync.openDeviceEnvelope(unhex(frozenEnv.device.encoded), envCtx, deviceA), fixedWk);
  assert.deepEqual(sync.openRecoveryEnvelope(unhex(frozenEnv.recovery.encoded), envCtx, rkFixed), fixedWk);
  assert.deepEqual(sync.openPassphraseEnvelope(unhex(frozenEnv.passphrase.encoded), envCtx, frozenEnv.passphrase.passphrase), fixedWk);
  tally('vectors', 4);
}

for (const [suite, n] of Object.entries(counts)) console.log(`  ${suite}: ${n} checks`);
console.log(`sync-crypto: all checks passed (${Object.values(counts).reduce((a, b) => a + b, 0)} total)`);
