// Runnable checks for the pure .db v1/v2 persistence model.
// Run: node tools/db.test.mjs
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'tools', '.db.tmp.mjs');

await build({
  stdin: { contents: `export * from './src/renderer/lib/db';`, resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
});

let m;
try {
  m = await import(pathToFileURL(outfile));
} finally {
  rmSync(outfile, { force: true });
}

const v1 = {
  futureV1Field: { preserved: true },
  schema: {
    order: ['title'],
    properties: { title: { name: 'Title', type: 'text' } },
  },
  view: { mode: 'table' },
  rows: [{ id: 'r1', values: { title: 'First' } }],
};

// v1 detection, file-derived table name, and a structural no-migration round-trip.
{
  const parsed = m.parseDb(JSON.stringify(v1), 'notes/Planner.db');
  assert.equal(parsed.error, null);
  assert.equal(parsed.db.format, 1);
  assert.deepEqual(Object.keys(parsed.db.tables), ['planner']);
  assert.equal(parsed.db.tables.planner.name, 'Planner');
  assert.deepEqual(JSON.parse(m.serializeDb(parsed.db)), v1, 'opening and saving v1 must not inject v2 fields');
  const table = parsed.db.tables.planner;
  const edited = m.updateDbTable(parsed.db, 'planner', {
    ...table,
    rows: [{ ...table.rows[0], values: { ...table.rows[0].values, title: 'Edited' } }],
  });
  const out = JSON.parse(m.serializeDb(edited));
  assert.equal(out.version, undefined);
  assert.equal(out.tables, undefined);
  assert.equal(out.rows[0].values.title, 'Edited');
  assert.deepEqual(out.futureV1Field, v1.futureV1Field);
}

const v2 = {
  version: 2,
  tables: {
    tasks: {
      name: 'Tasks',
      schema: { order: ['project'], properties: { project: { name: 'Project', type: 'text' } } },
      rows: [{ id: 't1', values: { project: 'p1' } }],
    },
    projects: {
      name: 'Projects',
      schema: { order: ['name'], properties: { name: { name: 'Name', type: 'text' } } },
      rows: [{ id: 'p1', values: { name: 'Neuron' } }],
    },
  },
  relations: [{ from: { table: 'tasks', property: 'project' }, to: { table: 'projects' } }],
};

// v2 parse and relation parse.
{
  const parsed = m.parseDb(JSON.stringify(v2), 'Planner.db');
  assert.equal(parsed.error, null);
  assert.equal(parsed.db.format, 2);
  assert.deepEqual(Object.keys(parsed.db.tables), ['tasks', 'projects']);
  assert.equal(m.drawableRelations(parsed.db).length, 1);
}

// Adding a second table is the one migration trigger; the original table is exact.
{
  const original = m.parseDb(JSON.stringify(v1), 'Legacy.db').db;
  const originalTable = original.tables.legacy;
  const added = m.addDbTable(original, 'Projects');
  const out = JSON.parse(m.serializeDb(added.db));
  assert.equal(out.version, 2);
  assert.deepEqual(Object.keys(out.tables), ['legacy', 'projects']);
  assert.equal(out.tables.legacy.name, 'Legacy');
  assert.deepEqual(out.tables.legacy.schema, v1.schema);
  assert.deepEqual(out.tables.legacy.rows, v1.rows);
  assert.deepEqual(out.tables.legacy.futureV1Field, v1.futureV1Field, 'unknown v1 top-level key follows the original table');
  assert.deepEqual(originalTable.schema.order, v1.schema.order, 'upgrade must not mutate the parsed v1 table');
}

// Unknown top-level and per-table keys survive an ordinary row edit.
{
  const future = {
    ...v2,
    generator: { name: 'Future Neuron', version: 9 },
    tables: {
      ...v2.tables,
      tasks: {
        ...v2.tables.tasks,
        futureTableField: { layout: 'timeline' },
        schema: { ...v2.tables.tasks.schema, futureSchemaField: true },
      },
    },
  };
  const parsed = m.parseDb(JSON.stringify(future), 'Planner.db').db;
  const tasks = parsed.tables.tasks;
  const edited = m.updateDbTable(parsed, 'tasks', {
    ...tasks,
    rows: tasks.rows.map((row) => row.id === 't1' ? { ...row, values: { ...row.values, project: 'p2' } } : row),
  });
  const out = JSON.parse(m.serializeDb(edited));
  assert.deepEqual(out.generator, future.generator, 'unknown v2 top-level key survives');
  assert.deepEqual(out.tables.tasks.futureTableField, future.tables.tasks.futureTableField, 'unknown table key survives');
  assert.equal(out.tables.tasks.schema.futureSchemaField, true, 'unknown schema key survives');
  assert.equal(out.tables.tasks.rows[0].values.project, 'p2');
}

// Fatal input stays fatal. A caller that writes only parsed documents writes zero times.
for (const bad of ['{not json', JSON.stringify({ version: 2, tables: { tasks: { rows: [] } } })]) {
  let writes = 0;
  const parsed = m.parseDb(bad, 'Broken.db');
  if (parsed.db) writes++;
  assert.equal(parsed.db, null);
  assert.ok(parsed.error);
  assert.equal(writes, 0, 'malformed input must not produce a writable repaired guess');
}

// Descriptive relations may dangle; parsing and serialization do not enforce them.
{
  const dangling = {
    version: 2,
    tables: { tasks: v2.tables.tasks },
    relations: [{ from: { table: 'tasks', property: 'project' }, to: { table: 'missing' }, future: true }],
  };
  const parsed = m.parseDb(JSON.stringify(dangling), 'Planner.db');
  assert.equal(parsed.error, null);
  assert.equal(m.drawableRelations(parsed.db).length, 1);
  assert.deepEqual(JSON.parse(m.serializeDb(parsed.db)).relations, dangling.relations);
}

console.log('db: all checks passed');
