// Shared pieces of the sync object formats (docs/sync/format-v1.md): the typed
// decoder error, strict hex, byte helpers and the one canonical header
// serialiser. No libsodium and no electron here.

export type SyncFormatErrorCode =
  | 'magic'
  | 'version'
  | 'size'
  | 'auth'
  | 'signature'
  | 'shape'
  | 'checksum';

/** The only error a sync decoder throws for bad input. A decoder never returns a partial object. */
export class SyncFormatError extends Error {
  readonly code: SyncFormatErrorCode;
  constructor(code: SyncFormatErrorCode, message: string) {
    super(message);
    this.name = 'SyncFormatError';
    this.code = code;
  }
}

export function fail(code: SyncFormatErrorCode, message: string): never {
  throw new SyncFormatError(code, message);
}

const HEX = /^(?:[0-9a-f]{2})*$/;

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Lowercase hex only; anything else (odd length, uppercase, other characters) is a shape error. */
export function fromHex(hex: string, expectedBytes?: number): Uint8Array {
  if (typeof hex !== 'string' || !HEX.test(hex)) fail('shape', 'not lowercase hex');
  if (expectedBytes !== undefined && hex.length !== expectedBytes * 2) fail('shape', `hex must encode ${expectedBytes} bytes`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const isHex = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && value.length === bytes * 2 && HEX.test(value);

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const u16be = (value: number): Uint8Array => new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
export const readU16be = (bytes: Uint8Array, offset: number): number => (bytes[offset] << 8) | bytes[offset + 1];

const utf8Encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array => utf8Encoder.encode(text);

/** Strict UTF-8: invalid sequences are a shape error, never U+FFFD. */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail('shape', 'not valid UTF-8');
  }
}

/** True when the string has no unpaired surrogate (so its UTF-8 length is exact). */
export const isWellFormed = (text: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

export const utf8Length = (text: string): number => utf8Encoder.encode(text).length;

// --- canonical headers ------------------------------------------------------
// One function produces every plaintext header: UTF-8 JSON, keys in the order
// the format fixes, no whitespace. Values are strings or non-negative safe
// integers only. Decoders parse, then re-serialise and compare bytes, so a
// reordered, padded, duplicated or re-escaped header is rejected.

export type HeaderValue = string | number;
export type HeaderField = readonly [key: string, value: HeaderValue];

export function canonicalHeader(fields: readonly HeaderField[]): Uint8Array {
  const parts = fields.map(([key, value]) => {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) fail('shape', `header field ${key} must be a non-negative safe integer`);
      return `${JSON.stringify(key)}:${String(value)}`;
    }
    if (typeof value !== 'string' || !isWellFormed(value)) fail('shape', `header field ${key} must be a well-formed string`);
    return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
  });
  return utf8(`{${parts.join(',')}}`);
}

export type HeaderSpec = readonly { key: string; type: 'string' | 'int' }[];

/**
 * Parse a header written by canonicalHeader. Exactly the keys of `spec`, each of
 * the right JSON type, and byte-identical to its own canonical re-serialisation.
 */
export function parseCanonicalHeader(bytes: Uint8Array, spec: HeaderSpec): Record<string, HeaderValue> {
  const text = decodeUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('shape', 'header is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('shape', 'header is not an object');
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== spec.length) fail('shape', 'header has the wrong fields');
  const out: Record<string, HeaderValue> = {};
  const fields: HeaderField[] = [];
  for (const { key, type } of spec) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) fail('shape', `header is missing ${key}`);
    const value = record[key];
    if (type === 'string' ? typeof value !== 'string' : !Number.isSafeInteger(value)) fail('shape', `header field ${key} has the wrong type`);
    out[key] = value as HeaderValue;
    fields.push([key, value as HeaderValue]);
  }
  if (!bytesEqual(canonicalHeader(fields), bytes)) fail('shape', 'header is not in canonical form');
  return out;
}
