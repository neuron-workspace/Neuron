// Run: node tools/data-query.test.mjs
//
// The data blocks of an MDX page (Stat, Chart, Form) share one way of naming a
// table and filtering it. A wrong count on a dashboard reads as the truth, so
// every column type, every operator and the group cap are pinned here.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/renderer/lib/data-query.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
});
const q = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

// --- sources -----------------------------------------------------------------
eq(q.parseSource('Planner.db', 'tasks'), { kind: 'db', path: 'Planner.db', table: 'tasks' });
eq(q.parseSource('@data/people.csv'), { kind: 'csv', path: 'data/people.csv' });
ok('error' in q.parseSource(''), 'a missing source is an error');
ok('error' in q.parseSource('notes.md'), 'only .db and .csv are sources');

// --- where parsing -------------------------------------------------------------
eq(q.parseWhere('status = done and priority != low'), {
  conditions: [{ column: 'status', op: '=', value: 'done' }, { column: 'priority', op: '!=', value: 'low' }], errors: [],
});
eq(q.parseWhere('due <= today AND done = true').conditions.map((c) => c.op), ['<=', '=']);
eq(q.parseWhere('"Blocked by" = "legal and IT"').conditions, [{ column: 'Blocked by', op: '=', value: 'legal and IT' }], 'quotes keep `and` and spaces');
eq(q.parseWhere('Status=Done').conditions, [{ column: 'Status', op: '=', value: 'Done' }], 'no spaces needed');
{
  const { conditions, errors } = q.parseWhere('status ~ done and just junk and priority = high and due <');
  eq(conditions, [{ column: 'priority', op: '=', value: 'high' }], 'unreadable parts are ignored, the rest still apply');
  eq(errors.length, 3);
  ok(errors[0].includes('Unknown operator "~"'));
  ok(errors.some((e) => e.includes('needs a value')));
}
ok(q.parseWhere('status == done').errors[0].includes('"=="'), '== is not an operator');
eq(q.parseWhere(undefined), { conditions: [], errors: [] });
eq(q.parseWhere('   '), { conditions: [], errors: [] });
eq(q.localToday(new Date(2026, 7, 4, 23, 30)), '2026-08-04', 'today is the local calendar day');

// --- a .db table -----------------------------------------------------------------
const options = [{ id: 'todo', name: 'Todo', color: '#888' }, { id: 'doing', name: 'In progress', color: '#528fd1' }, { id: 'done', name: 'Done', color: '#5aa06c' }];
const table = {
  name: 'Tasks',
  schema: {
    order: ['title', 'status', 'hours', 'due', 'done', 'tags'],
    properties: {
      title: { name: 'Task', type: 'text' }, status: { name: 'Status', type: 'select', options },
      hours: { name: 'Hours', type: 'number' }, due: { name: 'Due', type: 'date' },
      done: { name: 'Finished', type: 'checkbox' },
      tags: { name: 'Tags', type: 'multiselect', options: [{ id: 'a', name: 'Alpha', color: '#111' }, { id: 'b', name: 'Beta', color: '#222' }] },
    },
    extra: {},
  },
  view: {}, extra: {}, hadView: false,
  rows: [
    { id: '1', values: { title: 'Write', status: 'done', hours: 2, due: '2026-08-01', done: true, tags: ['a'] } },
    { id: '2', values: { title: 'review', status: 'doing', hours: '3.5', due: '2026-08-24', done: false, tags: ['a', 'b'] } },
    { id: '3', values: { title: 'Ship', status: 'todo', hours: 10, due: '2026-09-02' } },
    { id: '4', values: { title: 'Plan', status: '', due: 'soon' } },
  ],
};
const data = q.fromDbTable(table);
const TODAY = '2026-08-24';
const ids = (where) => {
  const { conditions, errors } = q.parseWhere(where);
  const result = q.filterRows(data, conditions, TODAY);
  return { ids: result.rows.map((r) => r.id), errors: [...errors, ...result.errors] };
};
eq(data.rows[1].values.hours, 3.5, 'number text in a .db is read as a number');
eq(data.rows[2].values.done, false, 'a missing checkbox is unchecked');

