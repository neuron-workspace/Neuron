// Runnable check for src/main/workspace-walk.ts: transpile with esbuild, then
// walk real temporary folders.
// Run: node tools/workspace-walk.test.mjs
import { transform } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'src/main/workspace-walk.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const temp = fs.mkdtempSync(path.join(tmpdir(), 'neuron-walk-'));
let checks = 0;
const check = (what, fn) => {
  try { fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
  console.log(`  ok  ${what}`);
};
const sorted = (list) => [...list].sort();
const write = (dir, rel, body = 'x') => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};

try {
  const modulePath = path.join(temp, 'workspace-walk.mjs');
  fs.writeFileSync(modulePath, code);
  const { walkWorkspace, ENTRY_LIMIT } = await import(pathToFileURL(modulePath));

  const ws = path.join(temp, 'ws');
  write(ws, 'a.txt', 'hello');
  write(ws, 'pics/photo.png');
  write(ws, 'docs/deep/report.pdf');
  write(ws, 'note.md');
  write(ws, 'note.md.123.456.abcdef.tmp');
  write(ws, '.neuron/config.json.123.456.abcdef.tmp');
  write(ws, '.git/config');
  write(ws, '.neuron/layout.json');
  write(ws, 'docs/.hidden/secret.txt');
  write(ws, 'docs/.neuron/not-root.json');
  fs.mkdirSync(path.join(ws, 'empty'));

  check('lists every file and folder, empty folders included, with / separators', () => {
    const result = walkWorkspace(ws);
    assert.deepEqual(sorted(result.files), ['.neuron/layout.json', 'a.txt', 'docs/deep/report.pdf', 'note.md', 'pics/photo.png']);
    assert.deepEqual(sorted(result.folders), ['.neuron', 'docs', 'docs/deep', 'empty', 'pics']);
    assert.equal(result.skipped, 0);
    assert.equal(result.truncated, false);
    assert.ok(result.files.every((file) => !file.includes('\\')));
  });

  check('a folder\'s contents come right after it, as the recursive walk listed them', () => {
    const { files } = walkWorkspace(ws);
    assert.ok(files.indexOf('docs/deep/report.pdf') < files.indexOf('note.md'));
  });

  check('skips dot entries except the root .neuron', () => {
    const { files, folders } = walkWorkspace(ws);
    assert.ok(!folders.includes('.git'));
    assert.ok(!folders.includes('docs/.neuron'));
    assert.ok(!files.some((file) => file.includes('secret')));
  });

  check('Neuron\'s save temp files are skipped at any depth, other .tmp names too', () => {
    write(ws, 'docs/deep/draft.md.4242.1700000000000.0a1b2c.tmp');
    write(ws, 'pics/x.tmp');
    const { files } = walkWorkspace(ws);
    assert.ok(!files.some((file) => file.endsWith('.tmp')), files.join(', '));
    assert.ok(files.includes('docs/deep/report.pdf'));
  });

  check('dot-folders other than the root .neuron are skipped with everything in them', () => {
    write(ws, '.obsidian/workspace.json');
    write(ws, 'docs/.git/HEAD');
    const { files, folders } = walkWorkspace(ws);
    assert.ok(!folders.some((folder) => folder.split('/').some((part) => part.startsWith('.') && part !== '.neuron')), folders.join(', '));
    assert.ok(!files.some((file) => file.includes('.obsidian') || file.includes('.git/')));
    assert.ok(folders.includes('.neuron'));
  });

  check('reports size and modified time per file', () => {
    const { info } = walkWorkspace(ws);
    assert.equal(info['a.txt'].size, 5);
    assert.ok(info['a.txt'].modified > 0);
  });

  check('an entry that cannot be read is skipped and counted, and the walk goes on', () => {
    const bad = path.join(ws, 'pics');
    const io = {
      readdirSync: (dir) => fs.readdirSync(dir),
      lstatSync: (target) => { if (target === bad) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return fs.lstatSync(target); },
      statSync: (target) => fs.statSync(target),
      realpathSync: (target) => fs.realpathSync.native(target),
    };
    const result = walkWorkspace(ws, { fs: io });
    assert.equal(result.skipped, 1);
    assert.ok(!result.folders.includes('pics'));
    assert.ok(result.files.includes('a.txt'));
    assert.ok(result.files.includes('docs/deep/report.pdf'));
  });

  check('a folder that cannot be listed is still shown and counted', () => {
    const bad = path.join(ws, 'docs');
    const io = {
      readdirSync: (dir) => { if (dir === bad) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return fs.readdirSync(dir); },
      lstatSync: (target) => fs.lstatSync(target),
      statSync: (target) => fs.statSync(target),
      realpathSync: (target) => fs.realpathSync.native(target),
    };
    const result = walkWorkspace(ws, { fs: io });
    assert.equal(result.skipped, 1);
    assert.ok(result.folders.includes('docs'));
    assert.ok(!result.files.includes('docs/deep/report.pdf'));
  });

  check('an unreadable root gives empty lists, not an exception', () => {
    const result = walkWorkspace(path.join(temp, 'missing'));
    assert.deepEqual(result.files, []);
    assert.equal(result.skipped, 1);
  });

  // Links. A junction needs no privilege on Windows; a file symlink may.
  const linked = path.join(temp, 'linked');
  const outside = path.join(temp, 'outside');
  write(outside, 'outside.txt');
  write(linked, 'inside.txt');
  let dirLink = true;
  try {
    fs.symlinkSync(outside, path.join(linked, 'to-outside'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(linked, path.join(linked, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    dirLink = false;
    console.log('  skip folder links: not permitted here');
  }
  if (dirLink) {
    check('a link to a folder is not followed, so a loop or the outside never appears', () => {
      const result = walkWorkspace(linked);
      assert.deepEqual(result.files, ['inside.txt']);
      assert.deepEqual(result.folders, []);
      assert.equal(result.skipped, 0);
    });
    check('a loop deep inside the workspace ends the walk, outside paths never listed', () => {
      const deep = path.join(temp, 'deep-loop');
      write(deep, 'a/b/c.md');
      fs.symlinkSync(deep, path.join(deep, 'a', 'b', 'up'), process.platform === 'win32' ? 'junction' : 'dir');
      fs.symlinkSync(outside, path.join(deep, 'a', 'away'), process.platform === 'win32' ? 'junction' : 'dir');
      const result = walkWorkspace(deep);
      assert.deepEqual(result.files, ['a/b/c.md']);
      assert.deepEqual(result.folders, ['a', 'a/b']);
      assert.equal(result.truncated, false);
    });
  }
  let fileLink = true;
  try {
    fs.symlinkSync(path.join(linked, 'inside.txt'), path.join(linked, 'alias.txt'), 'file');
    fs.symlinkSync(path.join(outside, 'outside.txt'), path.join(linked, 'escape.txt'), 'file');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    fileLink = false;
    console.log('  skip file links: not permitted here');
  }
  if (fileLink) {
    check('a link to a file is listed only when the file is inside the workspace', () => {
      const { files } = walkWorkspace(linked);
      assert.ok(files.includes('alias.txt'));
      assert.ok(!files.includes('escape.txt'));
    });
  }

  check('the cap stops the walk and says so', () => {
    const many = path.join(temp, 'many');
    for (let i = 0; i < 12; i++) write(many, `f${i}.txt`);
    const capped = walkWorkspace(many, { limit: 10 });
    assert.equal(capped.files.length, 10);
    assert.equal(capped.truncated, true);
    const exact = walkWorkspace(many, { limit: 12 });
    assert.equal(exact.truncated, false);
    assert.equal(ENTRY_LIMIT, 20_000);
  });

  console.log(`workspace-walk: ${checks} checks passed`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
