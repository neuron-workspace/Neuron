// Encoders and decoders for the encrypted sync objects, format version 1
// (docs/sync/format-v1.md). Every decoder checks the size first, then magic and
// version, and returns a whole object or throws SyncFormatError. No electron.
import { z } from 'zod';
import {
  bytesEqual, canonicalHeader, concatBytes, decodeUtf8, fail, fromHex, isHex, isWellFormed,
  parseCanonicalHeader, readU16be, SyncFormatError, toHex, u16be, utf8, utf8Length,
} from './codec';
import { deriveDeviceId, derivePassphraseKey, deriveRecoveryWrappingKey, deriveSubkey, KEY_BYTES, PASSPHRASE_SALT_BYTES } from './keys';
import { Rng, sodium, systemRng } from './sodium';

export const FORMAT_VERSION = 1;
export const MAGIC = { blob: 'NSYB', commit: 'NSYC', envelope: 'NSYE', checkpoint: 'NSYK' } as const;
const PREFIX_BYTES = 5; // 4-byte magic + 1-byte version

const KiB = 1024;
const MiB = 1024 * KiB;

export const LIMITS = {
  chunkMax: 2 * MiB,
  fileMax: 100 * MiB,
  /** (100 MiB / 128 KiB) + 1 */
  chunksPerFile: (100 * MiB) / (128 * KiB) + 1,
  commitMax: 16 * MiB,
  commitHeaderMax: 1024,
  changes: 20_000,
  pathBytes: 1024,
  parents: 64,
  deviceOps: 64,
  seenVector: 1024,
  labelBytes: 64,
  epochMax: 2 ** 31,
  envelopeMax: 1024,
  envelopeHeaderMax: 256,
} as const;

function prefix(magic: string): Uint8Array {
  const out = new Uint8Array(PREFIX_BYTES);
  for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i);
  out[4] = FORMAT_VERSION;
  return out;
}

function checkPrefix(bytes: Uint8Array, magic: string): void {
  for (let i = 0; i < 4; i++) if (bytes[i] !== magic.charCodeAt(i)) fail('magic', `not a ${magic} object`);
  if (bytes[4] !== FORMAT_VERSION) fail('version', `unsupported ${magic} version ${bytes[4]}`);
}

function requireBytes(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) fail('shape', 'input is not bytes');
}

function requireKey(key: Uint8Array, what: string): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) fail('shape', `${what} must be 32 bytes`);
}

const hash32 = (bytes: Uint8Array, key: Uint8Array | null = null): Uint8Array => sodium().crypto_generichash(32, bytes, key);

// --- padding buckets ----------------------------------------------------------
// sodium_pad always appends at least one byte (0x80, then zeros), so a chunk of
// n bytes is padded to the smallest bucket that holds n + 1 bytes.

const roundUp = (value: number, step: number): number => Math.ceil(value / step) * step;

/** Bucket for a needed length: ≥ 4 KiB; ≤ 64 KiB in 4 KiB steps; ≤ 1 MiB in 64 KiB steps; above in 256 KiB steps. */
export function bucketSize(needed: number): number {
  if (!Number.isSafeInteger(needed) || needed < 0) throw new RangeError('bucket size needs a non-negative integer');
  if (needed <= 64 * KiB) return Math.max(4 * KiB, roundUp(needed, 4 * KiB));
  if (needed <= MiB) return roundUp(needed, 64 * KiB);
  return roundUp(needed, 256 * KiB);
}

/** Padded plaintext length of a chunk of `chunkLength` bytes. */
export const paddedSize = (chunkLength: number): number => bucketSize(chunkLength + 1);

const PADDED_MAX = paddedSize(LIMITS.chunkMax);

function isPaddedSize(n: number): boolean {
  if (n < 4 * KiB || n > PADDED_MAX) return false;
  if (n <= 64 * KiB) return n % (4 * KiB) === 0;
  if (n <= MiB) return n % (64 * KiB) === 0;
  return n % (256 * KiB) === 0;
}

// --- blob ---------------------------------------------------------------------
// prefix(5) ‖ secretstream header(24) ‖ messages. The padded chunk is pushed in
// 64 KiB pieces, each with the 5-byte prefix as associated data; only the last
// carries TAG_FINAL.

