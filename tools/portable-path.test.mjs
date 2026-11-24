// Run: node tools/portable-path.test.mjs
// P0-6: whether a workspace-relative path can exist on every OS, with reasons.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './src/main/portable-path';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const { checkPortablePath: check, findCaseCollisions, portableFoldKey, MAX_SEGMENT_BYTES, MAX_PATH_CHARS } = m;

let checks = 0;
const codes = (path) => check(path).reasons.map((r) => r.code);
const ok = (path) => {
  const result = check(path);
  assert.equal(result.portable, true, `${JSON.stringify(path)} is portable: ${JSON.stringify(result.reasons)}`);
  assert.deepEqual(result.reasons, [], `${JSON.stringify(path)} has no reasons`);
  checks++;
};
const bad = (path, code, segment) => {
  const result = check(path);
  assert.equal(result.portable, false, `${JSON.stringify(path)} is not portable`);
  const reason = result.reasons.find((r) => r.code === code);
  assert.ok(reason, `${JSON.stringify(path)}: expected ${code}, got ${codes(path)}`);
  assert.equal(reason.severity, 'error');
  if (segment !== undefined) assert.equal(reason.segment, segment);
  assert.equal(typeof reason.message, 'string');
  checks++;
};

// Ordinary names, on every OS.
for (const path of ['note.md', 'Notes/2026/plan.md', 'a b/c-d_e.md', '.neuron/layout.json', 'café.md', '日本語/ノート.md', 'emoji 😀.md',
  'console.md', 'nullable.md', 'com10.md', 'lpt0.txt', 'auxiliary/x.md', 'con-tents.md', ' leading space.md', 'x.CONfig', 'a.b.c']) ok(path);

// Windows-illegal characters, on every OS.
for (const ch of ['<', '>', ':', '"', '|', '?', '*', '\\']) bad(`notes/a${ch}b.md`, 'illegal-character', `a${ch}b.md`);
bad('a:stream', 'illegal-character');
// Control characters.
for (const code of [0, 1, 9, 10, 13, 31]) bad(`a${String.fromCharCode(code)}b.md`, 'control-character');
ok('tab\u007f.md'); // DEL is legal everywhere
// Trailing dot or space, in a file or a folder.
for (const [path, segment] of [['note.', 'note.'], ['note ', 'note '], ['folder./a.md', 'folder.'], ['folder /a.md', 'folder '], ['...', '...']]) {
  bad(path, 'trailing-dot-or-space', segment);
}
// Device names: with or without extension, any case, file or folder.
for (const name of ['CON', 'con', 'Prn', 'AUX', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9', 'COM¹', 'LPT³', 'NUL.txt', 'con.tar.gz', 'Aux.md', 'nul .txt']) {
  bad(name, 'reserved-name', name);
  bad(`folder/${name}`, 'reserved-name', name);
  bad(`${name}/inside.md`, 'reserved-name', name);
}
// Segment length: 255 bytes of UTF-8, not characters.
ok('a'.repeat(MAX_SEGMENT_BYTES));
bad('a'.repeat(MAX_SEGMENT_BYTES + 1), 'segment-too-long');
ok('é'.repeat(127) + 'a'); // 255 bytes
bad('é'.repeat(128), 'segment-too-long'); // 256 bytes, 128 characters
bad('folder/' + '😀'.repeat(64), 'segment-too-long'); // 256 bytes
// Total length: a warning only, the path still portable.
{
  const long = Array.from({ length: 30 }, (_, i) => `folder${String(i).padStart(2, '0')}`).join('/') + '/n.md';
  assert.ok(long.length > MAX_PATH_CHARS);
  const result = check(long);
  assert.equal(result.portable, true);
  assert.deepEqual(result.reasons.map((r) => [r.code, r.severity]), [['path-too-long', 'warning']]);
  ok('a/'.repeat(129) + 'b'); // 260 characters exactly
  checks++;
}
// Not a relative path, or not names.
for (const path of ['/etc/passwd', 'C:/x.md', 'c:x.md']) bad(path, 'absolute');
for (const path of ['', 'a//b.md', 'a/', '/']) bad(path, 'empty-segment');
for (const path of ['.', '..', 'a/../b.md', './a.md']) bad(path, 'dot-segment');
assert.deepEqual(codes('/etc/passwd'), ['absolute'], 'a leading slash is reported once');

// NFC: the NFC form is returned, and a name that changes is flagged (a warning: it can be stored, as NFC).
{
  const nfd = 'cafe\u0301/re\u0301sume\u0301.md';
  const result = check(nfd);
  assert.equal(result.nfc, 'café/résumé.md');
  assert.equal(result.nfc, nfd.normalize('NFC'));
  assert.equal(result.portable, true);
  assert.deepEqual(result.reasons.map((r) => [r.code, r.severity, r.segment]), [['not-nfc', 'warning', 'cafe\u0301'], ['not-nfc', 'warning', 're\u0301sume\u0301.md']]);
  assert.equal(check('café.md').nfc, 'café.md');
  assert.deepEqual(check('café.md').reasons, []);
  // Several reasons at once, each with its segment.
  assert.deepEqual(codes('CON/a?.'), ['reserved-name', 'illegal-character', 'trailing-dot-or-space']);
  checks += 3;
}

// Case-fold collisions within a set, including NFC/NFD spellings and folders.
{
  assert.deepEqual(findCaseCollisions(['Note.md', 'note.md', 'other.md']), [{ key: 'note.md', spellings: ['Note.md', 'note.md'] }]);
  assert.deepEqual(findCaseCollisions(['café.md', 'cafe\u0301.md']), [{ key: 'café.md', spellings: ['cafe\u0301.md', 'café.md'].sort() }]);
  assert.deepEqual(findCaseCollisions(['CAFÉ.md', 'cafe\u0301.md']).length, 1, 'case and normalisation together');
  assert.deepEqual(findCaseCollisions(['Docs/a.md', 'docs/b.md']), [{ key: 'docs', spellings: ['Docs', 'docs'] }], 'folders collide too');
  assert.deepEqual(findCaseCollisions(['a/Note.md', 'b/note.md', 'note.md', 'note.md']), [], 'different folders and the same spelling twice are fine');
  assert.deepEqual(findCaseCollisions([]), []);
  assert.deepEqual(findCaseCollisions(['Ab', 'aB', 'AB']), [{ key: 'ab', spellings: ['AB', 'Ab', 'aB'] }]);
  assert.equal(portableFoldKey('Cafe\u0301/NOTE.md'), 'café/note.md');
  checks += 8;
}

// This module answers questions; it does not change what Neuron allows locally (Batch 1 rules stay Windows-only).
for (const file of ['../src/main/repoPath.ts', '../src/main/main.ts']) {
  assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /portable-path/, `${file} does not use the portable checks (yet)`);
  checks++;
}

console.log(`portable-path: ${checks} checks; illegal and control characters, trailing dot/space, device names, 255-byte segments, 260-char warning, NFC and case-fold collisions`);
