// Keyed FastCDC (design §3.11, docs/sync/format-v1.md §8). Pure: bytes + key in,
// boundaries out. The key is the `cdc` subkey of the workspace's FIRST epoch
// key, so a key rotation never moves boundaries.
import { fail } from './codec';
import { sodium } from './sodium';

const KiB = 1024;
export const CDC = {
  min: 128 * KiB,
  avg: 512 * KiB,
  max: 2 * 1024 * KiB,
  /** Normalised chunking, level 2: 19 + 2 mask bits before `avg`, 19 - 2 after. */
  maskBitsSmall: 21,
  maskBitsLarge: 17,
} as const;

// The masks test the TOP bits of the 32-bit Gear hash: bit k of a left-shifting
// Gear hash depends on the last k + 1 bytes, so the high bits carry the most
// content. Fixed, not keyed: the key already decides every hash value.
const topBits = (bits: number): number => (0xffffffff << (32 - bits)) >>> 0;
const MASK_SMALL = topBits(CDC.maskBitsSmall);
const MASK_LARGE = topBits(CDC.maskBitsLarge);

export interface ChunkBoundary {
  offset: number;
  length: number;
}

/**
 * 256 × uint32: the XChaCha20 keystream (key = cdc subkey, nonce = 24 zero
 * bytes) over 1024 bytes, read as little-endian words.
 */
export function gearTable(cdcKey: Uint8Array): Uint32Array {
  if (!(cdcKey instanceof Uint8Array) || cdcKey.length !== 32) fail('shape', 'cdc key must be 32 bytes');
  const stream = sodium().crypto_stream_xchacha20_xor(new Uint8Array(1024), new Uint8Array(24), cdcKey);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = (stream[i * 4] | (stream[i * 4 + 1] << 8) | (stream[i * 4 + 2] << 16) | (stream[i * 4 + 3] << 24)) >>> 0;
  }
  return table;
}

function cutLength(data: Uint8Array, start: number, table: Uint32Array): number {
  let n = data.length - start;
  if (n <= CDC.min) return n;
  if (n > CDC.max) n = CDC.max;
  const normal = n < CDC.avg ? n : CDC.avg;
  let hash = 0;
  let i = CDC.min;
  for (; i < normal; i++) {
    hash = ((hash << 1) + table[data[start + i]]) >>> 0;
    if ((hash & MASK_SMALL) === 0) return i + 1;
  }
  for (; i < n; i++) {
    hash = ((hash << 1) + table[data[start + i]]) >>> 0;
    if ((hash & MASK_LARGE) === 0) return i + 1;
  }
  return n;
}

/** Boundaries with a precomputed Gear table (see gearTable). Empty input → no chunks. */
export function chunkWithTable(data: Uint8Array, table: Uint32Array): ChunkBoundary[] {
  if (!(data instanceof Uint8Array)) fail('shape', 'input is not bytes');
  if (!(table instanceof Uint32Array) || table.length !== 256) fail('shape', 'gear table must be 256 words');
  const out: ChunkBoundary[] = [];
  let offset = 0;
  while (offset < data.length) {
    const length = cutLength(data, offset, table);
    out.push({ offset, length });
    offset += length;
  }
  return out;
}

/** `(bytes, cdcKey) → [{offset, length}]`. Files up to 128 KiB are one chunk. */
export const chunkBoundaries = (data: Uint8Array, cdcKey: Uint8Array): ChunkBoundary[] => chunkWithTable(data, gearTable(cdcKey));