const STREAM_HEADER_BYTES = 24;
const STREAM_ABYTES = 17;
export const STREAM_MESSAGE_BYTES = 64 * KiB;
const BLOB_BODY_OFFSET = PREFIX_BYTES + STREAM_HEADER_BYTES;
export const BLOB_MIN_BYTES = BLOB_BODY_OFFSET + 4 * KiB + STREAM_ABYTES;
export const BLOB_MAX_BYTES = BLOB_BODY_OFFSET + PADDED_MAX + Math.ceil(PADDED_MAX / STREAM_MESSAGE_BYTES) * STREAM_ABYTES;

/** Blob ID: BLAKE2b-256 of the plaintext chunk keyed with the blobid subkey, hex. */
export function blobId(chunk: Uint8Array, blobidKey: Uint8Array): string {
  requireKey(blobidKey, 'blobid subkey');
  return toHex(hash32(chunk, blobidKey));
}

/**
 * Blob key: BLAKE2b-256 of the plaintext chunk keyed with the blobkey subkey.
 * Convergent within a workspace epoch, so two devices that upload the same
 * chunk (or one device re-uploading after a crash) write blobs that open with
 * the same key whichever copy won the write-once name. It reveals only chunk
 * equality, which the blob ID already reveals.
 */
export function blobKeyFor(chunk: Uint8Array, blobkeySubkey: Uint8Array): Uint8Array {
  requireBytes(chunk);
  requireKey(blobkeySubkey, 'blobkey subkey');
  return hash32(chunk, blobkeySubkey);
}

export function encodeBlob(chunk: Uint8Array, blobKey: Uint8Array): Uint8Array {
  requireBytes(chunk);
  if (chunk.length < 1 || chunk.length > LIMITS.chunkMax) fail('size', 'a chunk is 1 byte to 2 MiB');
  requireKey(blobKey, 'blob key');
  const s = sodium();
  const padded = s.pad(chunk, paddedSize(chunk.length));
  const head = prefix(MAGIC.blob);
  const { state, header } = s.crypto_secretstream_xchacha20poly1305_init_push(blobKey);
  const parts = [head, header];
  for (let offset = 0; offset < padded.length; offset += STREAM_MESSAGE_BYTES) {
    const last = offset + STREAM_MESSAGE_BYTES >= padded.length;
    const tag = last ? s.crypto_secretstream_xchacha20poly1305_TAG_FINAL : s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    parts.push(s.crypto_secretstream_xchacha20poly1305_push(state, padded.subarray(offset, offset + STREAM_MESSAGE_BYTES), head, tag));
  }
  return concatBytes(...parts);
}

export interface BlobExpectation {
  blobidKey: Uint8Array;
  blobId: string;
}

/** The plaintext chunk. With `expect`, also checks the chunk hashes to the blob ID it was fetched under. */
export function decodeBlob(bytes: Uint8Array, blobKey: Uint8Array, expect?: BlobExpectation): Uint8Array {
  requireBytes(bytes);
  if (bytes.length < BLOB_MIN_BYTES || bytes.length > BLOB_MAX_BYTES) fail('size', 'blob size is out of range');
  checkPrefix(bytes, MAGIC.blob);
  requireKey(blobKey, 'blob key');

  const body = bytes.subarray(BLOB_BODY_OFFSET);
  const full = STREAM_MESSAGE_BYTES + STREAM_ABYTES;
  const rest = body.length % full;
  if (rest !== 0 && rest <= STREAM_ABYTES) fail('size', 'blob ends inside a message');
  const count = Math.floor(body.length / full) + (rest === 0 ? 0 : 1);
  if (!isPaddedSize(body.length - count * STREAM_ABYTES)) fail('size', 'blob length is not a padding bucket');

  const s = sodium();
  const head = bytes.subarray(0, PREFIX_BYTES);
  let state;
  try {
    state = s.crypto_secretstream_xchacha20poly1305_init_pull(bytes.subarray(PREFIX_BYTES, BLOB_BODY_OFFSET), blobKey);
  } catch {
    return fail('auth', 'blob stream header rejected');
  }
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const message = body.subarray(i * full, Math.min((i + 1) * full, body.length));
    let result: { message: Uint8Array; tag: number } | false;
    try {
      result = s.crypto_secretstream_xchacha20poly1305_pull(state, message, head);
    } catch {
      result = false;
    }
    if (!result) fail('auth', 'blob does not authenticate');
    const final = result.tag === s.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
    if (i < count - 1 && result.tag !== s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE) fail('auth', 'unexpected tag inside the blob stream');
    if (i === count - 1 && !final) fail('auth', 'blob stream is truncated (no final tag)');
    pieces.push(result.message);
  }
  const padded = concatBytes(...pieces);
  let chunk: Uint8Array;
  try {
    chunk = s.unpad(padded, padded.length);
  } catch {
    return fail('shape', 'blob padding is invalid');
  }
  if (chunk.length < 1 || paddedSize(chunk.length) !== padded.length) fail('shape', 'blob padding is not canonical');
  if (expect && blobId(chunk, expect.blobidKey) !== expect.blobId) fail('auth', 'blob content does not match its ID');
  return chunk;
}

