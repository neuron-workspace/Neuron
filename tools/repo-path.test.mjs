// Runnable check for src/main/repoPath.ts -- no test framework needed:
// transpile with vite's bundled esbuild, then assert.
// Run: node tools/repo-path.test.mjs
import { transform } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'src/main/repoPath.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const temp = fs.mkdtempSync(path.join(tmpdir(), 'neuron-repo-path-'));
try {
  const tmp = path.join(temp, 'repo-path.mjs');
  fs.writeFileSync(tmp, code);
  const { resolveInside, realpathInside } = await import(pathToFileURL(tmp));
  for (const pathApi of [path.win32, path.posix]) {
    const repo = pathApi === path.win32 ? 'C:\\work\\notes' : '/work/notes';
    for (const relative of ['a/note.md', 'a/../b.md', '..hidden/note.md']) {
      assert.equal(resolveInside(repo, relative, pathApi), pathApi.resolve(repo, relative));
    }
    for (const relative of ['../x.md', '../notes-secret/x.md', '..', 'a/../../x', '/etc/passwd', 'a\0b', '', '.', 'a/..', null, 42]) {
      assert.equal(resolveInside(repo, relative, pathApi), null);
    }
    // Drive and UNC paths are absolute only under Windows path semantics.
    const absolutePaths = pathApi === path.win32
      ? ['C:\\other\\x.md', '\\\\server\\share\\x', 'D:\\other\\x.md', 'D:other\\x.md']
      : ['/other/x.md', '//server/share/x'];
    for (const absolute of absolutePaths) assert.equal(resolveInside(repo, absolute, pathApi), null);
  }

  const repo = path.join(temp, 'notes');
  const subfolder = path.join(repo, 'subfolder');
  const outside = path.join(temp, 'notes-secret');
  fs.mkdirSync(subfolder, { recursive: true });
  fs.mkdirSync(outside);
  assert.equal(realpathInside(repo, subfolder), true);
  assert.equal(realpathInside(repo, path.join(subfolder, 'new.md')), true);
  assert.equal(realpathInside(repo, path.join(repo, 'new-folder', 'new.md')), true);
  assert.equal(realpathInside(repo, outside), false);
  assert.equal(realpathInside(path.join(temp, 'missing'), subfolder), false);
  const link = path.join(repo, 'link');
  let linked = false;
  try {
    // Windows needs no privilege for a directory junction, which is also the
    // link a synced or shared workspace there is most likely to contain.
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
  } catch (error) {
    console.log(`repo-path: symlink checks skipped (${error.code})`);
  }
  if (linked) {
    assert.equal(realpathInside(repo, link), false);
    assert.equal(realpathInside(repo, path.join(link, 'new.md')), false);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('repo-path: all checks passed');