// columns by id, by name, ignoring case
eq(ids('status = done').ids, ['1']);
eq(ids('Status = DONE').ids, ['1'], 'column and option names ignore case');
eq(ids('status = In progress').ids, ['2'], 'an option by its name');
eq(ids('Finished = true').ids, ['1'], 'a column by its display name');
// select: != keeps empty cells, order comparisons follow option order
eq(ids('status != done').ids, ['2', '3', '4']);
eq(ids('status >= doing').ids, ['1', '2']);
// text, case-insensitive
eq(ids('title = REVIEW').ids, ['2']);
eq(ids('title < r').ids, ['4'], 'text compares by letters, ignoring case');
// number
eq(ids('hours > 3').ids, ['2', '3']);
eq(ids('hours <= 2').ids, ['1']);
eq(ids('hours != 2').ids, ['2', '3', '4'], 'an empty number differs from every number');
ok(ids('hours > lots').errors[0].includes('not a number'));
// date and today
eq(ids('due < today').ids, ['1']);
eq(ids('due <= today').ids, ['1', '2']);
eq(ids('due > 2026-08-31').ids, ['3'], 'an unreadable date in a row is treated as empty');
ok(ids('due < tomorrow').errors[0].includes('not a date'));
// checkbox
eq(ids('done = true').ids, ['1']);
eq(ids('done = false').ids, ['2', '3', '4']);
eq(ids('done != yes').ids, ['2', '3', '4']);
ok(ids('done > true').errors[0].includes('use = or !='));
// multiselect
eq(ids('tags = beta').ids, ['2']);
eq(ids('tags != alpha').ids, ['3', '4']);
// combined, and errors named rather than guessed
eq(ids('status != done and due < 2026-09-01').ids, ['2']);
eq(ids('owner = me').errors, ['No column named "owner".']);

// --- measures --------------------------------------------------------------------
eq(q.measureFrom({ count: '' }), { kind: 'count' });
eq(q.measureFrom({ sum: 'hours' }), { kind: 'sum', column: 'hours' });
eq(q.measureFrom({ avg: ' Hours ' }), { kind: 'avg', column: 'Hours' });
eq(q.measureRows(data, data.rows, { kind: 'count' }), { value: 4 });
eq(q.measureRows(data, data.rows, { kind: 'sum', column: 'Hours' }), { value: 15.5 });
eq(q.measureRows(data, data.rows, { kind: 'avg', column: 'hours' }).value.toFixed(3), (15.5 / 3).toFixed(3), 'avg skips empty cells');
eq(q.measureRows(data, [], { kind: 'avg', column: 'hours' }), { value: null }, 'no rows, no average');
ok(q.measureRows(data, data.rows, { kind: 'sum', column: 'title' }).error.includes('not a number column'));
ok(q.measureRows(data, data.rows, { kind: 'sum', column: 'nope' }).error.includes('No column'));
eq(q.formatNumber(1234), '1,234');
eq(q.formatNumber(5.1666), '5.17');
eq(q.formatNumber(null), '—');

// --- grouping ----------------------------------------------------------------------
{
  const { groups } = q.groupRows(data, data.rows, 'status', { kind: 'count' });
  eq(groups.map((g) => [g.label, g.value, g.color ?? null]), [['Todo', 1, '#888'], ['In progress', 1, '#528fd1'], ['Done', 1, '#5aa06c'], ['None', 1, null]],
    'a select keeps option order and colours, and empty values come last');
  const hours = q.groupRows(data, data.rows, 'status', { kind: 'sum', column: 'hours' }).groups;
  eq(hours.map((g) => g.value), [10, 3.5, 2, 0]);
  eq(q.groupRows(data, data.rows, 'done', { kind: 'count' }).groups.map((g) => [g.label, g.value]), [['Yes', 1], ['No', 3]]);
  eq(q.groupRows(data, data.rows, 'tags', { kind: 'count' }).groups.map((g) => [g.label, g.value]), [['Alpha', 2], ['Beta', 1], ['None', 2]], 'a row counts once per tag');
  ok(q.groupRows(data, data.rows, 'nope', { kind: 'count' }).error);
}
{
  // Text groups, largest first; past 50 the top 49 and "Other".
  const many = { columns: [{ id: 'name', name: 'Name', type: 'text' }], rows: [] };
  for (let i = 0; i < 60; i++) for (let k = 0; k <= i % 7; k++) many.rows.push({ id: `${i}-${k}`, values: { name: `g${String(i).padStart(2, '0')}` } });
  const { groups } = q.groupRows(many, many.rows, 'name', { kind: 'count' });
  eq(groups.length, 50, '50 groups at most');
  eq(groups.at(-1).label, 'Other');
  eq(groups.reduce((sum, g) => sum + g.count, 0), many.rows.length, 'Other holds every row not shown');
  ok(groups.slice(0, 49).every((g, i, all) => i === 0 || all[i - 1].value >= g.value), 'the kept groups are the largest');
  eq(q.capGroups(groups.slice(0, 10)).length, 10, 'fewer than the cap are left alone');
}
{
  const byWeek = q.groupByDate(data, data.rows, 'due', 'week', { kind: 'count' }).groups;
  eq(byWeek.map((g) => [g.key, g.label, g.value]), [['2026-07-27', '27 Jul', 1], ['2026-08-24', '24 Aug', 1], ['2026-08-31', '31 Aug', 1]], 'weeks start on Monday');
  eq(q.groupByDate(data, data.rows, 'due', 'month', { kind: 'count' }).groups.map((g) => [g.label, g.value]), [['Aug 2026', 2], ['Sep 2026', 1]]);
  eq(q.groupByDate(data, data.rows, 'due', 'day', { kind: 'sum', column: 'hours' }).groups.map((g) => g.value), [2, 3.5, 10]);
  ok(q.groupByDate(data, data.rows, 'title', 'week', { kind: 'count' }).error.includes('not a date column'));
}

