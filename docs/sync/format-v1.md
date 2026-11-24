# Neuron sync object format, version 1

**Status: Draft. Frozen at the end of Phase 1, before any user data is written (D39, Phase 1 gate).**
After the freeze, any change to a byte below needs a new version number. It also needs new
vectors under `tools/fixtures/sync-v1/` (or a new `sync-v2/`).

Implementation: `src/main/sync/` (`sodium.ts`, `codec.ts`, `keys.ts`, `format.ts`, `chunker.ts`).
Tests: `tools/sync-crypto.test.mjs`, `tools/sync-chunker.test.mjs` (`npm run test:sync`).
Design: `BYOI-sync-and-security-design.md` §2, §3.2, §3.3, §3.10, §3.11. All primitives come from
libsodium 1.0.22 (`libsodium-wrappers-sumo` 0.8.4, D40). Nothing is hand-rolled.

## 1. Conventions

| Item | Rule |
| --- | --- |
| Integers in length fields | Unsigned, big-endian |
| Hex | Lowercase only; anything else is rejected |
| Ids | `workspaceId`, `deviceId`: 16 bytes as 32 hex characters |
| `epoch` | Integer 1 … 2³¹. The first epoch is 1 |
| `seq` | Integer 1 … 2⁵³−1, per device |
| Magic + version | Every object starts with 4 ASCII bytes and the version byte `0x01` |
| Signed messages | Every message a device key signs starts with its own 4-byte magic (domain separation) |

| Magic | Object |
| --- | --- |
| `NSYB` | Blob (one encrypted chunk) |
| `NSYC` | Commit |
| `NSYE` | Key envelope |
| `NSYK` | Reserved for checkpoints (not defined in v1 Phase 1a) |

**Decoder rules.** Each decoder checks the size first. Then come magic, version and length
fields, then signature or authentication, then parsing. Each decoder returns a whole object or
throws `SyncFormatError` with one of these codes:

| Code | Meaning |
| --- | --- |
| `size` | Total or field length out of bounds, or inconsistent with the layout |
| `magic` | Wrong magic |
| `version` | Unsupported version byte or header `version` |
| `signature` | Ed25519 signature invalid, or the header names a device other than the signer |
| `auth` | AEAD/secretstream/box authentication failed, truncated stream, or a header that does not match the expected workspace, epoch, recipient or seq |
| `shape` | Not canonical, not UTF-8/JSON, schema or bound violated |
| `checksum` | Recovery key typo (bad checksum or non-zero pad bits) |

## 2. Canonical headers

All plaintext headers are UTF-8 JSON objects written by one function (`canonicalHeader`):
- keys in the fixed order listed for each header, and no whitespace;
- values are strings (`JSON.stringify` escaping) or non-negative safe integers (decimal, no sign,
  no exponent, no fraction).

Decoders parse the header and require exactly the listed keys with the right JSON types. They
then **re-serialise it and compare bytes**. So reordered keys, whitespace, duplicate keys,
alternative escapes (`-`), `1.0` and trailing bytes are all rejected (`shape`).

## 3. Keys and KDF

| Key | Derivation |
| --- | --- |
| `deviceId` | First 16 bytes of `BLAKE2b-256(signPublicKey)` (unkeyed), hex |
| WK_e | 32 random bytes per workspace per epoch |
| Workspace subkeys | `crypto_kdf_derive_from_key(32, id, "nsyncv1_", WK_e)` |
| Recovery wrapping key | `crypto_kdf_derive_from_key(32, 1, "nsyncrk1", RK)` |
| Passphrase wrapping key | `crypto_pwhash(32, NFC(passphrase) as UTF-8, salt16, OPSLIMIT_MODERATE (3), MEMLIMIT_MODERATE (256 MiB), ARGON2ID13)` |
| Blob key | `BLAKE2b-256(key = blobkey subkey, plaintext chunk)`, convergent within a workspace epoch (§6). Also stored in the commit's chunk refs |

Subkey ids under `"nsyncv1_"`. **Never reuse or renumber one.** A new purpose takes the next id.

| id | Name | Used for |
| --- | --- | --- |
| 1 | `commit` | Commit AEAD key |
| 2 | `blobid` | Keyed blob IDs and content hashes |
| 3 | `history` | Wrapping older epoch keys (engine, S1b) |
| 4 | `cdc` | Chunker Gear table. **Derived from the first epoch's WK only** (§9) |
| 5 | `blobkey` | Convergent blob keys (§6) |

Ids under `"nsyncrk1"`: 1 = recovery envelope wrapping key.

**Passphrase.** The parameters are fixed by format version 1 and are not stored, so an envelope
cannot ask for weaker or larger ones. The passphrase is 1 to 1024 UTF-8 bytes after NFC
normalisation.

