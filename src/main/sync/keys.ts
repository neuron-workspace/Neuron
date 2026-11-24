// Device keys, workspace keys and subkeys, the recovery key encoding and
// passphrase key derivation (docs/sync/format-v1.md §3–§5). Private halves are
// returned as bytes; wrapping them with safeStorage is the caller's job.
import { canonicalHeader, fail, fromHex, isHex, parseCanonicalHeader, toHex, utf8, utf8Length } from './codec';
import { Rng, sodium, systemRng } from './sodium';

export const KEY_BYTES = 32;
export const DEVICE_ID_BYTES = 16;

// --- device keys ------------------------------------------------------------

export interface DevicePublicIdentity {
  /** First 16 bytes of BLAKE2b-256(signPublicKey), lowercase hex (32 chars). */
  deviceId: string;
  boxPublicKey: Uint8Array;
  signPublicKey: Uint8Array;
}

export interface DeviceKeys extends DevicePublicIdentity {
  boxPrivateKey: Uint8Array;
  signPrivateKey: Uint8Array;
}

export function deriveDeviceId(signPublicKey: Uint8Array): string {
  if (signPublicKey.length !== sodium().crypto_sign_PUBLICKEYBYTES) fail('shape', 'signing public key has the wrong length');
  return toHex(sodium().crypto_generichash(32, signPublicKey, null).subarray(0, DEVICE_ID_BYTES));
}

function deviceKeysFromSeeds(boxSeed: Uint8Array, signSeed: Uint8Array): DeviceKeys {
  const s = sodium();
  const box = s.crypto_box_seed_keypair(boxSeed);
  const sign = s.crypto_sign_seed_keypair(signSeed);
  return {
    deviceId: deriveDeviceId(sign.publicKey),
    boxPublicKey: box.publicKey,
    boxPrivateKey: box.privateKey,
    signPublicKey: sign.publicKey,
    signPrivateKey: sign.privateKey,
  };
}

function generateDeviceKeysWith(rng: Rng): DeviceKeys {
  return deviceKeysFromSeeds(rng(sodium().crypto_box_SEEDBYTES), rng(sodium().crypto_sign_SEEDBYTES));
}

/** A new X25519 box key pair and Ed25519 signing key pair for this installation. */
export const generateDeviceKeys = (): DeviceKeys => generateDeviceKeysWith(systemRng);

const IDENTITY_SPEC = [
  { key: 'format', type: 'string' },
  { key: 'version', type: 'int' },
  { key: 'deviceId', type: 'string' },
  { key: 'boxPub', type: 'string' },
  { key: 'signPub', type: 'string' },
] as const;
const IDENTITY_MAX_BYTES = 512;

/** Canonical JSON of the public half only. */
export function serialisePublicIdentity(identity: DevicePublicIdentity): string {
  if (identity.boxPublicKey.length !== sodium().crypto_box_PUBLICKEYBYTES) fail('shape', 'box public key has the wrong length');
  if (deriveDeviceId(identity.signPublicKey) !== identity.deviceId) fail('shape', 'deviceId does not match the signing key');
  const bytes = canonicalHeader([
    ['format', 'neuron-sync-device'],
    ['version', 1],
    ['deviceId', identity.deviceId],
    ['boxPub', toHex(identity.boxPublicKey)],
    ['signPub', toHex(identity.signPublicKey)],
  ]);
  return new TextDecoder().decode(bytes);
}

export function parsePublicIdentity(text: string): DevicePublicIdentity {
  if (typeof text !== 'string' || utf8Length(text) > IDENTITY_MAX_BYTES) fail('size', 'device identity is too large');
  const header = parseCanonicalHeader(utf8(text), IDENTITY_SPEC);
  if (header.format !== 'neuron-sync-device') fail('shape', 'not a device identity');
  if (header.version !== 1) fail('version', 'unsupported device identity version');
  if (!isHex(header.deviceId, DEVICE_ID_BYTES) || !isHex(header.boxPub, 32) || !isHex(header.signPub, 32)) fail('shape', 'device identity fields are malformed');
  const signPublicKey = fromHex(header.signPub as string, 32);
  if (deriveDeviceId(signPublicKey) !== header.deviceId) fail('shape', 'deviceId does not match the signing key');
  return { deviceId: header.deviceId as string, boxPublicKey: fromHex(header.boxPub as string, 32), signPublicKey };
}

// --- workspace key and subkeys ---------------------------------------------

/** crypto_kdf context for workspace subkeys. Exactly 8 bytes. */
export const WORKSPACE_KDF_CONTEXT = 'nsyncv1_';

/** Fixed crypto_kdf subkey ids. Never reuse or renumber one; a new purpose takes a new id. */
export const SUBKEY_IDS = { commit: 1, blobid: 2, history: 3, cdc: 4, blobkey: 5 } as const;
export type SubkeyPurpose = keyof typeof SUBKEY_IDS;

const generateWorkspaceKeyWith = (rng: Rng): Uint8Array => rng(KEY_BYTES);
/** WK_e: 32 random bytes, one per workspace per epoch. */
export const generateWorkspaceKey = (): Uint8Array => generateWorkspaceKeyWith(systemRng);

export function deriveSubkey(workspaceKey: Uint8Array, purpose: SubkeyPurpose): Uint8Array {
  if (workspaceKey.length !== KEY_BYTES) fail('shape', 'workspace key must be 32 bytes');
  const id = SUBKEY_IDS[purpose];
  if (id === undefined) fail('shape', 'unknown subkey purpose');
  return sodium().crypto_kdf_derive_from_key(KEY_BYTES, id, WORKSPACE_KDF_CONTEXT, workspaceKey);
}

