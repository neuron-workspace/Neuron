// The workspace explorer's data model.
//
// The explorer is a projection of the note paths the renderer already holds --
// no second filesystem read, no second watcher. These cases are the behaviour
// that projection has to have: a folder listing that does not reorder itself,
// and a Recent list that survives files being moved or deleted underneath it.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-explorer-'));
// esbuild names the output after the entry's basename.
const file = join(out, 'workspace-explorer.js');
await build({
  entryPoints: ['src/renderer/lib/workspace-explorer.ts'],
  outdir: out,
  format: 'esm',
  bundle: true,
});
const {
  listFolder, parentFolder, breadcrumbs, addRecent, pruneRecents, resolveRecents, recentsKey,
} = await import('file://' + file.replace(/\\/g, '/'));

const PATHS = [
  'README.md',
  'daily/2026-08-01.md',
  'daily/2026-08-02.md',
  'projects/website/plan.md',
  'projects/website/assets/logo.png',
  'projects/api.md',
  'Archive/old.md',
];

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

// --- listing ------------------------------------------------------------------
check('the root lists top-level folders and files, folders first', () => {
  const { folders, files } = listFolder(PATHS, '');
  assert.deepEqual(folders.map((f) => f.name), ['Archive', 'daily', 'projects']);
  assert.deepEqual(files.map((f) => f.name), ['README.md']);
});

check('sorting is case-insensitive, so Archive is not exiled to the top', () => {
  // A plain sort() puts every capitalised name before every lowercase one,
  // which reads as though the list is grouped by something invisible.
  const { folders } = listFolder(PATHS, '');
  assert.deepEqual(folders.map((f) => f.name), ['Archive', 'daily', 'projects']);
});

check('entering a folder shows only its own children', () => {
  const { folders, files } = listFolder(PATHS, 'projects');
  assert.deepEqual(folders.map((f) => f.name), ['website']);
  assert.deepEqual(files.map((f) => f.name), ['api.md'],
    'nested files belong to the nested folder, not to this one');
});

check('a folder counts everything beneath it, not just direct children', () => {
  const { folders } = listFolder(PATHS, '');
  const projects = folders.find((f) => f.name === 'projects');
  assert.equal(projects.count, 3, 'plan.md, logo.png and api.md');
});

check('a file carries its extension, lowercased', () => {
  const { files } = listFolder(PATHS, 'projects/website/assets');
  assert.deepEqual(files, [{ path: 'projects/website/assets/logo.png', name: 'logo.png', extension: 'png' }]);
});

check('a dotfile is not treated as an extension', () => {
  const { files } = listFolder(['.gitignore'], '');
  assert.equal(files[0].extension, '', 'the leading dot does not make "gitignore" a type');
});

check('an empty folder lists nothing rather than throwing', () => {
  assert.deepEqual(listFolder(PATHS, 'projects/website/nothing-here'), { folders: [], files: [] });
});

check('an empty workspace lists nothing', () => {
  assert.deepEqual(listFolder([], ''), { folders: [], files: [] });
});

check('a folder whose name prefixes another is not confused with it', () => {
  // "day" must not swallow "daily": the boundary is the separator, not the
  // string prefix.
  const paths = ['day/a.md', 'daily/b.md'];
  const { files } = listFolder(paths, 'day');
  assert.deepEqual(files.map((f) => f.name), ['a.md']);
});

// --- navigation ----------------------------------------------------------------
check('the parent of a nested path is its folder', () => {
  assert.equal(parentFolder('projects/website/plan.md'), 'projects/website');
  assert.equal(parentFolder('projects'), '');
});

check('the root has no parent to go up to', () => {
  assert.equal(parentFolder('README.md'), '', 'root-level files parent to the root');
  assert.equal(parentFolder(''), '');
});