// --- commit -------------------------------------------------------------------
// prefix(5) ‖ u16 header length ‖ header ‖ nonce(24) ‖ AEAD ciphertext ‖ Ed25519 signature(64).
// AD = every byte before the nonce. The signature covers every byte before it.

const NONCE_BYTES = 24;
const AEAD_ABYTES = 16;
const SIGNATURE_BYTES = 64;
const COMMIT_MIN_BYTES = PREFIX_BYTES + 2 + 2 + NONCE_BYTES + AEAD_ABYTES + SIGNATURE_BYTES;

const COMMIT_HEADER_SPEC = [
  { key: 'format', type: 'string' },
  { key: 'version', type: 'int' },
  { key: 'workspaceId', type: 'string' },
  { key: 'epoch', type: 'int' },
  { key: 'deviceId', type: 'string' },
  { key: 'seq', type: 'int' },
] as const;

export interface CommitHeader {
  format: 'neuron-sync';
  version: 1;
  workspaceId: string;
  epoch: number;
  deviceId: string;
  seq: number;
}

const hexString = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));
const deviceIdSchema = hexString(16);
const hashSchema = hexString(32);
const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const epochSchema = z.number().int().min(1).max(LIMITS.epochMax);

const pathSchema = z.string().refine(
  (p) => p.length > 0 && isWellFormed(p) && !p.includes('\u0000') && utf8Length(p) <= LIMITS.pathBytes,
  'path must be 1-1024 UTF-8 bytes with no NUL',
);
// No C0/C1 controls, and no bidi overrides that could disguise a device's name.
const LABEL_FORBIDDEN = /[\p{Cc}‪-‮⁦-⁩]/u;
const labelSchema = z.string().refine(
  (l) => l.length > 0 && isWellFormed(l) && !LABEL_FORBIDDEN.test(l) && utf8Length(l) <= LIMITS.labelBytes,
  'label must be 1-64 UTF-8 bytes with no control characters',
);

const chunkRefSchema = z.strictObject({
  blobId: hashSchema,
  blobKey: hashSchema,
  size: z.number().int().min(1).max(LIMITS.chunkMax),
});
export const contentSchema = z.strictObject({
  chunks: z.array(chunkRefSchema).max(LIMITS.chunksPerFile),
  size: z.number().int().min(0).max(LIMITS.fileMax),
  sha: hashSchema,
}).refine((c) => c.chunks.reduce((sum, chunk) => sum + chunk.size, 0) === c.size, 'chunk sizes must add up to the file size');

const changeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ path: pathSchema, kind: z.literal('put'), base: hashSchema.nullable(), content: contentSchema, mode: z.literal('file') }),
  z.strictObject({ path: pathSchema, kind: z.literal('delete'), base: hashSchema, content: z.null(), mode: z.literal('file') }),
]);

export const deviceOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), deviceId: deviceIdSchema, boxPub: hashSchema, signPub: hashSchema, label: labelSchema }),
  z.strictObject({ op: z.literal('remove'), deviceId: deviceIdSchema }),
  z.strictObject({ op: z.literal('rotate'), epoch: epochSchema }),
]);

const commitBodySchema = z.strictObject({
  parents: z.array(hashSchema).max(LIMITS.parents),
  seenVector: z.record(deviceIdSchema, safeCount),
  epoch: epochSchema,
  time: safeCount,
  changes: z.array(changeSchema).max(LIMITS.changes),
  deviceOps: z.array(deviceOpSchema).max(LIMITS.deviceOps),
});

export type CommitBody = z.infer<typeof commitBodySchema>;
export type CommitChange = z.infer<typeof changeSchema>;
export type DeviceOp = z.infer<typeof deviceOpSchema>;

function shapeMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return `commit body: ${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid'}`;
}