## 4. Device identity

Canonical header, in this order: `format` = `"neuron-sync-device"`, `version` = `1`,
`deviceId`, `boxPub` (X25519, 32 bytes, hex), `signPub` (Ed25519, 32 bytes, hex). The whole
identity is at most 512 bytes. The parser requires `deviceId` = derived from `signPub`.

`boxPub` is **not** bound by the identity itself. It is authentic only when it arrives over an
authenticated path: SAS pairing (design §2.3) or inside a signed `add` device op. Do not trust
a `boxPub` from anywhere else.

## 5. Recovery key

- 32 random bytes, written in Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`).
- **Data:** 52 characters, big-endian bit order. That is 256 key bits followed by 4 zero pad
  bits.
- **Checksum:** 2 characters holding the first 10 bits of `BLAKE2b-256(RK)` (unkeyed).
- **Display:** 13 groups of 4, then the checksum pair, joined by `-`, uppercase. Example:
  `0000-0000-…-0000-XX` (54 characters + 13 hyphens).
- **Parsing:** case-insensitive; spaces and hyphens are ignored; `I`/`L` read as `1` and `O`
  as `0`. A wrong length or a character outside the alphabet (for example `U`) is a `shape`
  error. Non-zero pad bits or a checksum mismatch is a `checksum` error.
- **Measured detection:** 1673 of 1674 single-character substitutions and 50 of 50 adjacent
  transpositions are caught for the test key.

## 6. Blob

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 4 | `NSYB` |
| 4 | 1 | `0x01` |
| 5 | 24 | `crypto_secretstream_xchacha20poly1305` header |
| 29 | … | Messages: the padded chunk in 64 KiB pieces, each `ABYTES` (17) longer |

- Every message has associated data = the 5-byte prefix. Every message but the last has
  `TAG_MESSAGE`; the last has `TAG_FINAL`.
- If the stream ends without `TAG_FINAL`, it is truncated: `auth`. A `TAG_FINAL` before the
  end is also `auth`.
- **Padding:** `sodium_pad(chunk, paddedSize(len))`, where `paddedSize(n) = bucket(n + 1)`
  (sodium_pad always adds the `0x80` marker). The decoder requires the padded length to be a
  bucket, uses `sodium_unpad`, and requires `paddedSize(unpadded) == padded`, so padding is
  canonical.
- **Blob ID:** `BLAKE2b-256(key = blobid subkey, plaintext chunk)`, hex. The remote name is
  `blobs/<first 2 hex>/<blobId>`. A decoder may be given the expected ID and checks it after
  decrypting (`auth`).
- **Blob key:** `BLAKE2b-256(key = blobkey subkey, plaintext chunk)` (`blobKeyFor`).
- **Chunk:** 1 byte to 2 MiB.

**Why the blob key is derived, not random.** Blob names are write-once and blob IDs are
deterministic. With a random key per encode, two devices uploading the same chunk (or one
device re-uploading after a crash between blob and commit) would get the same ID with different
keys. The first write would win, and the other commit would reference a key that can never open
the stored blob. A derived key is convergent within a workspace epoch, so any device's copy
opens with the key any device computes.
- The secretstream header stays random, so ciphertexts still differ.
- It leaks only chunk equality, which the blob ID already leaks.
- The blobkey and blobid subkeys differ, so the key is never the (public) ID.
- The key is still written into each chunk ref, so a file can later be shared or re-keyed
  without a format change.

Buckets (`bucket(m)`, m = bytes needed):

| m | Padded to |
| --- | --- |
| ≤ 64 KiB | Next multiple of 4 KiB, minimum 4 KiB |
| ≤ 1 MiB | Next multiple of 64 KiB |
| > 1 MiB | Next multiple of 256 KiB |

Edges: a chunk of 4095 bytes → 4 KiB; 4096 → 8 KiB; 65 535 → 64 KiB; 65 536 → 128 KiB;
1 MiB − 1 → 1 MiB; 1 MiB → 1.25 MiB; 2 MiB → 2.25 MiB.

## 7. Commit

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 4 | `NSYC` |
| 4 | 1 | `0x01` |
| 5 | 2 | H = header length (2 … 1024) |
| 7 | H | Canonical header |
| 7+H | 24 | Random nonce |
| 31+H | C | `crypto_aead_xchacha20poly1305_ietf` ciphertext of the body (C ≥ 16), key = `commit` subkey of WK_epoch |
| end−64 | 64 | Ed25519 detached signature |

- C is derived from the total length; there is no separate field for it.
- **AD** = bytes `0 … 7+H` (prefix, H and header). **Signed message** = every byte before the
  signature. Both are supersets of what the design names, so the prefix and the length field are
  bound too.
- **Header keys, in this order:** `format` = `"neuron-sync"`, `version` = `1`, `workspaceId`,
  `epoch`, `deviceId`, `seq`.
- **Commit hash** = `BLAKE2b-256` (unkeyed) of the full encoded commit. This is what `parents`
  holds.

The decoder works in this order:
1. Size (113 bytes … 16 MiB), magic, version, header length.
2. Verify the signature against the caller's key for the device whose log this is. This happens
   **before** the header is parsed and **before** anything is decrypted.
3. Canonical header.
4. Header `deviceId` must be derived from that key (`signature`).
5. `workspaceId` and (optionally) `seq` must match what is expected (`auth`).
6. Look up WK for the header's epoch (`auth` if unknown).
7. Decrypt (`auth`).
8. Strict UTF-8 JSON, then the schema below (`shape`).

**Body** (plaintext JSON; not canonical, decoders do not compare its bytes). Every object is
strict: unknown keys are rejected.

| Field | Type and bounds |
| --- | --- |
| `parents` | ≤ 64 commit hashes (64 hex), no duplicates |
| `seenVector` | `{deviceId: seq}`, ≤ 1024 entries, values 0 … 2⁵³−1. Keys are checked before the schema (zod drops `__proto__` silently) |
| `epoch` | Must equal the header `epoch` |
| `time` | Integer ms since 1970, 0 … 2⁵³−1, display only |
| `changes` | ≤ 20 000; no two with the same `path` |
| `deviceOps` | ≤ 64; at most one `rotate` |

`changes[]`, discriminated on `kind`:

| `kind` | Fields |
| --- | --- |
| `put` | `path`, `base`: content hash or `null`, `content`, `mode`: `"file"` |
| `delete` | `path`, `base`: content hash (required), `content`: `null`, `mode`: `"file"` |

- `path`: 1 … 1024 UTF-8 bytes, well-formed (no lone surrogates), no NUL. Workspace-relative
  path rules (`..`, reserved names, `.git`) are the engine's job (`resolveInside`).
- `content`: `{chunks: [{blobId, blobKey, size}], size, sha}`.
  - `chunks`: ≤ 801 entries (100 MiB / 128 KiB + 1).
  - Each `size`: 1 … 2 MiB.
  - `size`: 0 … 100 MiB and equal to the sum of the chunk sizes, so an empty file has no
    chunks.
  - `blobId`, `blobKey` and `sha` are 64 hex. `sha` is the content hash:
    `BLAKE2b-256(key = blobid subkey, whole file)`. For a one-chunk file it equals that chunk's
    blob ID. That reveals nothing, because both values are inside the encrypted commit.

`deviceOps[]`, discriminated on `op`. These objects are strict, and an unknown `op` is
`shape` (a new op means a format version bump):

| `op` | Fields |
| --- | --- |
| `add` | `deviceId` (32 hex), `boxPub` (64 hex), `signPub` (64 hex), `label`. The decoder checks that `deviceId` is derived from `signPub` |
| `remove` | `deviceId` (32 hex) |
| `rotate` | `epoch`: integer greater than the header `epoch` and ≤ 2³¹ |

- `label`: 1 … 64 UTF-8 bytes, well-formed. No `\p{Cc}` (C0/C1 controls) and no bidi
  controls (U+202A–202E, U+2066–2069).
- Whether a device may perform an op is decided by the engine (S1b), not the decoder.

## 8. Envelopes

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 4 | `NSYE` |
| 4 | 1 | `0x01` |
| 5 | 1 | Kind: 1 = device, 2 = recovery, 3 = passphrase |
| 6 | 2 | H = header length (2 … 256) |
| 8 | H | Canonical header: `workspaceId`, `epoch`, `recipient` |
| 8+H | … | Payload, by kind (below) |

`recipient` is the recipient's `deviceId` for kind 1, `"recovery"` for kind 2 and
`"passphrase"` for kind 3. Any other combination is `shape`.

**Header binding.** Let `bound` be every byte before the nonce (kinds 2 and 3) or before the
sealed box (kind 1). For kind 3 that includes the salt. The sealed plaintext is
`BLAKE2b-256(bound) ‖ WK_e` (64 bytes). The opener checks the hash (`auth`). `crypto_box_seal`
has no associated data, so this hash is what binds the header for kind 1. Kinds 2 and 3 also
pass `bound` as AEAD associated data.

| Kind | Payload | Bytes |
| --- | --- | --- |
| 1 device | `crypto_box_seal(H(bound) ‖ WK, recipient boxPub)` | 48 + 64 = 112 |
| 2 recovery | nonce(24) ‖ `crypto_aead_xchacha20poly1305_ietf(H(bound) ‖ WK, AD = bound, recovery wrapping key)` | 24 + 80 = 104 |
| 3 passphrase | salt(16) ‖ nonce(24) ‖ AEAD as for kind 2 under the Argon2id key | 16 + 24 + 80 = 120 |

- The total length must be exactly `8 + H + payload` (`size`), and at most 1024 bytes.
- The opener checks the header against the expected `workspaceId`, `epoch` and `recipient`
  before any crypto (`auth`).
- Remote names: `keys/<epoch>/<deviceId>.env`, `keys/<epoch>/recovery.env`,
  `keys/<epoch>/passphrase.env`.

## 9. Chunker (keyed FastCDC)

| Parameter | Value |
| --- | --- |
| Min / average / max | 128 KiB / 512 KiB / 2 MiB |
| Hash | 32-bit Gear: `h = ((h << 1) + G[byte]) mod 2³²`, reset to 0 at `start + min` (cut-point skipping) |
| Normalised chunking (level 2) | Before `avg`: cut when `h & maskS == 0`, maskS = top 21 bits (`0xFFFFF800`). From `avg` to `max`: maskL = top 17 bits (`0xFFFF8000`). A cut falls after the byte that matched |
| Gear table G | 256 × uint32 = XChaCha20 keystream over 1024 zero bytes, key = `cdc` subkey, nonce = 24 zero bytes, read as little-endian words |
| Key | `cdc` subkey of the **first** epoch's WK. Rotation does not re-chunk; a full re-key (Q14) re-chunks. Nothing extra is stored, so the engine must keep WK_1 reachable (the `history` chain) |
| Small files | Up to 128 KiB is one chunk; an empty file is zero chunks; the last chunk may be under 128 KiB |

The masks test the top bits because bit k of a left-shifting Gear hash depends on the last k + 1
bytes. They are fixed rather than keyed: the keyed table already decides every hash value.

**Insert property (corrected).** The design says "a one-byte insert changes at most the touched
chunks". That is too strong for FastCDC. What holds:
- (a) Every chunk that ends at or before the insert offset is identical: same offset, length
  and blob ID.
- (b) The boundaries resynchronise: from some boundary after the edit, the remaining chunks
  equal the original's, shifted by the insert length.
- (c) On the frozen 5 MiB vector and on 20 seeded random 5 MiB inputs (random offset in
  1 MiB … 4 MiB), each case changed exactly **1** chunk. The test asserts ≤ 4.

**Known limit.** An insert in the 31 bytes before a cut point changes the Gear window that chose
that cut, so the boundary can disappear. Normalised chunking then cuts the following chunks
elsewhere until both alignments meet a cut that holds under both masks.

| Measurement | Result |
| --- | --- |
| 60 such inserts on a 64 MiB random input | 1–6 chunks changed (mean 2.28); all resynchronised |
| Same kind of insert in the 5 MiB vector, about 2.5 MiB in | 5 chunks changed, no resync before end of file |

The test reports these near-cut cases and asserts (a) for them, but not the ≤ 4 bound.

## 10. Size limits (checked before any parse or decrypt)

| Object | Min | Max |
| --- | --- | --- |
| Blob | 4142 B (29 + 4 KiB + 17) | 2 359 937 B (29 + 2.25 MiB + 36 × 17) |
| Commit | 113 B | 16 MiB; header ≤ 1024 B |
| Envelope | 114 B | 1024 B; header ≤ 256 B |
| Device identity | — | 512 B |
| Recovery key text | — | 256 characters before normalisation |
| File | 0 | 100 MiB |

## 11. Test vectors

`tools/fixtures/sync-v1/` holds JSON with hex:

| File | Contents |
| --- | --- |
| `keys.json` | Device keys from seeds, identities, subkeys, recovery-key encodings, Argon2id key |
| `blobs.json` | Each padding edge: derived blob key, blob ID, full encoding up to 16 KiB, BLAKE2b-256 above that |
| `commit.json` | A commit |
| `envelopes.json` | All three envelope kinds |
| `chunker.json` | Gear table, and 5 MiB boundaries before and after a one-byte insert |

- The tests recompute every output from fixed inputs and fail on any drift. They also decode
  the frozen bytes.
- **Randomness.** Randomness that Neuron chooses (keys, nonces, salts) is injected through
  test-only seams (`keysTestSeams`, `formatTestSeams`). A test fails if anything under `src/`
  outside `src/main/sync/` names them. Randomness that libsodium draws internally (the
  secretstream header, sealed-box ephemeral keys) is made deterministic by the test alone,
  through libsodium's `getRandomValue` hook. Production code has no seam for it.
- **Regenerating.** `--write-vectors` creates missing fixture files and never overwrites one.
