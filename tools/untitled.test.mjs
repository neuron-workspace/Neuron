import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/lib/untitled.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { nextUntitled } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

assert.equal(nextUntitled([], ''), 'Untitled.md');
assert.equal(nextUntitled(['Untitled.md'], ''), 'Untitled 1.md');
assert.equal(nextUntitled(['Untitled.md', 'Untitled 2.md'], ''), 'Untitled 1.md');
assert.equal(nextUntitled(['UNTITLED.MD', 'untitled 1.md'], ''), 'Untitled 2.md');
assert.equal(nextUntitled(['notes/daily/Untitled.md', 'Untitled 1.md'], 'notes/daily'), 'notes/daily/Untitled 1.md');
assert.equal(nextUntitled([], '', 'Untitled folder', ''), 'Untitled folder');
assert.equal(nextUntitled(['Untitled folder', 'Untitled folder 2'], '', 'Untitled folder', ''), 'Untitled folder 1');
assert.equal(nextUntitled(['UNTITLED FOLDER/child.md'], '', 'Untitled folder', ''), 'Untitled folder 1');
assert.equal(nextUntitled(['Untitled.md/child.md'], ''), 'Untitled 1.md');
assert.equal(nextUntitled([], '', 'Untitled', '.db'), 'Untitled.db');
assert.equal(nextUntitled(['Untitled.db', 'Untitled.md'], '', 'Untitled', '.db'), 'Untitled 1.db');
assert.equal(nextUntitled(['Untitled.canvas'], '', 'Untitled', '.canvas'), 'Untitled 1.canvas');
assert.equal(nextUntitled(['Untitled.canvas', 'Untitled 1.canvas'], 'maps', 'Untitled', '.canvas'), 'maps/Untitled.canvas');

// The two starting files must open without an error.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'tools', '.untitled.tmp.mjs');
await build({
  stdin: {
    contents: `export * from './src/renderer/lib/new-file'; export { parseDb } from './src/renderer/lib/db'; export { parseCanvas } from './src/renderer/canvas/model';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
});
let m;
try { m = await import(pathToFileURL(outfile)); } finally { rmSync(outfile, { force: true }); }

const database = m.parseDb(m.startingDatabase(), 'Untitled.db');
assert.equal(database.error, null);
assert.deepEqual(Object.keys(database.db.tables), ['table']);
assert.equal(database.db.tables.table.name, 'Table');
assert.deepEqual(database.db.tables.table.schema.order, ['name']);
assert.equal(database.db.tables.table.schema.properties.name.name, 'Name');
assert.equal(database.db.tables.table.rows.length, 0);
const canvas = m.parseCanvas(m.startingCanvas());
assert.equal(canvas.error, null);
assert.deepEqual(canvas.doc.nodes, []);
assert.deepEqual(canvas.doc.edges, []);
assert.equal(m.startingContent('note'), undefined);

console.log('untitled: 22 checks passed');
