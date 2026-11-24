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
  const { resolveInside, realpathInside, hasGitSegment, hasUnsafeSegment } = await import(pathToFileURL(tmp));
  for (const pathApi of [path.win32, path.posix]) {
    const repo = pathApi === path.win32 ? 'C:\\work\\notes' : '/work/notes';
    for (const relative of ['a/note.md', '..hidden/note.md']) {
      assert.equal(resolveInside(repo, relative, pathApi), pathApi.resolve(repo, relative));
    }
    for (const relative of ['../x.md', '../notes-secret/x.md', '..', 'a/../../x', 'a/../b.md', '/etc/passwd', 'a\0b', '', '.', 'a/..', null, 42,
      '\\rooted.md', ...(pathApi === path.win32 ? ['C:\\other\\x.md', 'C:note.md', '\\\\server\\share\\x'] : [])]) {
      assert.equal(resolveInside(repo, relative, pathApi), null);
    }
    // Windows-only names: aliases, streams and devices. Legal on macOS and Linux.
    const windowsOnly = ['CON', 'NUL', 'COM1', 'aux.txt', 'aux.md', 'sub/LPT9.md', 'COM¹', 'file.md:stream', 'Meeting 10:30.md',
      'file.md.', 'notes.', 'dir /note.md', 'dir./note.md'];
    for (const relative of windowsOnly) {
      if (pathApi === path.win32) assert.equal(resolveInside(repo, relative, pathApi), null, relative);
      else assert.equal(resolveInside(repo, relative, pathApi), pathApi.resolve(repo, relative), relative);
    }
    // Drive and UNC paths are absolute only under Windows path semantics.
    const absolutePaths = pathApi === path.win32
      ? ['C:\\other\\x.md', '\\\\server\\share\\x', 'D:\\other\\x.md', 'D:other\\x.md']
      : ['/other/x.md', '//server/share/x'];
    for (const absolute of absolutePaths) assert.equal(resolveInside(repo, absolute, pathApi), null);
    // Never a repository's internals: writing .git/hooks or .git/config is code
    // execution the next time git runs there. Any case, either slash, any depth.
    for (const relative of [
      '.git', '.git/x', '.git/hooks/pre-commit', '.git/config', 'a/../.git/x', '.GIT\\config', '.Git/config',
      'sub/.git/x', 'sub\\.git\\x', './.git/x', '.git/../note.md', '.git./config', '.git /config', '.git::$INDEX_ALLOCATION/config',
    ]) {
      assert.equal(resolveInside(repo, relative, pathApi), null, `${pathApi === path.win32 ? 'win32' : 'posix'}: ${relative}`);
    }
    for (const relative of ['.gitignore', '.github/workflows/ci.yml', 'notes/.gitkeep', 'git/x.md', 'a.git/x.md']) {
      assert.equal(resolveInside(repo, relative, pathApi), pathApi.resolve(repo, relative), relative);
    }
  }
  // POSIX: only traversal is unsafe; these are legal user file names.
  for (const legal of ['Meeting 10:30.md', 'aux.md', 'notes.']) {
    assert.equal(hasUnsafeSegment(legal, false), false, legal);
    assert.equal(resolveInside('/work/notes', legal, path.posix), path.posix.resolve('/work/notes', legal), legal);
  }
  assert.equal(hasUnsafeSegment('../x', false), true);
  assert.equal(resolveInside('/work/notes', '../x', path.posix), null);
  for (const illegal of ['Meeting 10:30.md', 'aux.md', 'notes.', '../x']) assert.equal(hasUnsafeSegment(illegal, true), true, illegal);
  assert.equal(hasGitSegment('docs/.git/x'), true);
  assert.equal(hasGitSegment('docs/.gitignore'), false);

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
  // A link inside the workspace that points at its .git does not spell `.git`,
  // so the real path is checked too.
  fs.mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  let gitLinked = false;
  try {
    fs.symlinkSync(path.join(repo, '.git'), path.join(repo, 'gitlink'), process.platform === 'win32' ? 'junction' : 'dir');
    gitLinked = true;
  } catch (error) {
    console.log(`repo-path: .git link check skipped (${error.code})`);
  }
  if (gitLinked) {
    assert.equal(realpathInside(repo, path.join(repo, 'gitlink', 'config')), false);
    assert.equal(realpathInside(repo, path.join(repo, 'gitlink', 'hooks', 'pre-commit')), false);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('repo-path: all checks passed');
