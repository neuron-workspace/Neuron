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

// --- Board and gallery views -------------------------------------------------

const viewFile = (view, rows) => ({
  version: 2,
  tables: {
    tasks: {
      name: 'Tasks',
      schema: {
        order: ['title', 'status', 'priority', 'due', 'owner', 'notes', 'done'],
        properties: {
          title: { name: 'Task', type: 'text' },
          status: { name: 'Status', type: 'select', options: [
            { id: 'todo', name: 'Todo', color: '#8b8b8b' },
            { id: 'doing', name: 'In progress', color: '#528fd1' },
            { id: 'done', name: 'Done', color: '#5aa06c' },
          ] },
          priority: { name: 'Priority', type: 'select', options: [{ id: 'high', name: 'High', color: '#c0705f' }] },
          due: { name: 'Due', type: 'date' },
          owner: { name: 'Owner', type: 'text' },
          notes: { name: 'Notes', type: 'text' },
          done: { name: 'Done', type: 'checkbox' },
        },
      },
      ...(view ? { view } : {}),
      rows: rows ?? [
        { id: 'a', values: { title: 'Alpha', status: 'todo', due: '2026-09-03', owner: 'Ann', notes: 'A long enough note that it should count as preview text.' } },
        { id: 'b', values: { title: 'Bravo', status: 'doing', due: '2026-09-01', owner: 'Bob', notes: '' } },
        { id: 'c', values: { title: 'Charlie', status: 'todo', due: '2026-09-02', owner: 'Cy' } },
        { id: 'd', values: { title: 'Delta', status: '', owner: 'Di' } },
        { id: 'e', values: { title: 'Echo', status: 'gone', owner: 'Ed' } },
      ],
    },
  },
});
const tableOf = (view, rows) => m.parseDb(JSON.stringify(viewFile(view, rows)), 'Views.db').db.tables.tasks;
const ids = (rows) => rows.map((r) => r.id);

