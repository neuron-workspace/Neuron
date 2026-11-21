// Run: node tools/csv.test.mjs
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'tools', '.csv.tmp.mjs');
await build({
  stdin: {
    contents: `export * from './src/renderer/lib/csv'; export * from './src/renderer/lib/csv-table'; export * from './src/renderer/lib/new-file'; export { listFolder } from './src/renderer/lib/workspace-explorer'; export { SURFACE_EXTENSIONS, isSurfaceFile } from './src/renderer/surfaces/index';`,
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

let checks = 0;
const check = (what, fn) => {
  try { fn(); } catch (error) { error.message = what + ': ' + error.message; throw error; }
  checks += 1;
};
const roundTrip = (text) => {
  const parsed = m.parseCsv(text);
  return m.serializeCsv(parsed.rawHeaders, parsed.rows, parsed.dialect);
};

check('quoted fields, doubled quotes, embedded delimiters and line breaks', () => {
  const text = 'name,quote,notes\n"Smith, Ann","She said ""hi""","line one\nline two"\nBob,plain,"a\r\nb"\n';
  const parsed = m.parseCsv(text);
  assert.deepEqual(parsed.headers, ['name', 'quote', 'notes']);
  assert.deepEqual(parsed.rows, [['Smith, Ann', 'She said "hi"', 'line one\nline two'], ['Bob', 'plain', 'a\r\nb']]);
  assert.equal(parsed.dialect.delimiter, ',');
  assert.equal(parsed.dialect.lineEnd, '\n');
  assert.equal(parsed.exact, true);
  assert.equal(roundTrip(text), text);
});

check('a leading BOM is remembered and written back', () => {
  const text = '﻿a,b\n1,2\n';
  const parsed = m.parseCsv(text);
  assert.deepEqual(parsed.headers, ['a', 'b']);
  assert.equal(parsed.dialect.bom, true);
  assert.equal(roundTrip(text), text);
});

check('each line-end style, with and without a final newline', () => {
  for (const end of ['\r\n', '\n', '\r']) {
    for (const final of [true, false]) {
      const text = ['a,b', '1,2', '3,4'].join(end) + (final ? end : '');
      const parsed = m.parseCsv(text);
      assert.equal(parsed.dialect.lineEnd, end);
      assert.equal(parsed.dialect.finalNewline, final);
      assert.deepEqual(parsed.rows, [['1', '2'], ['3', '4']]);
      assert.equal(parsed.exact, true);
      assert.equal(roundTrip(text), text);
    }
  }
});

check('semicolon and tab files', () => {
  const semi = 'name;amount;note\r\nA;1,5;"x;y"\r\nB;2,25;z\r\n';
  const parsed = m.parseCsv(semi);
  assert.equal(parsed.dialect.delimiter, ';');
  assert.deepEqual(parsed.rows[0], ['A', '1,5', 'x;y']);
  assert.equal(roundTrip(semi), semi);
  const tab = 'a\tb\tc\n1\t2, 3\t4\n';
  const tabbed = m.parseCsv(tab);
  assert.equal(tabbed.dialect.delimiter, '\t');
  assert.deepEqual(tabbed.rows, [['1', '2, 3', '4']]);
  assert.equal(roundTrip(tab), tab);
});

check('a one-column file defaults to the comma', () => {
  const parsed = m.parseCsv('Name\nAnn\nBob\n');
  assert.equal(parsed.dialect.delimiter, ',');
  assert.deepEqual(parsed.rows, [['Ann'], ['Bob']]);
  assert.equal(parsed.exact, true);
});

check('ragged rows are padded, never cut, and the file is not exact', () => {
  const parsed = m.parseCsv('a,b,c\n1,2\n3,4,5,6\n');
  assert.deepEqual(parsed.headers, ['a', 'b', 'c', 'Column 4']);
  assert.deepEqual(parsed.rows, [['1', '2', '', ''], ['3', '4', '5', '6']]);
  assert.equal(parsed.exact, false);
});

check('duplicate and empty headers become unique for display only', () => {
  const parsed = m.parseCsv('Name,,Name,Name (2),\n1,2,3,4,5\n');
  assert.deepEqual(parsed.rawHeaders, ['Name', '', 'Name', 'Name (2)', '']);
  assert.deepEqual(parsed.headers, ['Name', 'Column 2', 'Name (3)', 'Name (2)', 'Column 5']);
  assert.equal(parsed.exact, true);
  assert.deepEqual(m.uniqueHeaders(['Column 2', '', ' ']), ['Column 2', 'Column 2 (2)', 'Column 3']);
});

check('an empty file and a header-only file', () => {
  const empty = m.parseCsv('');
  assert.deepEqual(empty.headers, []);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.exact, true);
  assert.equal(m.serializeCsv([], [], empty.dialect), '');
  const header = m.parseCsv('Name,Age\n');
  assert.deepEqual(header.headers, ['Name', 'Age']);
  assert.deepEqual(header.rows, []);
  assert.equal(roundTrip('Name,Age\n'), 'Name,Age\n');
  assert.equal(roundTrip('Name'), 'Name');
});

check('byte-for-byte round trips in every supported dialect', () => {
  const samples = [
    'a,b\n1,2\n',
    'a,b\r\n1,2\r\n',
    'a,b\r1,2',
    '﻿a;b\r\n"x\r\ny";2\r\n',
    '"a","b"\n"1","2"\n"",""\n',
    'a\tb\n" lead"\t"trail "\n',
    'id,text\n1,"multi\nline, with ""quotes"""\n2,\n',
    'one\n""\n',
  ];
  for (const text of samples) {
    const parsed = m.parseCsv(text);
    assert.equal(parsed.exact, true, JSON.stringify(text));
    assert.equal(roundTrip(text), text, JSON.stringify(text));
  }
  assert.equal(m.parseCsv('"a","b"\n"1","2"\n').dialect.quoteAll, true);
});

check('mixed line ends and inconsistent quoting are reported as not exact', () => {
  for (const text of ['a,b\r\n1,2\n3,4\r\n', '"a",b\n1,2\n', 'a,b\n"1",2\n', 'a,b\n\n1,2\n', 'a,b\n1,"x"y\n', 'a,b\n1,"open\n']) {
    assert.equal(m.parseCsv(text).exact, false, JSON.stringify(text));
  }
  // Malformed quoting keeps every character.
  assert.deepEqual(m.parseCsv('a,b\n1,"x"y\n').rows, [['1', 'xy']]);
  assert.deepEqual(m.parseCsv('a,b\n1,"open\n').rows, [['1', 'open\n']]);
});

check('serialising after an edit keeps the dialect and changes only that cell', () => {
  const text = '﻿name;note\r\nAnn;"two\r\nlines"\r\nBob;plain\r\n';
  const parsed = m.parseCsv(text);
  const rows = parsed.rows.map((row) => [...row]);
  rows[1][1] = 'changed';
  assert.equal(m.serializeCsv(parsed.headers, rows, parsed.dialect), '﻿name;note\r\nAnn;"two\r\nlines"\r\nBob;changed\r\n');
  rows.push(['Cy; Jr', 'needs "quotes"']);
  assert.equal(m.serializeCsv(parsed.headers, rows, parsed.dialect).endsWith('\r\n"Cy; Jr";"needs ""quotes"""\r\n'), true);
  const all = m.parseCsv('"a","b"\n"1","2"\n');
  assert.equal(m.serializeCsv(all.headers, [['x', '']], all.dialect), '"a","b"\n"x",""\n');
  assert.equal(m.serializeCsv(['Name'], [['']], m.NEW_TABLE_DIALECT), 'Name\n""\n');
  assert.deepEqual(m.parseCsv('Name\n""\n').rows, [['']]);
});

check('type inference: number, date, checkbox, url only when every value fits', () => {
  assert.equal(m.inferColumnType(['1', '-2.5', '', '1e3']), 'number');
  assert.equal(m.inferColumnType(['1', 'two']), 'text');
  assert.equal(m.inferColumnType(['2024-02-29', '']), 'date');
  assert.equal(m.inferColumnType(['2023-02-29']), 'text');
  assert.equal(m.inferColumnType(['TRUE', 'no', 'x', '']), 'checkbox');
  assert.equal(m.inferColumnType(['1', '0']), 'number');
  assert.equal(m.inferColumnType(['https://a.example', 'http://b.example/x']), 'url');
  assert.equal(m.inferColumnType(['', '  ']), 'text');
  const meta = m.inferTableMeta(['n', 't'], [['1', 'a'], ['2', 'b']]);
  assert.equal(meta.columns.n.type, 'number');
  assert.equal(meta.columns.t.type, 'text');
});

check('checkbox reading and writing keep the column\'s words', () => {
  for (const value of ['true', 'YES', '1', 'x', ' X ']) assert.equal(m.isChecked(value), true, value);
  for (const value of ['false', 'no', '0', '', 'maybe']) assert.equal(m.isChecked(value), false, value);
  assert.equal(m.checkboxValue(false, 'yes'), 'no');
  assert.equal(m.checkboxValue(true, 'No'), 'Yes');
  assert.equal(m.checkboxValue(false, 'TRUE'), 'FALSE');
  assert.equal(m.checkboxValue(false, '1'), '0');
  assert.equal(m.checkboxValue(false, 'x'), '');
  assert.equal(m.checkboxValue(true, ''), 'true');
});

check('metadata validation ignores junk and never throws', () => {
  for (const junk of ['', 'not json', 'null', '[]', '42', '{"columns": 5, "view": "x"}']) {
    const meta = m.parseTableMeta(junk);
    assert.equal(meta.version, 1);
    assert.equal(Object.keys(meta.columns).length, 0);
    assert.deepEqual(meta.view, m.defaultView());
  }
  const text = JSON.stringify({
    version: 9,
    columns: {
      a: { type: 'number' },
      b: { type: 'formula' },
      c: 'text',
      d: { type: 'select', options: [{ id: 'o1', name: 'One', color: 'red;background:url(x)' }, { id: 'o2', name: 'One', color: '#fff' }, { id: 5, name: 'bad' }, { id: 'o3', name: 'Two', color: '#5aa06c' }] },
      e: { type: 'select', options: 'nope' },
      gone: { type: 'date' },
    },
    view: { sortBy: 'gone', sortDir: 'sideways', filterProp: 'a', filterValue: 3, mode: 'board' },
  }).replace('"c":', '"__proto__":{"type":"number"},"c":');
  const meta = m.parseTableMeta(text, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(Object.keys(meta.columns).sort(), ['a', 'd', 'e']);
  assert.equal(meta.columns.a.type, 'number');
  assert.deepEqual(meta.columns.d.options.map((o) => o.name), ['One', 'Two']);
  assert.equal(meta.columns.d.options[0].color, m.OPTION_COLORS[0]);
  assert.deepEqual(meta.columns.e.options, []);
  assert.deepEqual(meta.view, { sortBy: null, sortDir: 'asc', filterProp: 'a', filterValue: '', mode: 'table' });
  assert.equal({}.type, undefined);
  assert.equal(Object.getPrototypeOf(meta.columns), null);
  // A real column called __proto__ is kept as a column, not a prototype.
  const proto = m.parseTableMeta('{"columns":{"__proto__":{"type":"number"}}}', ['__proto__']);
  assert.equal(m.columnMeta(proto, '__proto__').type, 'number');
  assert.equal(m.columnMeta(proto, 'toString').type, 'text');
  assert.equal({}.type, undefined);
  // Writing keeps only the columns the file has.
  const written = JSON.parse(m.serializeTableMeta(m.parseTableMeta(text), ['a']));
  assert.deepEqual(Object.keys(written.columns), ['a']);
  assert.equal(written.view.sortBy, null);
});

check('the view: filter, search and sort never reorder the rows', () => {
  const headers = ['name', 'n', 'done'];
  const rows = [['b', '10', 'no'], ['a', '9', 'yes'], ['c', '', 'x']];
  const meta = m.emptyMeta();
  meta.columns.done = { type: 'checkbox' };
  const view = { ...m.defaultView(), sortBy: 'n' };
  assert.deepEqual(m.visibleRowIndices(headers, rows, meta, view, ''), [2, 1, 0]);
  assert.deepEqual(m.visibleRowIndices(headers, rows, meta, { ...view, sortDir: 'desc' }, ''), [0, 1, 2]);
  assert.deepEqual(m.visibleRowIndices(headers, rows, meta, { ...view, sortBy: 'done' }, ''), [0, 1, 2]);
  assert.deepEqual(m.visibleRowIndices(headers, rows, meta, { ...m.defaultView(), filterProp: 'name', filterValue: 'A' }, ''), [1]);
  assert.deepEqual(m.visibleRowIndices(headers, rows, null, m.defaultView(), 'YES'), [1]);
  assert.deepEqual(rows[0], ['b', '10', 'no']);
});

check('the 5 MB and 50,000-row limits, and text that was not UTF-8', () => {
  assert.equal(m.exceedsCsvBytes(5 * 1024 * 1024), false);
  assert.equal(m.exceedsCsvBytes(5 * 1024 * 1024 + 1), true);
  assert.equal(m.exceedsCsvRows(50_000), false);
  assert.equal(m.exceedsCsvRows(50_001), true);
  assert.equal(m.utf8Length('aé€😀'), 1 + 2 + 3 + 4);
  assert.equal(m.csvReadOnlyReason('a,b\n', 0), null);
  assert.match(m.csvReadOnlyReason('a,b\n', 50_001), /50,000 rows/);
  assert.match(m.csvReadOnlyReason('x'.repeat(5 * 1024 * 1024 + 1), 1), /5 MB/);
  assert.match(m.csvReadOnlyReason('caf�,b\n', 1), /UTF-8/);
});

check('metadata path, the csv surface and the new table', () => {
  assert.equal(m.tableMetaPath('data/people.csv'), '.neuron/tables/data/people.csv.json');
  assert.equal(m.isCsvPath('a/B.CSV'), true);
  assert.ok(m.SURFACE_EXTENSIONS.includes('csv'));
  assert.equal(m.isSurfaceFile('data/people.csv'), true);
  assert.equal(m.NEW_FILE_KINDS.table.ext, '.csv');
  const text = m.startingContent('table');
  assert.equal(text, 'Name\n');
  const parsed = m.parseCsv(text);
  assert.deepEqual(parsed.headers, ['Name']);
  assert.deepEqual(parsed.dialect, m.NEW_TABLE_DIALECT);
  const companions = m.startingCompanions('table', 'lists/Untitled.csv');
  assert.equal(companions.length, 1);
  assert.equal(companions[0].path, '.neuron/tables/lists/Untitled.csv.json');
  assert.equal(m.parseTableMeta(companions[0].content, ['Name']).columns.Name.type, 'text');
  assert.deepEqual(m.startingCompanions('note', 'a.md'), []);
});

check('Excel sep directive is not a header and round-trips with BOM and CRLF', () => {
  const text = '\uFEFFsep=;\r\nName;Note\r\nAda;"a;b\r\nc"';
  const parsed = m.parseCsv(text);
  assert.deepEqual(parsed.headers, ['Name', 'Note']);
  assert.deepEqual(parsed.rows, [['Ada', 'a;b\r\nc']]);
  assert.equal(parsed.exact, true);
  assert.equal(roundTrip(text), text);
});
check('combined BOM, CRLF and no final newline is byte-identical', () => {
  const text = '\uFEFFName;Note\r\nAda;"a;b"';
  assert.equal(m.parseCsv(text).exact, true);
  assert.equal(roundTrip(text), text);
});
check('actual parsed row and UTF-8 byte boundaries keep the inclusive limit', () => {
  for (const count of [50_000, 50_001]) {
    const text = 'Name\n' + 'Ada\n'.repeat(count);
    const parsed = m.parseCsv(text);
    assert.equal(parsed.rows.length, count);
    assert.equal(m.csvReadOnlyReason(text, parsed.rows.length), count === 50_000 ? null : 'This CSV has more than 50,000 rows, so it opens read-only.');
  }
  const at = 'Name\n' + 'é'.repeat((m.CSV_MAX_BYTES - 6) / 2) + 'x';
  assert.equal(Buffer.byteLength(at), m.CSV_MAX_BYTES);
  assert.equal(m.csvReadOnlyReason(at, m.parseCsv(at).rows.length), null);
  assert.match(m.csvReadOnlyReason(at + 'x', 1), /5 MB/);
  assert.match(m.csvReadOnlyReason(Buffer.from([0x4e, 0x0a, 0xe9]).toString('utf8'), 1), /UTF-8/);
  assert.equal(m.isSurfaceFile('data/PEOPLE.CSV'), true);
  assert.equal(m.listFolder(['data/PEOPLE.CSV'], 'data').files[0].extension, 'csv');
});
check('prototype-shaped header names survive parse, metadata and serialization', () => {
  const text = '__proto__,constructor\nAda,Lin\n';
  const parsed = m.parseCsv(text);
  const meta = m.inferTableMeta(parsed.headers, parsed.rows);
  assert.equal(m.columnMeta(meta, '__proto__').type, 'text');
  assert.equal(m.columnMeta(meta, 'constructor').type, 'text');
  assert.deepEqual(Object.keys(JSON.parse(m.serializeTableMeta(meta, parsed.headers)).columns), parsed.headers);
  assert.equal(roundTrip(text), text);
});

console.log(`csv: ${checks} checks passed`);