// --- CSV -------------------------------------------------------------------------
{
  const meta = JSON.stringify({ version: 1, columns: { Score: { type: 'number' }, Active: { type: 'checkbox' }, Team: { type: 'select', options: [{ id: 'x', name: 'Red', color: '#f00' }, { id: 'y', name: 'Blue', color: '#00f' }] }, Joined: { type: 'date' } } });
  const text = 'Name,Score,Active,Team,Joined\r\nAda,7,yes,Red,2026-01-05\r\nLin,12,no,Blue,2026-02-10\r\nMo,,yes,Green,\r\n';
  const { data: csv, meta: parsed } = q.readCsvTable(text, meta);
  const csvIds = (where) => q.filterRows(csv, q.parseWhere(where).conditions, TODAY).rows.map((r) => csv.rows.indexOf(r));
  eq(csvIds('score > 8'), [1], 'CSV numbers compare as numbers, not text');
  eq(csvIds('active = true'), [0, 2]);
  eq(csvIds('team = red'), [0]);
  eq(csvIds('team = green'), [2], 'a value outside the options still matches as text');
  eq(csvIds('joined < 2026-02-01'), [0]);
  eq(q.groupRows(csv, csv.rows, 'Team', { kind: 'sum', column: 'Score' }).groups.map((g) => [g.label, g.value, g.color ?? null]),
    [['Red', 7, '#f00'], ['Blue', 12, '#00f'], ['Green', 0, null]]);
  // An unmanaged CSV reads every column as text.
  const plain = q.readCsvTable(text, null).data;
  eq(plain.columns.map((c) => c.type), ['text', 'text', 'text', 'text', 'text']);
  // Appending keeps the file's own conventions: CRLF, yes/no, option names.
  const { csv: parsedCsv } = q.readCsvTable(text, meta);
  const appended = q.appendCsvRow(parsedCsv, parsed, { Name: 'Zed, Jr', Score: ' 3 ', Active: true, Team: 'y', Joined: '2026-03-01' });
  eq(appended, text + '"Zed, Jr",3,yes,Blue,2026-03-01\r\n');
}

// --- appending to a .db ------------------------------------------------------------
{
  const db = { format: 2, tables: { tasks: table }, relations: [], extra: {}, hadRelations: false };
  const next = q.appendDbRow(db, 'tasks', { title: ' New ', status: 'todo', hours: '4', due: '', done: true, tags: 'b', unknown: 'x' }, 'r5');
  eq(next.tables.tasks.rows.at(-1), { id: 'r5', values: { title: 'New', status: 'todo', hours: 4, done: true, tags: ['b'] } }, 'empty fields and unknown keys stay out of the row');
  eq(table.rows.length, 4, 'the original table is not changed');
  const text = JSON.stringify({ version: 2, tables: { tasks: { name: 'Tasks', schema: { order: ['title'], properties: { title: { name: 'Task', type: 'text' } } }, rows: [] }, other: { schema: { order: [], properties: {} }, rows: [] } } });
  ok('error' in q.pickDbTable(text, 'P.db'), 'several tables need a table attribute');
  ok(q.pickDbTable(text, 'P.db', 'nope').error.includes('no table named'));
  eq(q.pickDbTable(text, 'P.db', 'tasks').data.columns.map((c) => c.name), ['Task']);
  ok(q.pickDbTable('{nope', 'P.db').error.startsWith('P.db:'));
}

console.log(`data-query: ${checks} assertions passed`);