/** Schema plus the cross-field rules zod cannot express alone. Returns a fresh object. */
function checkCommitBody(value: unknown, headerEpoch: number): CommitBody {
  // zod's record silently drops a "__proto__" key instead of rejecting it, and
  // would walk any number of keys first: check the raw keys before zod sees them.
  const seen = (value as { seenVector?: unknown } | null)?.seenVector;
  if (seen !== null && typeof seen === 'object') {
    const keys = Object.keys(seen);
    if (keys.length > LIMITS.seenVector) fail('shape', 'commit body: seenVector is too large');
    if (!keys.every((key) => isHex(key, 16))) fail('shape', 'commit body: seenVector key is not a device id');
  }
  const parsed = commitBodySchema.safeParse(value);
  if (!parsed.success) fail('shape', shapeMessage(parsed.error));
  const body = parsed.data;
  if (body.epoch !== headerEpoch) fail('shape', 'commit body epoch differs from its header');
  if (new Set(body.parents).size !== body.parents.length) fail('shape', 'duplicate parent');
  if (new Set(body.changes.map((c) => c.path)).size !== body.changes.length) fail('shape', 'duplicate path in one commit');
  let rotations = 0;
  for (const op of body.deviceOps) {
    if (op.op === 'add' && deriveDeviceId(fromHex(op.signPub, 32)) !== op.deviceId) fail('shape', 'added deviceId does not match its signing key');
    if (op.op === 'rotate') {
      rotations++;
      if (op.epoch <= headerEpoch) fail('shape', 'rotate must move to a later epoch');
    }
  }
  if (rotations > 1) fail('shape', 'at most one rotate per commit');
  return body;
}

function checkCommitHeader(header: Record<string, string | number>): CommitHeader {
  if (header.format !== 'neuron-sync') fail('shape', 'commit header format is not neuron-sync');
  if (header.version !== FORMAT_VERSION) fail('version', 'unsupported commit header version');
  if (!isHex(header.workspaceId, 16) || !isHex(header.deviceId, 16)) fail('shape', 'commit header ids are malformed');
  const { epoch, seq } = header as { epoch: number; seq: number };
  if (epoch < 1 || epoch > LIMITS.epochMax) fail('shape', 'commit epoch out of range');
  if (seq < 1) fail('shape', 'commit seq out of range');
  return header as unknown as CommitHeader;
}

export interface CommitSigner {
  signPublicKey: Uint8Array;
  signPrivateKey: Uint8Array;
}

export interface CommitInput {
  workspaceId: string;
  epoch: number;
  seq: number;
  body: CommitBody;
}

function encodeCommitWith(rng: Rng, input: CommitInput, workspaceKey: Uint8Array, signer: CommitSigner): Uint8Array {
  return encodeSigned(rng, input, checkCommitBody(input.body, input.epoch), workspaceKey, signer, MAGIC.commit);
}

function encodeSigned(rng: Rng, input: Omit<CommitInput, 'body'>, body: unknown, workspaceKey: Uint8Array, signer: CommitSigner, magic: string): Uint8Array {
  const s = sodium();
  requireKey(workspaceKey, 'workspace key');
  const header = checkCommitHeader({
    format: 'neuron-sync', version: FORMAT_VERSION, workspaceId: input.workspaceId,
    epoch: input.epoch, deviceId: deriveDeviceId(signer.signPublicKey), seq: input.seq,
  });
  const headerBytes = canonicalHeader(COMMIT_HEADER_SPEC.map(({ key }) => [key, header[key]] as const));
  if (headerBytes.length > LIMITS.commitHeaderMax) fail('size', 'commit header is too large');
  const ad = concatBytes(prefix(magic), u16be(headerBytes.length), headerBytes);
  const nonce = rng(NONCE_BYTES);
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8(JSON.stringify(body)), ad, null, nonce, deriveSubkey(workspaceKey, 'commit'));
  const signed = concatBytes(ad, nonce, ciphertext);
  const out = concatBytes(signed, s.crypto_sign_detached(signed, signer.signPrivateKey));
  if (out.length > LIMITS.commitMax) fail('size', 'commit is larger than 16 MiB');
  return out;
}

export const encodeCommit = (input: CommitInput, workspaceKey: Uint8Array, signer: CommitSigner): Uint8Array =>
  encodeCommitWith(systemRng, input, workspaceKey, signer);

/** BLAKE2b-256 of the full encoded commit, hex. This is what `parents` holds. */
export const commitHash = (bytes: Uint8Array): string => toHex(hash32(bytes));