// --- recovery key -----------------------------------------------------------
// 32 random bytes as Crockford base32: 52 data characters (256 bits + 4 zero
// pad bits) in 13 groups of 4, then a 2-character group holding the first 10
// bits of BLAKE2b-256(key). Display is uppercase with hyphens.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_DATA_CHARS = 52;
const RECOVERY_TOTAL_CHARS = 54;

export const RECOVERY_KDF_CONTEXT = 'nsyncrk1';
/** crypto_kdf ids under RECOVERY_KDF_CONTEXT. */
export const RECOVERY_SUBKEY_IDS = { envelope: 1 } as const;

const generateRecoveryKeyWith = (rng: Rng): Uint8Array => rng(KEY_BYTES);
export const generateRecoveryKey = (): Uint8Array => generateRecoveryKeyWith(systemRng);

function recoveryChecksum(key: Uint8Array): number {
  const hash = sodium().crypto_generichash(32, key, null);
  return (hash[0] << 2) | (hash[1] >>> 6);
}

function toBase32(key: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of key) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(buffer << (5 - bits)) & 31];
  return out;
}

export function formatRecoveryKey(key: Uint8Array): string {
  if (key.length !== KEY_BYTES) fail('shape', 'recovery key must be 32 bytes');
  const sum = recoveryChecksum(key);
  const chars = toBase32(key) + CROCKFORD[sum >>> 5] + CROCKFORD[sum & 31];
  const groups: string[] = [];
  for (let i = 0; i < RECOVERY_DATA_CHARS; i += 4) groups.push(chars.slice(i, i + 4));
  groups.push(chars.slice(RECOVERY_DATA_CHARS));
  return groups.join('-');
}

/**
 * Case-insensitive; spaces and hyphens ignored; I and L read as 1, O as 0.
 * A wrong length or character is `shape`; a checksum mismatch is `checksum`.
 */
export function parseRecoveryKey(text: string): Uint8Array {
  if (typeof text !== 'string' || text.length > 256) fail('shape', 'That is not a recovery key: it is too long.');
  const chars = text.toUpperCase().replace(/[\s-]+/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (chars.length !== RECOVERY_TOTAL_CHARS) {
    fail('shape', `A recovery key has ${RECOVERY_TOTAL_CHARS} characters; this has ${chars.length}.`);
  }
  const values: number[] = [];
  for (const char of chars) {
    const value = CROCKFORD.indexOf(char);
    if (value < 0) fail('shape', `"${char}" cannot appear in a recovery key.`);
    values.push(value);
  }
  const key = new Uint8Array(KEY_BYTES);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < RECOVERY_DATA_CHARS; i++) {
    buffer = (buffer << 5) | values[i];
    bits += 5;
    if (bits >= 8) {
      key[index++] = (buffer >>> (bits - 8)) & 0xff;
      bits -= 8;
      buffer &= (1 << bits) - 1;
    }
  }
  // 52 × 5 = 260 bits: the 4 left over must be zero.
  if (bits !== 4 || buffer !== 0) fail('checksum', 'The recovery key has a typo: check each group against the original.');
  const sum = (values[RECOVERY_DATA_CHARS] << 5) | values[RECOVERY_DATA_CHARS + 1];
  if (sum !== recoveryChecksum(key)) fail('checksum', 'The recovery key has a typo: check each group against the original.');
  return key;
}

/** The key that wraps the recovery envelope: crypto_kdf(RK, id 1, "nsyncrk1"). */
export function deriveRecoveryWrappingKey(recoveryKey: Uint8Array): Uint8Array {
  if (recoveryKey.length !== KEY_BYTES) fail('shape', 'recovery key must be 32 bytes');
  return sodium().crypto_kdf_derive_from_key(KEY_BYTES, RECOVERY_SUBKEY_IDS.envelope, RECOVERY_KDF_CONTEXT, recoveryKey);
}

// --- passphrase (optional, off by default) -----------------------------------
// Argon2id at OPSLIMIT_MODERATE / MEMLIMIT_MODERATE. The parameters are fixed by
// format version 1 and are not stored, so an envelope cannot ask for weaker or
// absurdly expensive ones. The passphrase is NFC-normalised before hashing.

export const PASSPHRASE_SALT_BYTES = 16;
export const PASSPHRASE_MAX_BYTES = 1024;

export function derivePassphraseKey(passphrase: string, salt: Uint8Array): Uint8Array {
  const s = sodium();
  if (salt.length !== s.crypto_pwhash_SALTBYTES || salt.length !== PASSPHRASE_SALT_BYTES) fail('shape', 'passphrase salt must be 16 bytes');
  if (typeof passphrase !== 'string' || passphrase.length === 0) fail('shape', 'passphrase is empty');
  const bytes = utf8(passphrase.normalize('NFC'));
  if (bytes.length > PASSPHRASE_MAX_BYTES) fail('size', 'passphrase is too long');
  return s.crypto_pwhash(
    KEY_BYTES,
    bytes,
    salt,
    s.crypto_pwhash_OPSLIMIT_MODERATE,
    s.crypto_pwhash_MEMLIMIT_MODERATE,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/**
 * Test-only: the same functions with injected randomness, for known-answer
 * vectors. Nothing under src/ outside src/main/sync may reference this
 * (tools/sync-crypto.test.mjs checks).
 */
export const keysTestSeams = {
  deviceKeysFromSeeds,
  generateDeviceKeysWith,
  generateWorkspaceKeyWith,
  generateRecoveryKeyWith,
};
