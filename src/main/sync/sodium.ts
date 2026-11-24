// The single place that loads libsodium (D40). Nothing else under src/ imports
// the package. No `electron` import: this runs in plain Node (unit tests) and in
// the sync utility process (D41).
//
// `import = require` on purpose: libsodium-wrappers attaches its functions to
// the exported object only after `ready` resolves, so an ES namespace import
// (tsc's __importStar) would copy an object that has none of them yet.
import sodiumLib = require('libsodium-wrappers-sumo');

export type Sodium = typeof sodiumLib;

let readyPromise: Promise<void> | null = null;
let loaded = false;

/** Load the WASM module once. Every other sync function needs this awaited first. */
export function initSodium(): Promise<void> {
  readyPromise ??= sodiumLib.ready.then(() => {
    loaded = true;
  });
  return readyPromise;
}

/** The loaded library. Throws (a programming error, not a format error) before initSodium() resolves. */
export function sodium(): Sodium {
  if (!loaded) throw new Error('libsodium is not initialised: await initSodium() first');
  return sodiumLib;
}

/** Fresh random bytes from libsodium's CSPRNG. */
export type Rng = (length: number) => Uint8Array;
export const systemRng: Rng = (length) => sodium().randombytes_buf(length);
