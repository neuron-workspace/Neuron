import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cpus, platform, release } from 'node:os';
import assert from 'node:assert/strict';
import { generateWorkspace } from './scale-fixture.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(root, 'tools/.scale-benchmark-'));
const require = createRequire(import.meta.url);
const { transform } = require('esbuild');
const compiled = new Map();
// Preserve local dependencies while using transform, as in navigation.test.mjs.
async function load(relative) {
  const source = resolve(root, relative);
  if (compiled.has(source)) return compiled.get(source);
  const output = join(temp, 'module-' + compiled.size + '.cjs');
  compiled.set(source, output);
  let { code } = await transform(readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' });
  for (const match of [...code.matchAll(/require\("(\.[^"]+)"\)/g)]) {
    const dependency = await load(resolve(dirname(source), match[1] + '.ts'));
    code = code.replaceAll(match[0], 'require(' + JSON.stringify(dependency) + ')');
  }
  writeFileSync(output, code);
  return output;
}
function measure(fn) {
  fn(); // Untimed warmup; fresh graph construction still happens every run.
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return samples.sort((a, b) => a - b)[2].toFixed(2);
}
try {
  const { searchNotes } = require(await load('src/renderer/lib/search.ts'));
  const { KnowledgeGraph } = require(await load('src/renderer/lib/knowledge-graph.ts'));
  const { parseFrontmatter } = require(await load('src/renderer/lib/frontmatter/parse.ts'));
  const { parseDb } = require(await load('src/renderer/lib/db.ts'));
  const { parseCanvas } = require(await load('src/renderer/canvas/model.ts'));
  const queries = ['Note-00042', 'architecture', 'review evidence', '#tag-7', 'zzzz-no-match'];
  console.log('Node ' + process.version + '; ' + platform() + ' ' + release() + '; ' + cpus()[0].model);
  console.log('Median of five runs after one warmup; milliseconds. File generation, reads and transpilation excluded. Graph = fresh sync, no layout. Search uses default 200-hit limit.');
  console.log('| Notes | DB rows | Mean note bytes | ' + queries.map(q => 'Search: ' + q).join(' | ') + ' | Graph build | Frontmatter (all) | parseDb |');
  console.log('|' + Array(11).fill('---').join('|') + '|');
  for (const [count, dbRows] of [[1000, 500], [5000, 2000], [10000, 10000]]) {
    const directory = join(temp, 'workspace-' + count);
    const data = generateWorkspace(directory, { notes: count, dbRows });
    const notes = data.notes.map(n => ({ path: n.path, content: readFileSync(join(directory, n.path), 'utf8') }));
    const dbText = readFileSync(join(directory, 'Scale.db'), 'utf8');
    assert.equal(notes.length, count);
    assert.equal(parseDb(dbText, 'Scale.db').db?.tables.tasks.rows.length, dbRows);
    assert.equal(parseCanvas(data.canvasText).doc?.nodes.length, data.config.canvasNodes);
    assert.ok(notes.every(n => parseFrontmatter(n.content).valid));
    assert.equal(searchNotes(notes, queries[4]).length, 0);
    assert.ok(searchNotes(notes, queries[0]).some(n => n.path.endsWith('Note-00042.md')));
    const graph = new KnowledgeGraph(); graph.sync(notes);
    assert.equal(graph.graph.order, count, 'All generated links must resolve');
    assert.ok(graph.graph.size > count);
    const meanBytes = Math.round(notes.reduce((n, note) => n + Buffer.byteLength(note.content), 0) / count);
    const timings = queries.map(query => measure(() => searchNotes(notes, query)));
    timings.push(measure(() => { const model = new KnowledgeGraph(); model.sync(notes); }));
    timings.push(measure(() => { for (const note of notes) parseFrontmatter(note.content); }));
    timings.push(measure(() => parseDb(dbText, 'Scale.db')));
    console.log('| ' + [count, dbRows, meanBytes, ...timings].join(' | ') + ' |');
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