export interface CommitExpectation {
  workspaceId: string;
  /** The Ed25519 key of the device whose log this commit came from. */
  signPublicKey: Uint8Array;
  /** WK for an epoch, or undefined when this device has no key for it. */
  workspaceKeyForEpoch: (epoch: number) => Uint8Array | undefined;
  /** The seq in the object's name, when known. */
  seq?: number;
}

export interface DecodedCommit {
  header: CommitHeader;
  body: CommitBody;
  hash: string;
}

/** Signature first (against the caller's key), then header, then decrypt, then body schema. */
export function decodeCommit(bytes: Uint8Array, expect: CommitExpectation): DecodedCommit {
  const decoded = decodeSigned(bytes, expect, MAGIC.commit);
  return { ...decoded, body: checkCommitBody(decoded.body, decoded.header.epoch) };
}

function decodeSigned(bytes: Uint8Array, expect: CommitExpectation, magic: string): { header: CommitHeader; body: unknown; hash: string } {
  requireBytes(bytes);
  if (bytes.length < COMMIT_MIN_BYTES || bytes.length > LIMITS.commitMax) fail('size', 'commit size is out of range');
  checkPrefix(bytes, magic);
  const headerLength = readU16be(bytes, PREFIX_BYTES);
  const headerEnd = PREFIX_BYTES + 2 + headerLength;
  if (headerLength < 2 || headerLength > LIMITS.commitHeaderMax) fail('size', 'commit header length is out of range');
  if (bytes.length < headerEnd + NONCE_BYTES + AEAD_ABYTES + SIGNATURE_BYTES) fail('size', 'commit is shorter than its header says');

  const s = sodium();
  if (!(expect.signPublicKey instanceof Uint8Array) || expect.signPublicKey.length !== s.crypto_sign_PUBLICKEYBYTES) fail('shape', 'signing key has the wrong length');
  const signed = bytes.subarray(0, bytes.length - SIGNATURE_BYTES);
  const signature = bytes.subarray(bytes.length - SIGNATURE_BYTES);
  let valid = false;
  try {
    valid = s.crypto_sign_verify_detached(signature, signed, expect.signPublicKey);
  } catch {
    valid = false;
  }
  if (!valid) fail('signature', 'commit signature does not verify');

  const header = checkCommitHeader(parseCanonicalHeader(bytes.subarray(PREFIX_BYTES + 2, headerEnd), COMMIT_HEADER_SPEC));
  if (header.deviceId !== deriveDeviceId(expect.signPublicKey)) fail('signature', 'commit names a different device than its signer');
  if (header.workspaceId !== expect.workspaceId) fail('auth', 'commit belongs to a different workspace');
  if (expect.seq !== undefined && header.seq !== expect.seq) fail('auth', 'commit seq differs from its name');
  const workspaceKey = expect.workspaceKeyForEpoch(header.epoch);
  if (!(workspaceKey instanceof Uint8Array) || workspaceKey.length !== KEY_BYTES) fail('auth', `no workspace key for epoch ${header.epoch}`);

  const nonce = bytes.subarray(headerEnd, headerEnd + NONCE_BYTES);
  const ciphertext = bytes.subarray(headerEnd + NONCE_BYTES, bytes.length - SIGNATURE_BYTES);
  let plaintext: Uint8Array;
  try {
    plaintext = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, bytes.subarray(0, headerEnd), nonce, deriveSubkey(workspaceKey, 'commit'));
  } catch {
    return fail('auth', 'commit does not decrypt');
  }
  let json: unknown;
  try {
    json = JSON.parse(decodeUtf8(plaintext));
  } catch (error) {
    if (error instanceof SyncFormatError) throw error;
    return fail('shape', 'commit body is not JSON');
  }
  return { header, body: json, hash: commitHash(bytes) };
}

// Checkpoints retain competing versions, including tombstones, so loading one
// cannot erase an edit/delete conflict. Paths are tuples: JSON object keys such
// as __proto__ must never be interpreted as a prototype.
export const treeVersionSchema = z.strictObject({
  content: contentSchema.nullable(), epoch: epochSchema, hash: hashSchema,
  deviceId: deviceIdSchema, label: labelSchema, time: safeCount,
});
export const registryEntrySchema = z.strictObject({
  deviceId: deviceIdSchema, signPub: hashSchema, boxPub: hashSchema,
  label: labelSchema, active: z.boolean(),
});
export const checkpointBodySchema = z.strictObject({
  epoch: epochSchema,
  tree: z.array(z.tuple([pathSchema, z.array(treeVersionSchema).min(1).max(1024)])).max(LIMITS.changes),
  registry: z.array(registryEntrySchema).max(LIMITS.seenVector),
  covered: z.array(z.strictObject({ deviceId: deviceIdSchema, seq: safeCount, hash: hashSchema })).max(LIMITS.seenVector),
  heads: z.array(hashSchema).max(LIMITS.parents),
});
export type TreeVersion = z.infer<typeof treeVersionSchema>;
export type RegistryEntry = z.infer<typeof registryEntrySchema>;
export type CheckpointBody = z.infer<typeof checkpointBodySchema>;

