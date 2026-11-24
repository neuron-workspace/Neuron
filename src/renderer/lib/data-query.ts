// The data blocks of an MDX page -- Stat, Chart, Form, DbView -- name a table
// the same way: `source="Planner.db" table="tasks"` or `source="people.csv"`,
// with an optional `where="status = done and due < today"`. This module turns a
// .db table or a CSV into one shape, and filters, measures and groups it. It is
// Reading and writing use callbacks supplied by the caller; watching stays there.

import { parseDb, serializeDb, type DbFile, type DbOption, type DbTable } from './db';
import { csvReadOnlyReason, parseCsv, serializeCsv, type CsvParseResult } from './csv';
import { checkboxValue, columnMeta, isChecked, isIsoDate, isNumberText, parseTableMeta, tableMetaPath, type CsvTableMeta } from './csv-table';

export type ColumnType = 'text' | 'number' | 'checkbox' | 'date' | 'url' | 'select' | 'multiselect';

export interface DataColumn {
  /** The property id in a .db, the header in a CSV. */
  id: string;
  name: string;
  type: ColumnType;
  options?: DbOption[];
}

/**
 * Values by column id: a number or null, a boolean, a YYYY-MM-DD string, an
 * option id (or the raw text when it names no option), an array of option ids.
 */
export interface DataRow { id: string; values: Record<string, unknown> }

export interface DataTable { columns: DataColumn[]; rows: DataRow[] }

export interface SourceRef { kind: 'db' | 'csv'; path: string; table?: string }

/** Where the data lives, or why the attributes do not say. */
export function parseSource(source: string | undefined, table?: string): SourceRef | { error: string } {
  const path = (source ?? '').trim().replace(/^@/, '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path) return { error: 'Add a source, e.g. source="Planner.db".' };
  if (/\.db$/i.test(path)) return { kind: 'db', path, table: table?.trim() || undefined };
  if (/\.csv$/i.test(path)) return { kind: 'csv', path };
  return { error: `${path} is not a .db or .csv file.` };
}

const TYPES = new Set<ColumnType>(['text', 'number', 'checkbox', 'date', 'url', 'select', 'multiselect']);
const asType = (type: string): ColumnType => (TYPES.has(type as ColumnType) ? type as ColumnType : 'text');

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && isNumberText(value.trim())) {
    const number = Number(value.trim());
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

export function fromDbTable(table: DbTable): DataTable {
  const columns = table.schema.order.map((id): DataColumn => {
    const prop = table.schema.properties[id];
    return { id, name: prop.name, type: asType(prop.type), ...(prop.options ? { options: prop.options } : {}) };
  });
  const rows = table.rows.map((row): DataRow => {
    const values: Record<string, unknown> = Object.create(null);
    for (const column of columns) {
      const value = row.values[column.id];
      values[column.id] = column.type === 'number' ? toNumber(value)
        : column.type === 'checkbox' ? value === true
        : value;
    }
    return { id: row.id, values };
  });
  return { columns, rows };
}

export function fromCsv(headers: readonly string[], cells: readonly (readonly string[])[], meta: CsvTableMeta | null): DataTable {
  const columns = headers.map((header): DataColumn => {
    const column = columnMeta(meta, header);
    return { id: header, name: header, type: column.type, ...(column.options ? { options: column.options } : {}) };
  });
  const rows = cells.map((row, index): DataRow => {
    const values: Record<string, unknown> = Object.create(null);
    columns.forEach((column, i) => {
      const text = row[i] ?? '';
      values[column.id] = column.type === 'number' ? toNumber(text)
        : column.type === 'checkbox' ? isChecked(text)
        : column.type === 'select' ? (column.options?.find((o) => o.name === text)?.id ?? text)
        : text;
    });
    return { id: String(index), values };
  });
  return { columns, rows };
}

/** The table a .db source names, as DbView chooses it: by key, or the only one. */
export function pickDbTable(text: string, path: string, table?: string): { db: DbFile; tableId: string; data: DataTable } | { error: string } {
  const parsed = parseDb(text, path);
  if (!parsed.db) return { error: `${path}: ${parsed.error ?? 'not a database'}` };
  const ids = Object.keys(parsed.db.tables);
  if (table && !parsed.db.tables[table]) return { error: `${path} has no table named "${table}".` };
  if (!table && ids.length > 1) return { error: `${path} has several tables. Add table="${ids[0]}".` };
  const tableId = table ?? ids[0];
  return { db: parsed.db, tableId, data: fromDbTable(parsed.db.tables[tableId]) };
}

/** A CSV and its metadata text; `metaText` null when the CSV is not managed. */
export function readCsvTable(text: string, metaText: string | null): { csv: CsvParseResult; meta: CsvTableMeta | null; data: DataTable } {
  const csv = parseCsv(text);
  const meta = metaText === null ? null : parseTableMeta(metaText, csv.headers);
  return { csv, meta, data: fromCsv(csv.headers, csv.rows, meta) };
}

/** The title column, as in a database card: the first text column. */
export function titleColumn(table: DataTable): DataColumn | null {
  return table.columns.find((c) => c.type === 'text') ?? null;
}

/** A column by id, then by name, ignoring case for both after an exact id. */
export function findColumn(table: DataTable, name: string): DataColumn | undefined {
  const wanted = name.trim();
  const lower = wanted.toLowerCase();
  return table.columns.find((c) => c.id === wanted)
    ?? table.columns.find((c) => c.name.toLowerCase() === lower)
    ?? table.columns.find((c) => c.id.toLowerCase() === lower);
}

// --- where -------------------------------------------------------------------

export type Operator = '=' | '!=' | '<' | '>' | '<=' | '>=';
export interface Condition { column: string; op: Operator; value: string }

const OPERATORS = new Set<string>(['=', '!=', '<', '>', '<=', '>=']);
const unquote = (text: string) => {
  const t = text.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'" || t[0] === '“') && /["'”]$/.test(t) ? t.slice(1, -1) : t;
};