// visibleRows: filter then sort, from the saved view only.
{
  assert.deepEqual(ids(m.visibleRows(tableOf())), ['a', 'b', 'c', 'd', 'e'], 'no view keeps file order');
  assert.deepEqual(ids(m.visibleRows(tableOf({ filterProp: 'status', filterValue: 'todo' }))), ['a', 'c']);
  assert.deepEqual(ids(m.visibleRows(tableOf({ filterProp: 'owner', filterValue: 'B' }))), ['b'], 'text filter ignores case');
  assert.deepEqual(ids(m.visibleRows(tableOf({ sortBy: 'due' }))), ['d', 'e', 'b', 'c', 'a'], 'empty dates sort first ascending');
  assert.deepEqual(ids(m.visibleRows(tableOf({ sortBy: 'title', sortDir: 'desc' }))), ['e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(ids(m.visibleRows(tableOf({ sortBy: 'missing', filterProp: 'missing', filterValue: 'x' }))), ['a', 'b', 'c', 'd', 'e'],
    'a sort or filter on a deleted property is ignored');
}

// boardColumns: the no-value column first, then options in option order.
{
  const { groupBy, columns } = m.boardColumns(tableOf());
  assert.equal(groupBy, 'status', 'defaults to the first select property');
  assert.deepEqual(columns.map((c) => c.id), ['', 'todo', 'doing', 'done']);
  assert.deepEqual(columns.map((c) => ids(c.rows)), [['d', 'e'], ['a', 'c'], ['b'], []], 'unknown option values land in the no-value column');
  assert.equal(columns[0].option, null);
  assert.equal(m.boardColumns(tableOf({ groupBy: 'priority' })).groupBy, 'priority');
  assert.equal(m.boardColumns(tableOf({ groupBy: 'deleted' })).groupBy, 'status', 'an unknown groupBy falls back');
  assert.equal(m.boardColumns(tableOf({ groupBy: 'owner' })).groupBy, 'status', 'a non-select groupBy falls back');
  const sortedCols = m.boardColumns(tableOf({ sortBy: 'due', sortDir: 'desc' })).columns;
  assert.deepEqual(ids(sortedCols[1].rows), ['a', 'c'], 'columns follow the sort');
  const noSelect = tableOf();
  const bare = { ...noSelect, schema: { ...noSelect.schema, order: ['title'], properties: { title: noSelect.schema.properties.title } } };
  assert.deepEqual(m.boardColumns(bare), { groupBy: null, columns: [] });
}

// moveRow: between columns, before a row, to the end, no-ops, unknown ids.
{
  const table = tableOf();
  const moved = m.moveRow(table, 'c', { group: 'done' });
  assert.equal(moved.rows.find((r) => r.id === 'c').values.status, 'done');
  assert.deepEqual(ids(moved.rows), ids(table.rows), 'a column change alone keeps the position');
  assert.equal(table.rows.find((r) => r.id === 'c').values.status, 'todo', 'the input table is not mutated');

  assert.deepEqual(ids(m.moveRow(table, 'c', { beforeRowId: 'a' }).rows), ['c', 'a', 'b', 'd', 'e']);
  assert.deepEqual(ids(m.moveRow(table, 'a', { beforeRowId: 'd' }).rows), ['b', 'c', 'a', 'd', 'e']);
  assert.deepEqual(ids(m.moveRow(table, 'a', { beforeRowId: null }).rows), ['b', 'c', 'd', 'e', 'a'], 'null moves to the end');
  const both = m.moveRow(table, 'b', { group: 'todo', beforeRowId: 'a' });
  assert.deepEqual(ids(both.rows), ['b', 'a', 'c', 'd', 'e']);
  assert.equal(both.rows[0].values.status, 'todo');
  assert.equal(m.moveRow(table, 'd', { group: '' }), table, 'already in the no-value column');
  assert.equal(m.moveRow(table, 'e', { group: '' }), table, 'a stale value already counts as no value');
  assert.equal(m.moveRow(table, 'b', { group: 'doing' }), table, 'same column is a no-op');
  assert.equal(m.moveRow(table, 'b', { beforeRowId: 'c' }), table, 'already directly before is a no-op');
  assert.equal(m.moveRow(table, 'b', { beforeRowId: 'b' }), table, 'before itself is a no-op');
  assert.equal(m.moveRow(table, 'e', { beforeRowId: null }), table, 'already last is a no-op');
  assert.equal(m.moveRow(table, 'zz', { group: 'done' }), table, 'unknown row');
  assert.equal(m.moveRow(table, 'a', { beforeRowId: 'zz' }), table, 'unknown target row');
  assert.equal(m.moveRow(table, 'a', { group: 'zz' }), table, 'unknown option');
  assert.equal(m.moveRow(m.moveRow(table, 'd', { group: 'todo' }), 'd', { group: '' }).rows.find((r) => r.id === 'd').values.status, '');
}

// View validation is read-time only: the file keeps what it had.
{
  const stale = { mode: 'timeline', groupBy: 'gone', previewProp: 'gone', cardProps: ['gone', 'due', 'title', 'due', 'owner'] };
  const table = tableOf(stale);
  const view = m.resolveView(table);
  assert.equal(view.mode, 'table', 'an unknown mode falls back to table');
  assert.equal(view.groupBy, 'status');
  assert.equal(view.previewProp, 'notes', 'a stale previewProp falls back to the default');
  assert.deepEqual(view.cardProps, ['due', 'owner'], 'stale, title and repeated entries are ignored');
  assert.deepEqual(table.view, stale, 'parsing leaves the stored view alone');
  assert.equal(m.resolveView(tableOf({ mode: 'board' })).mode, 'board');
  assert.equal(m.resolveView(tableOf({ mode: 'gallery' })).mode, 'gallery');
  assert.equal(m.resolveView(tableOf({ previewProp: 'due' })).previewProp, 'notes', 'a non-text previewProp is ignored');
  assert.equal(m.resolveView(tableOf({ previewProp: 'title' })).previewProp, 'notes', 'the title cannot be its own preview');
  assert.equal(m.resolveView(tableOf({ previewProp: null })).previewProp, null, 'null turns the preview off');
  assert.equal(m.resolveView(tableOf({ previewProp: 'owner' })).previewProp, 'owner');
}

// Defaults: the title is the first text property; three card properties after
// it that are not the group-by (nor the preview); a preview only when values
// average over 40 characters.
{
  const view = m.resolveView(tableOf());
  assert.equal(view.titleProp, 'title');
  assert.deepEqual(view.cardProps, ['priority', 'due', 'owner']);
  assert.equal(view.previewProp, 'notes');
  assert.deepEqual(m.resolveView(tableOf({ groupBy: 'priority' })).cardProps, ['status', 'due', 'owner']);
  const short = tableOf(undefined, [{ id: 'a', values: { title: 'A', notes: 'Short.' } }, { id: 'b', values: { title: 'B', notes: 'x'.repeat(60) } }]);
  assert.equal(m.resolveView(short).previewProp, null, 'average 33 characters is not a preview');
  assert.deepEqual(m.resolveView(short).cardProps, ['priority', 'due', 'owner']);
  assert.equal(m.resolveView(tableOf({ cardProps: [] })).cardProps.length, 0, 'an empty list means no properties');
}

// New view keys survive parse then serialize byte for byte.
{
  const text = JSON.stringify(viewFile({ mode: 'gallery', groupBy: 'status', cardProps: ['due', 'gone'], previewProp: 'notes', futureViewKey: { zoom: 2 } }), null, 2) + '\n';
  assert.equal(m.serializeDb(m.parseDb(text, 'Views.db').db), text);
  const nulled = JSON.stringify(viewFile({ mode: 'board', previewProp: null, cardProps: [] }), null, 2) + '\n';
  assert.equal(m.serializeDb(m.parseDb(nulled, 'Views.db').db), nulled);
}

console.log('db: all checks passed');