function checkCheckpointBody(value: unknown): CheckpointBody {
  const parsed = checkpointBodySchema.safeParse(value);
  if (!parsed.success) fail('shape', 'invalid checkpoint body');
  const body = parsed.data;
  for (const names of [body.tree.map(([p]) => p), body.registry.map((r) => r.deviceId), body.covered.map((c) => c.deviceId), body.heads]) {
    if (new Set(names).size !== names.length) fail('shape', 'duplicate checkpoint entry');
  }
  for (const r of body.registry) if (deriveDeviceId(fromHex(r.signPub, 32)) !== r.deviceId) fail('shape', 'checkpoint device key mismatch');
  return body;
}

function encodeCheckpointWith(rng: Rng, input: Omit<CommitInput, 'body'> & { body: CheckpointBody }, workspaceKey: Uint8Array, signer: CommitSigner): Uint8Array {
  const body = checkCheckpointBody(input.body);
  if (body.epoch !== input.epoch) fail('shape', 'checkpoint epoch mismatch');
  return encodeSigned(rng, input, body, workspaceKey, signer, MAGIC.checkpoint);
}

export const encodeCheckpoint = (input: Omit<CommitInput, 'body'> & { body: CheckpointBody }, key: Uint8Array, signer: CommitSigner): Uint8Array =>
  encodeCheckpointWith(systemRng, input, key, signer);

export function decodeCheckpoint(bytes: Uint8Array, expect: CommitExpectation): { header: CommitHeader; body: CheckpointBody; hash: string } {
  const decoded = decodeSigned(bytes, expect, MAGIC.checkpoint);
  const body = checkCheckpointBody(decoded.body);
  if (body.epoch !== decoded.header.epoch) fail('shape', 'checkpoint epoch mismatch');
  return { ...decoded, body };
}

// --- envelopes ----------------------------------------------------------------
// prefix(5) ‖ kind(1) ‖ u16 header length ‖ header {workspaceId, epoch, recipient} ‖ payload.
// The sealed plaintext is BLAKE2b-256(bound) ‖ WK, where `bound` is every byte
// before the nonce (recovery, passphrase) or before the sealed box (device).

export const ENVELOPE_KINDS = { device: 1, recovery: 2, passphrase: 3 } as const;
export type EnvelopeKind = keyof typeof ENVELOPE_KINDS;

const SEAL_BYTES = 48;
const SEALED_PLAINTEXT_BYTES = 32 + KEY_BYTES;
const PAYLOAD_BYTES: Record<EnvelopeKind, number> = {
  device: SEAL_BYTES + SEALED_PLAINTEXT_BYTES,
  recovery: NONCE_BYTES + SEALED_PLAINTEXT_BYTES + AEAD_ABYTES,
  passphrase: PASSPHRASE_SALT_BYTES + NONCE_BYTES + SEALED_PLAINTEXT_BYTES + AEAD_ABYTES,
};
const ENVELOPE_FIXED_BYTES = PREFIX_BYTES + 1 + 2;
const ENVELOPE_MIN_BYTES = ENVELOPE_FIXED_BYTES + 2 + PAYLOAD_BYTES.recovery;

const ENVELOPE_HEADER_SPEC = [
  { key: 'workspaceId', type: 'string' },
  { key: 'epoch', type: 'int' },
  { key: 'recipient', type: 'string' },
] as const;

export interface EnvelopeContext {
  workspaceId: string;
  epoch: number;
}

const kindOf = (byte: number): EnvelopeKind | undefined =>
  (Object.keys(ENVELOPE_KINDS) as EnvelopeKind[]).find((kind) => ENVELOPE_KINDS[kind] === byte);

function checkRecipient(kind: EnvelopeKind, recipient: unknown): boolean {
  return kind === 'device' ? isHex(recipient, 16) : recipient === kind;
}