check('breadcrumbs trace the path back to the root', () => {
  assert.deepEqual(breadcrumbs('projects/website/assets'), [
    { path: 'projects', name: 'projects' },
    { path: 'projects/website', name: 'website' },
    { path: 'projects/website/assets', name: 'assets' },
  ]);
  assert.deepEqual(breadcrumbs(''), [], 'the root itself is not a crumb');
});

// --- recents --------------------------------------------------------------------
check('a visit goes to the front', () => {
  const one = addRecent([], { path: 'a.md', kind: 'file' }, 1);
  const two = addRecent(one, { path: 'b.md', kind: 'file' }, 2);
  assert.deepEqual(two.map((r) => r.path), ['b.md', 'a.md']);
});

check('re-visiting moves rather than duplicates', () => {
  let recents = addRecent([], { path: 'a.md', kind: 'file' }, 1);
  recents = addRecent(recents, { path: 'b.md', kind: 'file' }, 2);
  recents = addRecent(recents, { path: 'a.md', kind: 'file' }, 3);
  assert.deepEqual(recents.map((r) => r.path), ['a.md', 'b.md']);
  assert.equal(recents.length, 2, 'no duplicate entry for a.md');
});

check('the list is capped', () => {
  let recents = [];
  for (let i = 0; i < 40; i += 1) recents = addRecent(recents, { path: `n${i}.md`, kind: 'file' }, i, 5);
  assert.equal(recents.length, 5);
  assert.equal(recents[0].path, 'n39.md', 'the newest survives');
});

check('files and folders both live in the list', () => {
  const recents = addRecent(addRecent([], { path: 'daily', kind: 'folder' }, 1), { path: 'a.md', kind: 'file' }, 2);
  assert.deepEqual(recents.map((r) => r.kind), ['file', 'folder']);
});

check('a deleted file leaves the list', () => {
  const recents = [
    { path: 'daily/2026-08-01.md', kind: 'file', at: 2 },
    { path: 'gone.md', kind: 'file', at: 1 },
  ];
  assert.deepEqual(pruneRecents(recents, PATHS).map((r) => r.path), ['daily/2026-08-01.md']);
});

check('a folder survives while anything is still beneath it', () => {
  const recents = [{ path: 'projects', kind: 'folder', at: 1 }];
  assert.equal(pruneRecents(recents, PATHS).length, 1);
});

check('an emptied folder leaves the list', () => {
  // Folders are implied by their contents, so emptying one and deleting one are
  // the same thing as far as this list can tell.
  const recents = [{ path: 'projects', kind: 'folder', at: 1 }];
  assert.deepEqual(pruneRecents(recents, ['README.md']), []);
});

check('a folder is not kept alive by a file that merely shares its prefix', () => {
  const recents = [{ path: 'day', kind: 'folder', at: 1 }];
  assert.deepEqual(pruneRecents(recents, ['daily/b.md']), [],
    'daily/b.md is not inside day/');
});

// --- stored state -----------------------------------------------------------------
check('malformed stored recents are ignored, not fatal', () => {
  assert.deepEqual(resolveRecents(null), []);
  assert.deepEqual(resolveRecents('nonsense'), []);
  assert.deepEqual(resolveRecents([null, 42, {}, { path: '' }, { path: 'a.md' }]), [],
    'entries without a usable kind are dropped');
});

check('stored recents come back newest first and deduplicated', () => {
  const stored = [
    { path: 'a.md', kind: 'file', at: 1 },
    { path: 'b.md', kind: 'file', at: 9 },
    { path: 'a.md', kind: 'file', at: 5 },
  ];
  assert.deepEqual(resolveRecents(stored).map((r) => r.path), ['b.md', 'a.md']);
});

check('recents are keyed per workspace', () => {
  assert.notEqual(recentsKey('C:/one'), recentsKey('C:/two'),
    'two workspaces must not share a Recent list');
});

rmSync(out, { recursive: true, force: true });
console.log(`\nworkspace explorer: ${checks} checks passed`);
