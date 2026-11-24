import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/main/secret-storage.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { encodeSecret, decodeSecret, hasStoredSecret, carriesApiKey, migrateSecretSettings, rendererSettingsValue, NO_KEYCHAIN_ERROR, noKeychainError } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
// Deliberately not encryption: an injected codec proves all paths use the keychain.
const codec = { available: true, encrypt: (value) => Buffer.from([...value].reverse().join('')), decrypt: (value) => [...value.toString()].reverse().join('') };
const unavailable = { ...codec, available: false, encrypt: () => assert.fail('must not encrypt without a keychain') };
const stored = encodeSecret('secret-value', codec);
assert.deepEqual(stored, { v: 1, enc: Buffer.from('eulav-terces').toString('base64') });
assert.equal(decodeSecret(stored, codec), 'secret-value');
assert.equal(decodeSecret('legacy-value', unavailable), 'legacy-value');
assert.equal(decodeSecret(stored, unavailable), null);
assert.equal(decodeSecret(stored, { ...codec, decrypt: () => { throw Error('locked'); } }), null);
assert.equal(decodeSecret({ v: 2, enc: 'wrong-version' }, codec), null);
assert.throws(() => encodeSecret('new-key', unavailable), { message: noKeychainError(process.platform) });
// 10B: only Linux can lack a keychain, so only Linux is told how to get one.
assert.equal(NO_KEYCHAIN_ERROR, "No system keychain is available, so Neuron can't store keys safely on this computer.");
assert.equal(noKeychainError('win32'), NO_KEYCHAIN_ERROR);
assert.equal(noKeychainError('darwin'), NO_KEYCHAIN_ERROR);
assert.equal(noKeychainError('linux'), `${NO_KEYCHAIN_ERROR} Install and unlock GNOME Keyring or KWallet, then restart Neuron.`);
// Whether a key is saved is read off its shape: never decrypted.
const noDecrypt = { ...codec, decrypt: () => assert.fail('has-secret must not decrypt') };
assert.equal(hasStoredSecret(stored, noDecrypt), true);
assert.equal(hasStoredSecret('legacy-value', { available: false }), true, 'an unmigrated key is usable without a keychain');
assert.equal(hasStoredSecret(stored, { available: false }), false, 'as decodeSecret: no keychain, no usable key');
for (const junk of ['', null, undefined, 42, {}, [], { v: 2, enc: 'x' }, { v: 1, enc: '' }, { v: 1, enc: 42 }]) assert.equal(hasStoredSecret(junk, noDecrypt), false, JSON.stringify(junk));
// An apiKey anywhere, at any depth, in objects and arrays alike.
for (const value of [{ apiKey: 'k' }, { apiKey: '' }, { apiKey: null }, { a: { b: { apiKey: 'k' } } }, [[{ apiKey: 'k' }]], { list: [1, { deep: [{ apiKey: 'k' }] }] }]) {
  assert.equal(carriesApiKey(value), true, JSON.stringify(value));
}
for (const value of [null, undefined, 'apiKey', 42, [], {}, { apiKeyHint: 'x' }, { note: 'apiKey' }, ['apiKey'], { a: { apikey: 'not this spelling' } }]) {
  assert.equal(carriesApiKey(value), false, JSON.stringify(value));
}
const cyclic = { a: {} }; cyclic.a.self = cyclic;
assert.equal(carriesApiKey(cyclic), false, 'a cycle ends');
cyclic.a.apiKey = 'k';
assert.equal(carriesApiKey(cyclic), true);
const original = {
  __secrets: { 'ai-openai': { apiKey: 'legacy-value' }, openai: { apiKey: 'current-value' }, other: { token: 'other-value' } },
  plugins: { config: { 'ai-claude': { apiKey: 'plugin-value', model: 'my-model' } } },
  'plugins:workspace': { config: { 'ai-gemini': { apiKey: 'workspace-value' } } },
  connectors: { openrouter: { apiKey: 'connector-value', model: 'other-model' } },
};
const before = JSON.stringify(original);
const migrated = migrateSecretSettings(original, codec);
assert.equal(JSON.stringify(original), before, 'migration does not mutate its input');
for (const value of ['legacy-value', 'current-value', 'other-value', 'plugin-value', 'workspace-value', 'connector-value']) assert.ok(!JSON.stringify(migrated).includes(value), value);
assert.equal(decodeSecret(migrated.__secrets.openai.apiKey, codec), 'current-value', 'current connector wins');
assert.equal(decodeSecret(migrated.__secrets['ai-openai'].apiKey, codec), 'legacy-value', 'old scopes are encrypted too');
assert.equal(decodeSecret(migrated.__secrets.anthropic.apiKey, codec), 'plugin-value');
assert.equal(decodeSecret(migrated.__secrets.google.apiKey, codec), 'workspace-value');
assert.equal(decodeSecret(migrated.__secrets.openrouter.apiKey, codec), 'connector-value');
assert.equal(migrated.plugins.config['ai-claude'].model, 'my-model');
assert.deepEqual(migrateSecretSettings(migrated, codec), migrated, 'migration is idempotent');
assert.equal(migrateSecretSettings(original, unavailable), original, 'no keychain leaves existing values untouched');
delete migrated.__secrets.openai.apiKey;
assert.equal(migrateSecretSettings(migrated, codec).__secrets.openai.apiKey, undefined, 'restart never resurrects a disconnected key');
assert.equal(rendererSettingsValue('__secrets', original.__secrets), null);
for (const key of ['plugins', 'plugins:workspace', 'connectors']) assert.ok(!JSON.stringify(rendererSettingsValue(key, original[key])).includes('apiKey'));
assert.equal(JSON.stringify(original), before, 'redaction does not mutate saved values');
assert.throws(() => migrateSecretSettings(original, { ...codec, encrypt: () => { throw Error('failed'); } }), /failed/);
assert.equal(JSON.stringify(original), before, 'encryption failure is atomic');
console.log('secret-storage: encode/decode, refusal and its Linux wording, has-secret shape, apiKey at any depth, legacy migration, idempotence, redaction, and failure checks passed');