function envelopeHead(kind: EnvelopeKind, context: EnvelopeContext, recipient: string): Uint8Array {
  if (!isHex(context.workspaceId, 16)) fail('shape', 'workspaceId must be 32 lowercase hex characters');
  if (!Number.isInteger(context.epoch) || context.epoch < 1 || context.epoch > LIMITS.epochMax) fail('shape', 'epoch out of range');
  if (!checkRecipient(kind, recipient)) fail('shape', 'recipient does not fit the envelope kind');
  const header = canonicalHeader([['workspaceId', context.workspaceId], ['epoch', context.epoch], ['recipient', recipient]]);
  if (header.length > LIMITS.envelopeHeaderMax) fail('size', 'envelope header is too large');
  return concatBytes(prefix(MAGIC.envelope), new Uint8Array([ENVELOPE_KINDS[kind]]), u16be(header.length), header);
}

function sealedPlaintext(bound: Uint8Array, workspaceKey: Uint8Array): Uint8Array {
  requireKey(workspaceKey, 'workspace key');
  return concatBytes(hash32(bound), workspaceKey);
}

interface ParsedEnvelope {
  kind: EnvelopeKind;
  headEnd: number;
}

/** Size, magic, version, kind, lengths, canonical header and the expected context. No crypto. */
function parseEnvelope(bytes: Uint8Array, kind: EnvelopeKind, context: EnvelopeContext, recipient: string): ParsedEnvelope {
  requireBytes(bytes);
  if (bytes.length < ENVELOPE_MIN_BYTES || bytes.length > LIMITS.envelopeMax) fail('size', 'envelope size is out of range');
  checkPrefix(bytes, MAGIC.envelope);
  const actual = kindOf(bytes[PREFIX_BYTES]);
  if (!actual) fail('shape', 'unknown envelope kind');
  const headerLength = readU16be(bytes, PREFIX_BYTES + 1);
  if (headerLength < 2 || headerLength > LIMITS.envelopeHeaderMax) fail('size', 'envelope header length is out of range');
  const headEnd = ENVELOPE_FIXED_BYTES + headerLength;
  if (bytes.length !== headEnd + PAYLOAD_BYTES[actual]) fail('size', 'envelope length does not match its kind');
  const header = parseCanonicalHeader(bytes.subarray(ENVELOPE_FIXED_BYTES, headEnd), ENVELOPE_HEADER_SPEC);
  if (!isHex(header.workspaceId, 16)) fail('shape', 'envelope workspaceId is malformed');
  if ((header.epoch as number) < 1 || (header.epoch as number) > LIMITS.epochMax) fail('shape', 'envelope epoch out of range');
  if (!checkRecipient(actual, header.recipient)) fail('shape', 'envelope recipient does not fit its kind');
  if (actual !== kind) fail('auth', `expected a ${kind} envelope`);
  if (header.workspaceId !== context.workspaceId) fail('auth', 'envelope belongs to a different workspace');
  if (header.epoch !== context.epoch) fail('auth', 'envelope is for a different epoch');
  if (header.recipient !== recipient) fail('auth', 'envelope is for a different recipient');
  return { kind: actual, headEnd };
}

function unsealed(plaintext: Uint8Array, bound: Uint8Array): Uint8Array {
  if (plaintext.length !== SEALED_PLAINTEXT_BYTES) fail('auth', 'envelope plaintext has the wrong length');
  if (!bytesEqual(plaintext.subarray(0, 32), hash32(bound))) fail('auth', 'envelope header binding does not match');
  return plaintext.slice(32);
}

export interface EnvelopeRecipient {
  deviceId: string;
  boxPublicKey: Uint8Array;
}

/** crypto_box_seal(H(bound) ‖ WK_e, recipient box key). */
export function encodeDeviceEnvelope(workspaceKey: Uint8Array, context: EnvelopeContext, recipient: EnvelopeRecipient): Uint8Array {
  if (!(recipient.boxPublicKey instanceof Uint8Array) || recipient.boxPublicKey.length !== 32) fail('shape', 'box public key must be 32 bytes');
  const head = envelopeHead('device', context, recipient.deviceId);
  return concatBytes(head, sodium().crypto_box_seal(sealedPlaintext(head, workspaceKey), recipient.boxPublicKey));
}

export interface EnvelopeOpener {
  deviceId: string;
  boxPublicKey: Uint8Array;
  boxPrivateKey: Uint8Array;
}