/** Split on `and` outside quotes. */
function splitAnd(text: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote || (quote === '“' && c === '”')) quote = null; continue; }
    if (c === '"' || c === "'" || c === '“') { quote = c; continue; }
    const rest = text.slice(i);
    const match = /^\s+and\s+/i.exec(rest);
    if (match && i > start) { parts.push(text.slice(start, i)); i += match[0].length - 1; start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Conditions joined by `and`. A part that does not read is left out and named. */
export function parseWhere(text: string | undefined): { conditions: Condition[]; errors: string[] } {
  const conditions: Condition[] = [];
  const errors: string[] = [];
  if (!text?.trim()) return { conditions, errors };
  for (const part of splitAnd(text)) {
    const match = /^(.*?)\s*([<>=!~^$*]+)\s*(.*)$/.exec(part);
    if (!match || !match[1].trim()) { errors.push(`Can't read "${part}". Write it like status = done.`); continue; }
    const [, column, op, value] = match;
    if (!OPERATORS.has(op)) { errors.push(`Unknown operator "${op}" in "${part}". Use = != < > <= >=.`); continue; }
    if (!unquote(value)) { errors.push(`"${part}" needs a value.`); continue; }
    conditions.push({ column: unquote(column), op: op as Operator, value: unquote(value) });
  }
  return { conditions, errors };
}

/** Today's calendar date where the app is running, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const compare = (op: Operator, diff: number): boolean =>
  op === '=' ? diff === 0 : op === '!=' ? diff !== 0 : op === '<' ? diff < 0 : op === '>' ? diff > 0 : op === '<=' ? diff <= 0 : diff >= 0;

const isEmpty = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

type Test = (value: unknown) => boolean;

/** A test for one condition, or the reason the condition cannot apply. */
function conditionTest(column: DataColumn, { op, value }: Condition, today: string): Test | string {
  const word = value.toLowerCase();
  // An empty cell differs from every value and is neither more nor less.
  const guard = (test: Test): Test => (cell) => (isEmpty(cell) ? op === '!=' : test(cell));
  switch (column.type) {
    case 'number': {
      const n = toNumber(value);
      if (n === null) return `"${value}" is not a number, and ${column.name} is a number column.`;
      return guard((cell) => typeof cell === 'number' && compare(op, cell - n));
    }
    case 'date': {
      const day = word === 'today' ? today : value;
      if (!isIsoDate(day)) return `"${value}" is not a date. Use today or a date like 2026-08-24.`;
      return (cell) => (typeof cell === 'string' && isIsoDate(cell) ? compare(op, cell < day ? -1 : cell > day ? 1 : 0) : op === '!=');
    }
    case 'checkbox': {
      const truth = /^(true|yes|1|x|checked)$/.test(word) ? true : /^(false|no|0|unchecked)$/.test(word) ? false : null;
      if (truth === null) return `"${value}" is not true or false, and ${column.name} is a checkbox.`;
      if (op !== '=' && op !== '!=') return `${column.name} is a checkbox, so use = or != with it.`;
      return (cell) => (cell === true) === truth ? op === '=' : op === '!=';
    }
    case 'select':
    case 'multiselect': {
      const options = column.options ?? [];
      const index = options.findIndex((o) => o.name.toLowerCase() === word || o.id.toLowerCase() === word);
      const option = options[index];
      if (column.type === 'multiselect') {
        if (op !== '=' && op !== '!=') return `${column.name} holds several values, so use = or != with it.`;
        const has: Test = (cell) => Array.isArray(cell) && cell.some((id) => id === option?.id || String(id).toLowerCase() === word);
        return (cell) => (op === '=' ? has(cell) : !has(cell));
      }
      const rank = (cell: unknown) => options.findIndex((o) => o.id === cell);
      return guard((cell) => {
        if (option && rank(cell) >= 0) return compare(op, rank(cell) - index);
        const text = String(cell).toLowerCase();
        return compare(op, text < word ? -1 : text > word ? 1 : 0);
      });
    }
    default:
      return guard((cell) => {
        const text = String(cell).toLowerCase();
        return compare(op, text < word ? -1 : text > word ? 1 : 0);
      });
  }
}

/** Rows meeting every condition. Conditions that cannot apply are named, not guessed. */
export function filterRows(table: DataTable, conditions: readonly Condition[], today = localToday()): { rows: DataRow[]; errors: string[] } {
  const errors: string[] = [];
  const tests: { id: string; test: Test }[] = [];
  for (const condition of conditions) {
    const column = findColumn(table, condition.column);
    if (!column) { errors.push(`No column named "${condition.column}".`); continue; }
    const test = conditionTest(column, condition, today);
    if (typeof test === 'string') errors.push(test);
    else tests.push({ id: column.id, test });
  }
  return { rows: table.rows.filter((row) => tests.every(({ id, test }) => test(row.values[id]))), errors };
}

// --- measures and groups -------------------------------------------------------

export type Measure = { kind: 'count' } | { kind: 'sum' | 'avg'; column: string };

/** count, sum="column" or avg="column" from a component's attributes; count by default. */
export function measureFrom(attrs: Record<string, string | undefined>): Measure {
  if (attrs.sum !== undefined && attrs.sum.trim()) return { kind: 'sum', column: attrs.sum.trim() };
  if (attrs.avg !== undefined && attrs.avg.trim()) return { kind: 'avg', column: attrs.avg.trim() };
  return { kind: 'count' };
}

function measureColumn(table: DataTable, measure: Measure): DataColumn | string | null {
  if (measure.kind === 'count') return null;
  const column = findColumn(table, measure.column);
  if (!column) return `No column named "${measure.column}".`;
  if (column.type !== 'number') return `${column.name} is not a number column, so it cannot be added up.`;
  return column;
}

function apply(rows: readonly DataRow[], measure: Measure, column: DataColumn | null): number | null {
  if (measure.kind === 'count' || !column) return rows.length;
  const numbers = rows.map((row) => row.values[column.id]).filter((v): v is number => typeof v === 'number');
  const sum = numbers.reduce((total, n) => total + n, 0);
  if (measure.kind === 'sum') return sum;
  return numbers.length ? sum / numbers.length : null;
}

export function measureRows(table: DataTable, rows: readonly DataRow[], measure: Measure): { value: number | null; error?: string } {
  const column = measureColumn(table, measure);
  if (typeof column === 'string') return { value: null, error: column };
  return { value: apply(rows, measure, column) };
}

export interface Group { key: string; label: string; color?: string; value: number; count: number }

export const MAX_GROUPS = 50;

/** At most `limit` groups: the largest limit - 1 in their own order, then "Other". */
export function capGroups(groups: readonly Group[], limit = MAX_GROUPS): Group[] {
  if (groups.length <= limit) return [...groups];
  const keep = new Set([...groups].map((g, i) => ({ g, i })).sort((a, b) => b.g.value - a.g.value || a.i - b.i).slice(0, limit - 1).map(({ g }) => g.key));
  const rest = groups.filter((g) => !keep.has(g.key));
  return [
    ...groups.filter((g) => keep.has(g.key)),
    { key: '__other', label: 'Other', value: rest.reduce((sum, g) => sum + g.value, 0), count: rest.reduce((sum, g) => sum + g.count, 0) },
  ];
}

/**
 * Rows grouped by one column. A select keeps its option order and colours and
 * shows every option; other columns group by value, largest first. Rows with
 * no value form a "None" group at the end.
 */
export function groupRows(table: DataTable, rows: readonly DataRow[], by: string, measure: Measure, limit = MAX_GROUPS): { groups: Group[]; error?: string } {
  const column = findColumn(table, by);
  if (!column) return { groups: [], error: `No column named "${by}".` };
  const target = measureColumn(table, measure);
  if (typeof target === 'string') return { groups: [], error: target };
  const buckets = new Map<string, { label: string; color?: string; rows: DataRow[] }>();
  const ordered = column.type === 'select' || column.type === 'multiselect';
  if (ordered) for (const o of column.options ?? []) buckets.set(o.id, { label: o.name || '…', color: o.color, rows: [] });
  if (column.type === 'checkbox') { buckets.set('true', { label: 'Yes', rows: [] }); buckets.set('false', { label: 'No', rows: [] }); }
  const none: DataRow[] = [];
  const add = (key: string, label: string, row: DataRow) => {
    const bucket = buckets.get(key) ?? { label, rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
  };
  for (const row of rows) {
    const value = row.values[column.id];
    if (column.type === 'checkbox') add(String(value === true), '', row);
    else if (isEmpty(value)) none.push(row);
    else if (Array.isArray(value)) for (const id of value) add(String(id), String(id), row);
    else add(String(value).trim(), String(value).trim(), row);
  }
  let groups: Group[] = [...buckets].map(([key, b]) => ({ key, label: b.label, ...(b.color ? { color: b.color } : {}), value: apply(b.rows, measure, target) ?? 0, count: b.rows.length }));
  if (!ordered && column.type !== 'checkbox') groups.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (none.length) groups.push({ key: '__none', label: 'None', value: apply(none, measure, target) ?? 0, count: none.length });
  groups = capGroups(groups, limit);
  return { groups };
}

export type DateStep = 'day' | 'week' | 'month';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The period a date falls in: the day, the Monday of its week, or the 1st of its month. */
export function periodOf(day: string, step: DateStep): string {
  if (step === 'day') return day;
  if (step === 'month') return day.slice(0, 7) + '-01';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function periodLabel(key: string, step: DateStep): string {
  const [y, m, d] = key.split('-').map(Number);
  return step === 'month' ? `${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

/**
 * Rows grouped by the period of a date column, oldest first. A line has a time
 * axis, so past the limit the most recent periods are kept rather than an
 * "Other" point that has no place on it.
 */
export function groupByDate(table: DataTable, rows: readonly DataRow[], x: string, step: DateStep, measure: Measure, limit = MAX_GROUPS): { groups: Group[]; error?: string } {
  const column = findColumn(table, x);
  if (!column) return { groups: [], error: `No column named "${x}".` };
  if (column.type !== 'date') return { groups: [], error: `${column.name} is not a date column.` };
  const target = measureColumn(table, measure);
  if (typeof target === 'string') return { groups: [], error: target };
  const buckets = new Map<string, DataRow[]>();
  for (const row of rows) {
    const value = row.values[column.id];
    if (typeof value !== 'string' || !isIsoDate(value)) continue;
    const key = periodOf(value, step);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const groups = [...buckets.keys()].sort().slice(-limit)
    .map((key) => ({ key, label: periodLabel(key, step), value: apply(buckets.get(key)!, measure, target) ?? 0, count: buckets.get(key)!.length }));
  return { groups };
}

// --- adding a row ----------------------------------------------------------------

/** What a form field holds: text for most columns, a boolean for a checkbox. */
export type FieldValue = string | boolean;

/** A .db cell from a form field: numbers as numbers, select by option id. */
export function dbCellValue(column: DataColumn, value: FieldValue): unknown {
  if (column.type === 'checkbox') return value === true;
  const text = typeof value === 'string' ? value.trim() : '';
  if (column.type === 'number') return text === '' ? undefined : toNumber(text) ?? undefined;
  if (text === '') return undefined;
  if (column.type === 'multiselect') return [text];
  return text;
}

/** The database with one row appended to a table; empty fields stay out of the row. */
export function appendDbRow(db: DbFile, tableId: string, fields: Record<string, FieldValue>, rowId: string): DbFile {
  const table = db.tables[tableId];
  if (!Object.hasOwn(db.tables, tableId)) throw new Error(`Database has no table named "${tableId}".`);
  const data = fromDbTable(table);
  const values: Record<string, unknown> = {};
  for (const column of data.columns) {
    if (!(column.id in fields)) continue;
    const value = dbCellValue(column, fields[column.id]);
    if (value !== undefined) values[column.id] = value;
  }
  return { ...db, tables: { ...db.tables, [tableId]: { ...table, rows: [...table.rows, { id: rowId, values }] } } };
}

/**
 * The CSV text with one row appended, in the file's own dialect. A select
 * writes its option's name, and a checkbox the words its column already uses.
 */
export function appendCsvRow(csv: CsvParseResult, meta: CsvTableMeta | null, fields: Record<string, FieldValue>): string {
  if (!csv.exact) throw new Error("This table's file can't be added to safely; open it as a table first.");
  const row = csv.headers.map((header, index) => {
    const value = fields[header];
    const column = columnMeta(meta, header);
    if (column.type === 'checkbox') {
      const sample = csv.rows.map((r) => r[index]).find((cell) => cell && cell.trim() !== '') ?? '';
      return checkboxValue(value === true, sample);
    }
    if (typeof value !== 'string') return '';
    if (column.type === 'select') return column.options?.find((o) => o.id === value)?.name ?? value.trim();
    return value.trim();
  });
  return serializeCsv(csv.rawHeaders, [...csv.rows, row], csv.dialect);
}

const appends = new Map<string, Promise<void>>();

/** Serialize the entire read/append/write, so two forms cannot overwrite a row. */
export async function appendSourceRow(ref: SourceRef, fields: Record<string, FieldValue>, rowId: string,
  read: (path: string) => Promise<string>, write: (text: string) => Promise<boolean>): Promise<void> {
  const previous = appends.get(ref.path) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => appendSourceRowNow(ref, fields, rowId, read, write));
  appends.set(ref.path, pending);
  try { await pending; }
  finally { if (appends.get(ref.path) === pending) appends.delete(ref.path); }
}

async function appendSourceRowNow(ref: SourceRef, fields: Record<string, FieldValue>, rowId: string,
  read: (path: string) => Promise<string>, write: (text: string) => Promise<boolean>): Promise<void> {
  const text = await read(ref.path);
  if (typeof text !== 'string' || text.startsWith('Error:')) throw new Error(`No file at ${ref.path}.`);
  let next: string;
  const requireTitle = (data: DataTable) => {
    const title = titleColumn(data);
    if (title && !String(fields[title.id] ?? '').trim()) throw new Error(`${title.name} is required.`);
  };
  if (ref.kind === 'db') {
    const picked = pickDbTable(text, ref.path, ref.table);
    if ('error' in picked) throw new Error(picked.error);
    requireTitle(picked.data);
    next = serializeDb(appendDbRow(picked.db, picked.tableId, fields, rowId));
  } else {
    const metaText = await read(tableMetaPath(ref.path));
    if (typeof metaText !== 'string' || metaText.startsWith('Error:')) throw new Error('Convert this CSV to a Neuron table to add rows.');
    const { csv, meta, data } = readCsvTable(text, metaText);
    const reason = csvReadOnlyReason(text, csv.rows.length);
    if (reason) throw new Error(reason);
    requireTitle(data);
    next = appendCsvRow(csv, meta, fields);
  }
  if (!(await write(next))) throw new Error(`Couldn't save ${ref.path.split('/').pop()}.`);
}

/** A number as a stat shows it: whole numbers plain, others to two places at most. */
export function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
