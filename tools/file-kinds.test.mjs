// Runnable check for src/main/file-kinds.ts and src/main/file-protocol.ts:
// bundle with esbuild, then assert against real temporary folders.
// Run: node tools/file-kinds.test.mjs
import { build } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(tmpdir(), 'neuron-file-kinds-'));
let checks = 0;
const check = (what, fn) => {
  try { fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
};
const load = async (entry) => {
  const { outputFiles } = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'esm', write: false });
  const file = path.join(temp, path.basename(entry, '.ts') + '.mjs');
  fs.writeFileSync(file, outputFiles[0].text);
  return import(pathToFileURL(file));
};

try {
  const { fileKind, needsSniff, looksLikeText, extensionOf, isListedFile, isUnlistedText } = await load('src/main/file-kinds.ts');
  const { NOTE_READ_LIMIT, tooLargeToOpen, TOO_LARGE_TO_OPEN } = await load('src/main/file-limits.ts');

  check('the 25 MB ceiling: past it a note is listed but not read; an unknown size is left to the read', () => {
    assert.equal(NOTE_READ_LIMIT, 25 * 1024 * 1024);
    assert.equal(tooLargeToOpen(NOTE_READ_LIMIT), false, 'exactly 25 MB is read');
    assert.equal(tooLargeToOpen(NOTE_READ_LIMIT + 1), true);
    assert.equal(tooLargeToOpen(26 * 1024 * 1024), true);
    assert.equal(tooLargeToOpen(0), false);
    assert.equal(tooLargeToOpen(undefined), false);
    assert.equal(tooLargeToOpen(null), false);
    assert.match(TOO_LARGE_TO_OPEN, /^Error: This file is too large to open in Neuron \(over 25 MB\)\.$/);
  });

  const expected = {
    note: ['md', 'mdx'],
    view: ['html'],
    db: ['db'],
    canvas: ['canvas'],
    diagram: ['mmd', 'mermaid'],
    table: ['csv'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'],
    video: ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
    audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac'],
    text: ['json', 'txt', 'log', 'yaml', 'yml', 'toml', 'ini', 'xml', 'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'css', 'scss', 'sql'],
    blocked: ['exe', 'msi', 'dll', 'bat', 'cmd', 'com', 'ps1', 'psm1', 'vbs', 'sh', 'bash', 'zsh', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'jar', 'apk', 'scr', 'lnk', 'reg'],
    other: ['pdf', 'docx', 'zip', 'heic'],
  };
  for (const [kind, extensions] of Object.entries(expected)) {
    for (const ext of extensions) {
      check(`${ext} is ${kind}`, () => {
        assert.equal(fileKind(`folder/file.${ext}`), kind);
        assert.equal(fileKind(`folder/FILE.${ext.toUpperCase()}`), kind, 'case-insensitive');
        assert.equal(needsSniff(`file.${ext}`), false);
      });
    }
  }
  check('programs stay blocked whatever the case or the folder', () => {
    for (const name of ['tool.exe', 'Tool.EXE', 'deep/dir/run.Bat', 'C:\\x\\setup.MSI', 'a.b.ps1', 'archive.tar.sh']) assert.equal(fileKind(name), 'blocked', name);
  });
  check('a dot-name is an extension only for blocked files', () => {
    for (const name of ['.bat', '.BAT', '.CMD', '.ps1', 'sub/.sh']) {
      assert.equal(fileKind(name), 'blocked', name);
      assert.equal(needsSniff(name), false, name);
    }
    for (const name of ['.gitignore', '.env', '.prettierrc']) {
      assert.equal(extensionOf(name), '', name);
      assert.equal(fileKind(name), 'other', name);
      assert.equal(needsSniff(name), true, name);
    }
    assert.equal(fileKind('.env.example'), 'text');
    assert.equal(needsSniff('.env.example'), false);
  });
  check('JavaScript is text, never a program', () => assert.equal(fileKind('src/app.js'), 'text'));
  check('the extension is the last one, and a leading dot is not one', () => {
    assert.equal(extensionOf('a/b.tar.gz'), 'gz');
    assert.equal(extensionOf('.gitignore'), '');
    assert.equal(extensionOf('folder.v2/README'), '');
    assert.equal(fileKind('photo.png.exe'), 'blocked');
    assert.equal(fileKind('script.exe.txt'), 'text');
  });
  check('.env.example is text by name', () => {
    assert.equal(fileKind('.env.example'), 'text');
    assert.equal(fileKind('config/.ENV.EXAMPLE'), 'text');
    assert.equal(needsSniff('.env.example'), false);
  });
  check('names with several dots go by the last one, in any case', () => {
    for (const [name, kind] of [['my.notes.v2.md', 'note'], ['README.MD', 'note'], ['Q3.report.final.CSV', 'table'], ['data.backup.json', 'text'],
      ['Photo.2024.JPEG', 'image'], ['archive.tar.gz', 'other'], ['setup.v1.2.Exe', 'blocked'], ['notes.md.bak', 'other'], ['a..md', 'note']]) {
      assert.equal(fileKind(name), kind, name);
    }
    assert.equal(needsSniff('notes.md.bak'), true);
    assert.equal(fileKind('.ENV.EXAMPLE'), 'text');
    assert.equal(fileKind('sub/dir/.env.example'), 'text');
    assert.equal(fileKind('.env.example.bak'), 'other', 'only the whole name');
  });
  check('notes:list lists notes, Neuron documents and workspace configuration, and nothing else', () => {
    for (const name of ['a.md', 'b.mdx', 'v.html', 'p.db', 'i.canvas', 'f.mmd', 'f.mermaid', 't.csv', 'T.CSV', 'data/t.Csv', 'neuron.config', 'x.neuron.json',
      '.neuron/layout.json', '.neuron/tables/t.csv.json', '.neuron/fragments/f.html', '.neuron/styles/s.css']) assert.equal(isListedFile(name), true, name);
    for (const name of ['a.json', 'readme.txt', 'Makefile', 'a.png', 'tool.exe', 'docs/neuron.config', '.neuron/notes.txt', 'x.pdf', 'x.csv.bak']) assert.equal(isListedFile(name), false, name);
  });
  check('text files outside that listing are reported to an open copy; media and binaries are not', () => {
    for (const name of ['config.json', 'compose.YAML', 'notes.txt', 'Makefile', 'LICENSE', '.env.example', '.neuron/notes.txt']) assert.equal(isUnlistedText(name), true, name);
    for (const name of ['a.md', 'T.CSV', '.neuron/layout.json', 'a.png', 'clip.mp4', 'x.pdf', 'tool.exe', 'run.sh']) assert.equal(isUnlistedText(name), false, name);
  });
  check('names the table does not know are sniffed, and are other until then', () => {
    for (const name of ['Makefile', 'LICENSE', 'data.dat', 'weird.xyz', 'neuron.config', '.gitignore']) {
      assert.equal(fileKind(name), 'other', name);
      assert.equal(needsSniff(name), true, name);
    }
  });
  check('text is valid UTF-8 with no NUL byte', () => {
    const utf8 = (s) => new TextEncoder().encode(s);
    assert.equal(looksLikeText(utf8('plain ascii\n')), true);
    assert.equal(looksLikeText(utf8('naïve — 日本語 🎉')), true);
    assert.equal(looksLikeText(new Uint8Array()), true);
    assert.equal(looksLikeText(utf8('a\0b')), false, 'NUL');
    assert.equal(looksLikeText(new Uint8Array([0x61, 0xff, 0x62])), false, 'invalid byte');
    assert.equal(looksLikeText(new Uint8Array([0xc3, 0x28])), false, 'bad continuation');
    // A sample cut in the middle of a character is still text.
    assert.equal(looksLikeText(utf8('ok 🎉').subarray(0, 5)), true, 'truncated at the end');
    assert.equal(looksLikeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])), false, 'PNG header');
  });

  const { authorizeFileUrl, parseRange, FILE_SCHEME } = await load('src/main/file-protocol.ts');
  const ws = path.join(temp, 'ws');
  const secret = path.join(temp, 'ws-secret');
  const otherWs = path.join(temp, 'other');
  for (const [dir, rel] of [[ws, 'a.png'], [ws, 'sub/clip.mp4'], [ws, 'sound.WAV'], [ws, 'b.json'], [ws, 'tool.exe'], [ws, 'note.md'], [ws, 'run.bat'], [secret, 'x.png'], [otherWs, 'x.png']]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  }
  const windows = new Map([[1, { token: 'a'.repeat(64), repo: ws }], [2, { token: 'b'.repeat(64), repo: otherWs }], [3, { token: 'c'.repeat(64), repo: null }]]);
  const lookup = (id) => windows.get(id) ?? null;
  const url = (id, token, rel) => `${FILE_SCHEME}://w/${id}/${token}/${encodeURIComponent(rel)}`;
  const ok = (u) => authorizeFileUrl(u, lookup);
  const t1 = windows.get(1).token;

  check('a workspace image, video and audio file are served with their type', () => {
    assert.deepEqual(ok(url(1, t1, 'a.png')), { ok: true, fullPath: path.join(ws, 'a.png'), mime: 'image/png', relativePath: 'a.png' });
    assert.equal(ok(url(1, t1, 'sub/clip.mp4')).mime, 'video/mp4');
    assert.equal(ok(url(1, t1, 'sound.WAV')).mime, 'audio/wav');
  });
  check('a missing media file passes the guard; the handler answers 404', () => assert.equal(ok(url(1, t1, 'missing.png')).ok, true));
  check("another window's token is refused", () => {
    assert.equal(ok(url(1, windows.get(2).token, 'a.png')).ok, false);
    assert.equal(ok(url(2, t1, 'x.png')).ok, false);
    assert.equal(ok(url(1, t1.slice(0, -1) + 'b', 'a.png')).ok, false);
    assert.equal(ok(url(1, '', 'a.png')).ok, false);
    assert.equal(ok(url(9, t1, 'a.png')).ok, false, 'no such window');
    assert.equal(ok(url(3, windows.get(3).token, 'a.png')).ok, false, 'a window with no workspace');
  });
  check('each window reads only its own workspace', () => {
    assert.equal(ok(url(2, windows.get(2).token, 'x.png')).fullPath, path.join(otherWs, 'x.png'));
    assert.equal(ok(url(2, windows.get(2).token, 'a.png')).fullPath, path.join(otherWs, 'a.png'));
  });
  check('traversal out of the workspace is refused', () => {
    const escapes = ['../ws-secret/x.png', 'sub/../../ws-secret/x.png', '../other/x.png', '..'];
    if (process.platform === 'win32') escapes.push('..\\ws-secret\\x.png');
    for (const rel of escapes) assert.equal(ok(url(1, t1, rel)).ok, false, rel);
  });
  check('absolute paths are refused', () => {
    const absolute = [path.join(secret, 'x.png'), path.join(otherWs, 'x.png'), '/etc/x.png', '//server/share/x.png'];
    if (process.platform === 'win32') absolute.push('C:\\x.png', 'D:x.png', '\\\\server\\share\\x.png');
    for (const rel of absolute) assert.equal(ok(url(1, t1, rel)).ok, false, rel);
  });
  check('programs, scripts, notes and text are never served', () => {
    for (const rel of ['tool.exe', 'run.bat', 'b.json', 'note.md', 'thing.svg.exe', 'Makefile', 'x.pdf']) assert.equal(ok(url(1, t1, rel)).ok, false, rel);
  });
  check('anything that is not exactly the URL form is refused', () => {
    const good = url(1, t1, 'a.png');
    for (const bad of [
      good.replace(FILE_SCHEME, 'file'), good.replace('://w/', '://x/'), good + '?x=1', good + '/extra',
      `${FILE_SCHEME}://w/1/${t1}/a.png/`, `${FILE_SCHEME}://w/one/${t1}/a.png`, `${FILE_SCHEME}://w/1/${t1}/%E0%A4%A`,
      `${FILE_SCHEME}://w:80/1/${t1}/a.png`, `${FILE_SCHEME}://u:p@w/1/${t1}/a.png`, `${FILE_SCHEME}://w/1/${t1}`, 'not a url',
      `${FILE_SCHEME}://w/1/${t1}/${encodeURIComponent('a\0.png')}`,
    ]) assert.equal(ok(bad).ok, false, bad);
  });
  check('a path is one encoded segment, so a slash in it cannot move the token', () => {
    assert.equal(ok(`${FILE_SCHEME}://w/1/${t1}/sub/clip.mp4`).ok, false);
  });
  check('media authorization rejects git internals and traversal on every platform, Windows aliases on Windows', () => {
    const windowsOnly = ['CON.png', 'NUL.png', 'COM1.png', 'aux.txt/a.png', 'a.png:stream.png', 'dir./a.png', 'dir /a.png', 'C:photo.png'];
    for (const rel of ['.git/a.png', '.GIT./a.png', '.git::$INDEX_ALLOCATION/a.png', 'sub/../a.png',
      ...(process.platform === 'win32' ? windowsOnly : [])]) {
      assert.equal(ok(url(1, t1, rel)).ok, false, rel);
    }
  });
  check('media authorization rejects junctions outside the workspace and into .git', () => {
    fs.mkdirSync(path.join(ws, '.git'));
    for (const [name, target] of [['escape', secret], ['gitlink', path.join(ws, '.git')]]) {
      fs.symlinkSync(target, path.join(ws, name), process.platform === 'win32' ? 'junction' : 'dir');
      assert.equal(ok(url(1, t1, `${name}/x.png`)).ok, false);
      assert.equal(ok(url(1, t1, `${name}/new/x.png`)).ok, false);
    }
  });

  check('range headers', () => {
    assert.equal(parseRange(null, 100), null);
    assert.equal(parseRange('', 100), null);
    assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
    assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 }, 'end clamps to the file');
    assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 }, 'suffix');
    assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 }, 'suffix longer than the file');
    assert.deepEqual(parseRange(' bytes=5-5 ', 100), { start: 5, end: 5 });
    assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
    assert.equal(parseRange('bytes=200-300', 100), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
    assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
    for (const ignored of ['bytes=20-10', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=a-b', 'bytes=1.5-2']) assert.equal(parseRange(ignored, 100), null, ignored);
    assert.deepEqual(parseRange('bytes=0-0', 100), { start: 0, end: 0 }, 'the first byte');
    assert.deepEqual(parseRange('bytes=50-', 100), { start: 50, end: 99 }, 'open-ended');
  });

  // The whole response, as neuron-file:// answers it, against a real file.
  const { respondWithFile } = await load('src/main/file-protocol.ts');
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  fs.writeFileSync(path.join(ws, 'sub/clip.mp4'), bytes);
  fs.mkdirSync(path.join(ws, 'folder.png'));
  const serve = (rel, { method = 'GET', range, token = t1 } = {}) => respondWithFile(new Request(url(1, token, rel), { method, headers: range ? { range } : {} }), lookup);
  const body = async (response) => Buffer.from(await response.arrayBuffer());
  const asyncChecks = [];
  const checkAsync = (what, fn) => asyncChecks.push([what, fn]);

  checkAsync('a whole file: 200 with its type, length, ranges offered and the safety headers', async () => {
    const response = await serve('sub/clip.mp4');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('content-length'), '1000');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.deepEqual(await body(response), bytes);
  });
  checkAsync('bytes=0-0 is the first byte', async () => {
    const response = await serve('sub/clip.mp4', { range: 'bytes=0-0' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-0/1000');
    assert.equal(response.headers.get('content-length'), '1');
    assert.deepEqual(await body(response), bytes.subarray(0, 1));
  });
  checkAsync('bytes=-500 is the last 500 bytes', async () => {
    const response = await serve('sub/clip.mp4', { range: 'bytes=-500' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 500-999/1000');
    assert.deepEqual(await body(response), bytes.subarray(500));
  });
  checkAsync('bytes=500- runs to the end', async () => {
    const response = await serve('sub/clip.mp4', { range: 'bytes=500-' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 500-999/1000');
    assert.deepEqual(await body(response), bytes.subarray(500));
  });
  checkAsync('a start past the end is 416, saying the size', async () => {
    const response = await serve('sub/clip.mp4', { range: 'bytes=1000-' });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */1000');
    assert.equal((await body(response)).length, 0);
  });
  checkAsync('two ranges, or a malformed one, get the whole file', async () => {
    for (const range of ['bytes=0-1,5-6', 'bytes=9-2', 'bytes=x-y', 'pages=1-2']) {
      const response = await serve('sub/clip.mp4', { range });
      assert.equal(response.status, 200, range);
      assert.equal(response.headers.get('content-range'), null, range);
      assert.deepEqual(await body(response), bytes, range);
    }
  });
  checkAsync('HEAD has the headers and no body', async () => {
    const whole = await serve('sub/clip.mp4', { method: 'HEAD' });
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-length'), '1000');
    assert.equal(whole.headers.get('content-type'), 'video/mp4');
    assert.equal(whole.body, null);
    const part = await serve('sub/clip.mp4', { method: 'HEAD', range: 'bytes=10-19' });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-length'), '10');
    assert.equal(part.body, null);
  });
  checkAsync('a wrong token, a blocked or non-media kind, another method or a folder is refused (403)', async () => {
    assert.equal((await serve('sub/clip.mp4', { token: windows.get(2).token })).status, 403);
    assert.equal((await serve('sub/clip.mp4', { token: 'f'.repeat(64) })).status, 403);
    for (const rel of ['tool.exe', 'run.bat', 'note.md', 'b.json']) assert.equal((await serve(rel)).status, 403, rel);
    assert.equal((await serve('sub/clip.mp4', { method: 'POST' })).status, 403);
    assert.equal((await serve('folder.png')).status, 403);
  });
  checkAsync('a missing file is 404', async () => {
    assert.equal((await serve('missing.png')).status, 404);
  });
  for (const [what, fn] of asyncChecks) {
    try { await fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
    checks += 1;
  }

  console.log(`file-kinds: ${checks} checks passed`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