export function openDeviceEnvelope(bytes: Uint8Array, context: EnvelopeContext, device: EnvelopeOpener): Uint8Array {
  const { headEnd } = parseEnvelope(bytes, 'device', context, device.deviceId);
  const bound = bytes.subarray(0, headEnd);
  let plaintext: Uint8Array;
  try {
    plaintext = sodium().crypto_box_seal_open(bytes.subarray(headEnd), device.boxPublicKey, device.boxPrivateKey);
  } catch {
    return fail('auth', 'device envelope does not open');
  }
  return unsealed(plaintext, bound);
}

function aeadSeal(rng: Rng, bound: Uint8Array, workspaceKey: Uint8Array, wrappingKey: Uint8Array): Uint8Array {
  const nonce = rng(NONCE_BYTES);
  return concatBytes(bound, nonce, sodium().crypto_aead_xchacha20poly1305_ietf_encrypt(sealedPlaintext(bound, workspaceKey), bound, null, nonce, wrappingKey));
}

function aeadOpen(bytes: Uint8Array, boundEnd: number, wrappingKey: Uint8Array): Uint8Array {
  const bound = bytes.subarray(0, boundEnd);
  let plaintext: Uint8Array;
  try {
    plaintext = sodium().crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, bytes.subarray(boundEnd + NONCE_BYTES), bound, bytes.subarray(boundEnd, boundEnd + NONCE_BYTES), wrappingKey,
    );
  } catch {
    return fail('auth', 'envelope does not open');
  }
  return unsealed(plaintext, bound);
}

function encodeRecoveryEnvelopeWith(rng: Rng, workspaceKey: Uint8Array, context: EnvelopeContext, recoveryKey: Uint8Array): Uint8Array {
  return aeadSeal(rng, envelopeHead('recovery', context, 'recovery'), workspaceKey, deriveRecoveryWrappingKey(recoveryKey));
}

export const encodeRecoveryEnvelope = (workspaceKey: Uint8Array, context: EnvelopeContext, recoveryKey: Uint8Array): Uint8Array =>
  encodeRecoveryEnvelopeWith(systemRng, workspaceKey, context, recoveryKey);

export function openRecoveryEnvelope(bytes: Uint8Array, context: EnvelopeContext, recoveryKey: Uint8Array): Uint8Array {
  const { headEnd } = parseEnvelope(bytes, 'recovery', context, 'recovery');
  return aeadOpen(bytes, headEnd, deriveRecoveryWrappingKey(recoveryKey));
}

type PassphraseKdf = (salt: Uint8Array) => Uint8Array;

function encodePassphraseEnvelopeWith(rng: Rng, workspaceKey: Uint8Array, context: EnvelopeContext, passphrase: string): Uint8Array {
  const salt = rng(PASSPHRASE_SALT_BYTES);
  const bound = concatBytes(envelopeHead('passphrase', context, 'passphrase'), salt);
  return aeadSeal(rng, bound, workspaceKey, derivePassphraseKey(passphrase, salt));
}

export const encodePassphraseEnvelope = (workspaceKey: Uint8Array, context: EnvelopeContext, passphrase: string): Uint8Array =>
  encodePassphraseEnvelopeWith(systemRng, workspaceKey, context, passphrase);

function openPassphraseEnvelopeWithKdf(bytes: Uint8Array, context: EnvelopeContext, kdf: PassphraseKdf): Uint8Array {
  const { headEnd } = parseEnvelope(bytes, 'passphrase', context, 'passphrase');
  const boundEnd = headEnd + PASSPHRASE_SALT_BYTES;
  return aeadOpen(bytes, boundEnd, kdf(bytes.slice(headEnd, boundEnd)));
}

export const openPassphraseEnvelope = (bytes: Uint8Array, context: EnvelopeContext, passphrase: string): Uint8Array =>
  openPassphraseEnvelopeWithKdf(bytes, context, (salt) => derivePassphraseKey(passphrase, salt));

/**
 * Test-only: injected randomness (known-answer vectors) and a cheap KDF for the
 * passphrase-envelope fuzz. Nothing under src/ outside src/main/sync may
 * reference this (tools/sync-crypto.test.mjs checks).
 */
export const formatTestSeams = {
  encodeCheckpointWith,
  encodeCommitWith,
  encodeRecoveryEnvelopeWith,
  encodePassphraseEnvelopeWith,
  openPassphraseEnvelopeWithKdf,
};
