// Shared setup for tools/sync-crypto.test.mjs and tools/sync-chunker.test.mjs:
// bundle src/main/sync with esbuild into a temp CommonJS file under tools/,
// load it, and wait for libsodium. CommonJS on purpose: libsodium's Emscripten
// glue uses require() and __dirname, which an ESM bundle does not have.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const fixturesDir = join(root, 'tools', 'fixtures', 'sync-v1');

export async function loadSync(tag) {
  const { outputFiles } = await build({
    stdin: {
      contents: ['sodium', 'codec', 'keys', 'format', 'chunker'].map((m) => `export * from './src/main/sync/${m}';`).join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const tmp = join(root, 'tools', `.${tag}.tmp.cjs`);
  writeFileSync(tmp, outputFiles[0].text);
  let sync;
  try {
    sync = createRequire(import.meta.url)(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
  await sync.initSodium();
  return sync;
}

export function makeHelpers(sync) {
  const s = sync.sodium();
  const enc = new TextEncoder();
  const hex = (b) => sync.toHex(b);
  const unhex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

  /** Deterministic bytes for a label: XChaCha20 keystream under BLAKE2b-256(label). */
  const labelBytes = (label, n, counter = 0) => {
    const nonce = new Uint8Array(24);
    new DataView(nonce.buffer).setUint32(0, counter, true);
    return s.crypto_stream_xchacha20_xor(new Uint8Array(n), nonce, s.crypto_generichash(32, enc.encode(label), null));
  };

  /** A seam Rng that yields a fresh deterministic block per call. */
  const seqRng = (label) => {
    let counter = 0;
    return (n) => labelBytes(label, n, counter++);
  };

  /** mulberry32: small seeded PRNG for fuzz and test inputs. */
  const prng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0);
    };
  };

  /**
   * Make libsodium's own randomness (secretstream headers, sealed-box
   * ephemeral keys) deterministic for the duration of fn. Test-only: it patches
   * the loaded module object, never production code.
   */
  const withDeterministicSodium = (seed, fn) => {
    const module = s.libsodium;
    assert.equal(typeof module?.getRandomValue, 'function', 'libsodium RNG hook not found: vectors cannot be reproduced');
    const original = module.getRandomValue;
    const next = prng(seed);
    module.getRandomValue = () => next();
    try {
      return fn();
    } finally {
      module.getRandomValue = original;
    }
  };

  /** Run fn with call counters on the named sodium functions. */
  const spy = (names, fn) => {
    const calls = Object.fromEntries(names.map((n) => [n, 0]));
    const originals = Object.fromEntries(names.map((n) => [n, s[n]]));
    for (const n of names) s[n] = (...args) => { calls[n]++; return originals[n](...args); };
    try {
      fn();
    } finally {
      for (const n of names) s[n] = originals[n];
    }
    return calls;
  };

  /** Assert fn throws SyncFormatError with a code in `codes`; nothing returned. */
  const rejects = (fn, codes, what) => {
    const allowed = Array.isArray(codes) ? codes : [codes];
    let result;
    try {
      result = fn();
    } catch (error) {
      assert.ok(error instanceof sync.SyncFormatError, `${what}: threw ${error?.name}: ${error?.message}`);
      assert.ok(allowed.includes(error.code), `${what}: code ${error.code} (${error.message}), expected ${allowed.join('|')}`);
      return error;
    }
    assert.fail(`${what}: accepted (returned ${typeof result})`);
  };

  /** Known-answer fixtures: compare, or write once with --write-vectors (never overwrites). */
  const checkVectors = (name, actual) => {
    const file = join(fixturesDir, name);
    const json = `${JSON.stringify(actual, null, 2)}\n`;
    let text;
    try {
      text = readFileSync(file, 'utf-8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      assert.ok(process.argv.includes('--write-vectors'), `${file} is missing (run with --write-vectors to create it once)`);
      mkdirSync(fixturesDir, { recursive: true });
      writeFileSync(file, json, { flag: 'wx' }); // exclusive create: never overwrites
      console.log(`  wrote ${file}`);
      return JSON.parse(json);
    }
    const frozen = JSON.parse(text);
    assert.deepEqual(actual, frozen, `${name}: output drifted from the frozen vectors`);
    return frozen;
  };

  return { s, enc, hex, unhex, labelBytes, seqRng, prng, withDeterministicSodium, spy, rejects, checkVectors };
}
