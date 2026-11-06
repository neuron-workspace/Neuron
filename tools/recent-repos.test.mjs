// Runnable check for src/main/recentRepos.ts: the workspace switcher lists
// each folder once and never repeats the open one under "Recent".
// Run: node tools/recent-repos.test.mjs
import { transform } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'src/main/recentRepos.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const temp = fs.mkdtempSync(path.join(tmpdir(), 'neuron-recent-repos-'));
try {
  const tmp = path.join(temp, 'recent-repos.mjs');
  fs.writeFileSync(tmp, code);
  const { folderKey, uniqueRecents } = await import(pathToFileURL(tmp));
  const missing = () => { throw new Error('ENOENT'); };

  const win = (dir) => folderKey(dir, 'win32', missing);
  assert.equal(win('C:\\Notes\\demo-repo'), win('c:/notes/DEMO-REPO/'));
  assert.equal(win('C:\\Notes\\demo-repo\\'), win('C:\\Notes\\demo-repo'));

  const linux = (dir) => folderKey(dir, 'linux', missing);
  assert.notEqual(linux('/home/a/Notes'), linux('/home/a/notes'), 'Linux paths are case-sensitive');
  assert.equal(linux('/home/a/notes/'), linux('/home/a/notes'));

  // A junction or symlink resolves to the folder it points at.
  const viaLink = folderKey('C:\\link', 'win32', () => 'C:\\real\\notes');
  assert.equal(viaLink, win('C:\\real\\notes'));

  const recent = ['C:\\Notes\\demo-repo', 'c:/notes/demo-repo/', 'D:\\work', 'C:\\Notes\\other', 'd:\\WORK\\'];
  assert.deepEqual(uniqueRecents(recent, null, win), ['C:\\Notes\\demo-repo', 'D:\\work', 'C:\\Notes\\other']);
  assert.deepEqual(uniqueRecents(recent, 'C:\\NOTES\\DEMO-REPO', win), ['D:\\work', 'C:\\Notes\\other'],
    'the open workspace is never listed again under Recent');
  assert.deepEqual(uniqueRecents([], 'C:\\x', win), []);

  console.log('recent-repos: all checks passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
