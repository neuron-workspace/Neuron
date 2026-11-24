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
  const { folderKey, uniqueRecents, startupRecents, keyNames, nameOf, withName, listedWorkspaces } = await import(pathToFileURL(tmp));
  const missing = () => { throw new Error('ENOENT'); };

  const win = (dir) => folderKey(dir, 'win32', missing);
  assert.equal(win('C:\\Notes\\demo-repo'), win('c:/notes/DEMO-REPO/'));
  assert.equal(win('C:\\Notes\\demo-repo\\'), win('C:\\Notes\\demo-repo'));
  assert.equal(win('C:\\Notes\\demo-repo\\\\'), win('C:\\Notes\\demo-repo'), 'several trailing separators');

  // macOS volumes are case-insensitive by default, like Windows.
  const mac = (dir) => folderKey(dir, 'darwin', missing);
  assert.equal(mac('/Users/a/Notes'), mac('/users/a/notes/'));

  const linux = (dir) => folderKey(dir, 'linux', missing);
  assert.notEqual(linux('/home/a/Notes'), linux('/home/a/notes'), 'Linux paths are case-sensitive');
  assert.equal(linux('/home/a/notes/'), linux('/home/a/notes'));

  // A junction or symlink resolves to the folder it points at.
  const viaLink = folderKey('C:\\link', 'win32', () => 'C:\\real\\notes');
  assert.equal(viaLink, win('C:\\real\\notes'));
  // ...and on this machine's real file system, with the real realpath.
  const real = path.join(temp, 'Real Notes');
  const link = path.join(temp, 'link-to-notes');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(folderKey(link), folderKey(real), 'a link is the folder it points at');
  assert.equal(folderKey(link + path.sep), folderKey(real));

  // Startup keeps folders that are not there (an unplugged drive), drops only
  // install-folder workspaces, and collapses spellings (3A).
  const atStartup = startupRecents(
    ['E:\\USB notes', 'C:\\Program Files\\Neuron\\notes', 'c:/notes/demo-repo', 'C:\\Notes\\demo-repo\\', 42, '', null],
    (dir) => dir.startsWith('C:\\Program Files\\Neuron'), win);
  assert.deepEqual(atStartup, ['E:\\USB notes', 'c:/notes/demo-repo'], 'a missing folder stays; nothing checks it exists');
  assert.deepEqual(startupRecents(undefined, () => false, win), []);
  assert.deepEqual(startupRecents('C:\\x', () => false, win), [], 'a damaged settings value is not a list');

  // Names are kept by folder identity; existing ones migrate once (3C).
  // As settings are read: JSON, where "__proto__" is an ordinary own key.
  const saved = JSON.parse('{"C:\\\\Notes\\\\Work":"Old name","D:\\\\Other":"Other","c:/notes/work/":"New name","E:\\\\Blank":"  ","F:\\\\Bad":7,"__proto__":"x"}');
  const migrated = keyNames(saved, win);
  assert.equal(Object.getPrototypeOf(migrated), Object.prototype);
  assert.deepEqual(migrated, { [win('D:\\Other')]: 'Other', [win('C:\\Notes\\Work')]: 'New name' }, 'the name saved later wins');
  assert.deepEqual(keyNames(migrated, win), migrated, 'migrating again changes nothing');
  assert.deepEqual(keyNames(null, win), {});
  assert.deepEqual(keyNames(['C:\\x'], win), {});
  assert.equal(nameOf(migrated, 'C:\\NOTES\\WORK\\', win), 'New name', 'any spelling finds the name');
  assert.equal(nameOf(migrated, 'C:\\Notes\\Elsewhere', win), undefined);
  assert.equal(nameOf({}, 'constructor', win), undefined, 'inherited properties are not names');
  assert.equal(nameOf(undefined, 'C:\\x', win), undefined);
  // On Linux two spellings that differ in case are two folders, each with its own name.
  assert.equal(nameOf(keyNames({ '/home/a/Notes': 'Upper' }, linux), '/home/a/notes', linux), undefined);

  // A rename replaces every spelling of the folder; an empty name clears it.
  const legacy = { 'C:\\Notes\\Work': 'Old', 'c:/notes/work/': 'Older', 'D:\\Other': 'Other' };
  const renamed = withName(legacy, 'C:\\NOTES\\Work', '  Field notes  ', win);
  assert.deepEqual(renamed, { 'D:\\Other': 'Other', [win('C:\\Notes\\Work')]: 'Field notes' });
  assert.equal(nameOf(renamed, 'c:\\notes\\work\\', win), 'Field notes', 'a rename survives a different spelling');
  assert.deepEqual(withName(renamed, 'c:/notes/work', '   ', win), { 'D:\\Other': 'Other' });
  assert.deepEqual(withName(undefined, 'C:\\x', 'X', win), { [win('C:\\x')]: 'X' });

  // Each window's list (3C): a workspace window leaves out what it shows;
  // Settings lists every folder once and marks its opener in any spelling.
  const known = ['C:\\Notes\\Work', 'D:\\Other', 'c:/notes/work/'];
  assert.deepEqual(listedWorkspaces(known, 'C:\\NOTES\\WORK', null, win), [{ dir: 'D:\\Other', isOpener: false }]);
  assert.deepEqual(listedWorkspaces(known, null, 'c:\\notes\\WORK\\', win),
    [{ dir: 'C:\\Notes\\Work', isOpener: true }, { dir: 'D:\\Other', isOpener: false }], 'one row, marked, for two spellings');
  assert.deepEqual(listedWorkspaces(known, null, 'E:\\New', win),
    [{ dir: 'E:\\New', isOpener: true }, { dir: 'C:\\Notes\\Work', isOpener: false }, { dir: 'D:\\Other', isOpener: false }],
    'an opener not in Recent yet comes first');
  assert.deepEqual(listedWorkspaces(known, null, null, win).map((entry) => entry.isOpener), [false, false]);

  const recent = ['C:\\Notes\\demo-repo', 'c:/notes/demo-repo/', 'D:\\work', 'C:\\Notes\\other', 'd:\\WORK\\'];
  assert.deepEqual(uniqueRecents(recent, null, win), ['C:\\Notes\\demo-repo', 'D:\\work', 'C:\\Notes\\other']);
  assert.deepEqual(uniqueRecents(recent, 'C:\\NOTES\\DEMO-REPO', win), ['D:\\work', 'C:\\Notes\\other'],
    'the open workspace is never listed again under Recent');
  assert.deepEqual(uniqueRecents([], 'C:\\x', win), []);

  console.log('recent-repos: all checks passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
