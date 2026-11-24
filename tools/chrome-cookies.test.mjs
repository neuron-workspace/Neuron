// Runnable check for decryptValue in src/main/chrome-cookies.ts: Chrome's
// v10/v11 AES-256-GCM cookie values, and nothing shorter than a full tag.
// Run: node tools/chrome-cookies.test.mjs
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main/chrome-cookies.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const realRequire = createRequire(import.meta.url);
const module = { exports: {} };
// sql.js is only used by the import itself, not by decryption.
const require = (name) => name === 'sql.js' ? () => assert.fail('decryption must not load sql.js')
  : name === './cookie-domain' ? {} : realRequire(name);
new Function('exports', 'require', 'module', outputText)(module.exports, require, module);
const { decryptValue } = module.exports;
assert.equal(typeof decryptValue, 'function', 'chrome-cookies.ts exports decryptValue');

const key = crypto.randomBytes(32);
/** What Chrome stores: "v10" + 12-byte nonce + ciphertext + 16-byte tag. */
function chromeValue(plain, prefix = 'v10') {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from(prefix, 'latin1'), nonce, ciphertext, cipher.getAuthTag()]);
}

const tests = [
  ['a valid v10 and v11 value still decrypts', () => {
    assert.equal(decryptValue(chromeValue('session=abc123'), key), 'session=abc123');
    assert.equal(decryptValue(chromeValue('session=abc123', 'v11'), key), 'session=abc123');
  }],
  ['Chrome 104+ domain-hash prefix is dropped', () => {
    const hash = crypto.createHash('sha256').update('github.com').digest();
    hash[0] = 0x01; // not printable, as the real hash usually is not
    assert.equal(decryptValue(chromeValue(Buffer.concat([hash, Buffer.from('token')])), key), 'token');
  }],
  ['an empty cookie value (prefix + nonce + tag, nothing else) decrypts to ""', () => {
    assert.equal(decryptValue(chromeValue(''), key), '');
  }],
  ['a value too short to hold a full 16-byte tag returns null', () => {
    const whole = chromeValue('');
    assert.equal(whole.length, 31);
    for (let length = 0; length < 31; length++) {
      assert.equal(decryptValue(whole.subarray(0, length), key), null, `length ${length}`);
    }
    // Truncated values of a real cookie, down to where only part of the tag is left.
    const real = chromeValue('x');
    assert.equal(decryptValue(real.subarray(0, 30), key), null);
    assert.equal(decryptValue(real.subarray(0, 16), key), null);
  }],
  ['a truncated tag is never accepted as a short tag', () => {
    // Before the fix a 19-byte input made a 4-byte "tag"; GCM would check only that.
    const value = chromeValue('');
    const shortTag = Buffer.concat([value.subarray(0, 15), value.subarray(15, 19)]);
    assert.equal(decryptValue(shortTag, key), null);
  }],
  ['a tampered value fails authentication', () => {
    const value = chromeValue('session=abc123');
    value[20] ^= 0xff;
    assert.throws(() => decryptValue(value, key));
  }],
  ['app-bound (v20) and DPAPI values are skipped', () => {
    assert.equal(decryptValue(chromeValue('x', 'v20'), key), null);
    assert.equal(decryptValue(Buffer.from([1, 0, 0, 0]), key), null);
  }],
  ['the decipher is created with a fixed 16-byte tag length', () => {
    assert.match(source, /createDecipheriv\('aes-256-gcm', aesKey, nonce, \{ authTagLength: TAG_BYTES \}\)/);
    assert.match(source, /const TAG_BYTES = 16;/);
  }],
];

let failures = 0;
for (const [name, test] of tests) {
  try {
    await test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}\n  ${error.message}`);
  }
}
if (failures) {
  console.error(`chrome cookies: ${failures} of ${tests.length} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`chrome cookies: all ${tests.length} checks passed`);
}
