// What Neuron keeps about a CSV it manages: column types, select options and
// view settings, in `.neuron/tables/<path of the csv>.json`. That file existing
// is what makes the CSV managed. Its content is untrusted like everything in a
// workspace, so reading it validates every field and never throws.
//
// Cell values are always the CSV's text; a column's type only changes how a
// cell is shown and edited.

import { OPTION_COLORS, type DbOption } from './db';

export { OPTION_COLORS };

export type CsvColumnType = 'text' | 'number' | 'checkbox' | 'date' | 'url' | 'select';
export const CSV_COLUMN_TYPES: { value: CsvColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Select' },
];

export interface CsvColumnMeta {
  type: CsvColumnType;
  options?: DbOption[];
}

export interface CsvViewState {
  sortBy: string | null;
  sortDir: 'asc' | 'desc';
  filterProp: string | null;
  filterValue: string;
  mode: 'table';
}

export interface CsvTableMeta {
  version: 1;
  /** Keyed by header text. A prototype-free object, so any header name is safe. */
  columns: Record<string, CsvColumnMeta>;
  view: CsvViewState;
}

export const isCsvPath = (path: string) => /\.csv$/i.test(path);
export const tableMetaPath = (csvPath: string) => `.neuron/tables/${csvPath}.json`;

const TYPES = new Set<string>(CSV_COLUMN_TYPES.map((type) => type.value));
const COLOR = /^#[0-9a-f]{3,8}$/i;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export const emptyColumns = (): Record<string, CsvColumnMeta> => Object.create(null);
export const defaultView = (): CsvViewState => ({ sortBy: null, sortDir: 'asc', filterProp: null, filterValue: '', mode: 'table' });
export const emptyMeta = (): CsvTableMeta => ({ version: 1, columns: emptyColumns(), view: defaultView() });

function readOptions(raw: unknown): DbOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options: DbOption[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string') continue;
    // Cells hold option names, so two options with one name could not be told apart.
    if (ids.has(item.id) || names.has(item.name)) continue;
    ids.add(item.id);
    names.add(item.name);
    const color = typeof item.color === 'string' && COLOR.test(item.color) ? item.color : OPTION_COLORS[options.length % OPTION_COLORS.length];
    options.push({ id: item.id, name: item.name, color });
  }
  return options;
}

/**
 * Reads metadata text. Anything invalid is dropped or replaced by its default.
 * With `headers`, columns the file no longer has are dropped too.
 */
export function parseTableMeta(text: string, headers?: readonly string[]): CsvTableMeta {
  const meta = emptyMeta();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return meta; }
  if (!isObject(raw)) return meta;
  const present = headers ? new Set(headers) : null;
  if (isObject(raw.columns)) {
    for (const [name, value] of Object.entries(raw.columns)) {
      if (present && !present.has(name)) continue;
      if (!isObject(value) || typeof value.type !== 'string' || !TYPES.has(value.type)) continue;
      const column: CsvColumnMeta = { type: value.type as CsvColumnType };
      const options = readOptions(value.options);
      if (options) column.options = options;
      else if (column.type === 'select') column.options = [];
      meta.columns[name] = column;
    }
  }
  if (isObject(raw.view)) {
    const view = raw.view;
    const header = (value: unknown) => (typeof value === 'string' && (!present || present.has(value)) ? value : null);
    meta.view = {
      sortBy: header(view.sortBy),
      sortDir: view.sortDir === 'desc' ? 'desc' : 'asc',
      filterProp: header(view.filterProp),
      filterValue: typeof view.filterValue === 'string' ? view.filterValue : '',
      mode: 'table',
    };
  }
  return meta;
}

/** Metadata as written to disk, keeping only the columns the file has. */
export function serializeTableMeta(meta: CsvTableMeta, headers: readonly string[]): string {
  const columns: Record<string, CsvColumnMeta> = emptyColumns();
  for (const header of headers) if (own(meta.columns, header)) columns[header] = meta.columns[header];
  const present = new Set(headers);
  const view: CsvViewState = {
    ...meta.view,
    sortBy: meta.view.sortBy !== null && present.has(meta.view.sortBy) ? meta.view.sortBy : null,
    filterProp: meta.view.filterProp !== null && present.has(meta.view.filterProp) ? meta.view.filterProp : null,
  };
  return JSON.stringify({ version: 1, columns, view }, null, 2) + '\n';
}

export function columnMeta(meta: CsvTableMeta | null, header: string): CsvColumnMeta {
  return meta && own(meta.columns, header) ? meta.columns[header] : { type: 'text' };
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const URL_VALUE = /^https?:\/\/\S+$/i;
const BOOLEAN = /^(?:true|false|yes|no|x)$/i;
const CHECKED = /^(?:true|yes|1|x)$/i;

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

export const isNumberText = (value: string) => NUMBER.test(value);
export const isChecked = (value: string) => CHECKED.test(value.trim());

/** A column is a number, date, checkbox or URL only when every non-empty value fits. */
export function inferColumnType(values: readonly string[]): CsvColumnType {
  const filled = values.filter((value) => value.trim() !== '');
  if (!filled.length) return 'text';
  if (filled.every((value) => NUMBER.test(value))) return 'number';
  if (filled.every(isIsoDate)) return 'date';
  if (filled.every((value) => BOOLEAN.test(value.trim()))) return 'checkbox';
  if (filled.every((value) => URL_VALUE.test(value))) return 'url';
  return 'text';
}

export function inferTableMeta(headers: readonly string[], rows: readonly (readonly string[])[]): CsvTableMeta {
  const meta = emptyMeta();
  headers.forEach((header, index) => {
    meta.columns[header] = { type: inferColumnType(rows.map((row) => row[index] ?? '')) };
  });
  return meta;
}

/** Options for a column turned into a select: its distinct values, in order of appearance. */
export function optionsFromValues(values: readonly string[], makeId: () => string, limit = 50): DbOption[] {
  const names: string[] = [];
  for (const value of values) {
    if (value !== '' && !names.includes(value)) names.push(value);
    if (names.length >= limit) break;
  }
  return names.map((name, index) => ({ id: makeId(), name, color: OPTION_COLORS[index % OPTION_COLORS.length] }));
}

const PAIRS: [string, string][] = [['true', 'false'], ['yes', 'no'], ['1', '0'], ['x', '']];

function matchCase(sample: string, value: string): string {
  if (sample.length > 1 && sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return value.toUpperCase();
  if (sample[0] && sample[0] !== sample[0].toLowerCase()) return value.charAt(0).toUpperCase() + value.slice(1);
  if (sample === 'X') return value.toUpperCase();
  return value;
}

/**
 * The text a checkbox writes, in the column's own words: a column of yes/no
 * stays yes/no. `sample` is the cell's value, or another value from its column.
 */
export function checkboxValue(checked: boolean, sample: string): string {
  const word = sample.trim();
  const lower = word.toLowerCase();
  for (const [on, off] of PAIRS) {
    if (lower === on || (off && lower === off)) return matchCase(word, checked ? on : off);
  }
  return checked ? 'true' : 'false';
}

function compareText(x: string, y: string): number {
  const nx = Number(x), ny = Number(y);
  return x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y);
}

/**
 * Indices of the rows to show, in display order: the filter, then the search
 * across every cell, then the sort. The rows themselves are never reordered.
 */
export function visibleRowIndices(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  meta: CsvTableMeta | null,
  view: CsvViewState,
  search: string,
): number[] {
  let indices = rows.map((_, index) => index);
  const filterColumn = view.filterProp === null ? -1 : headers.indexOf(view.filterProp);
  if (filterColumn >= 0 && view.filterValue) {
    const wanted = view.filterValue.toLowerCase();
    const exact = columnMeta(meta, headers[filterColumn]).type === 'select';
    indices = indices.filter((index) => {
      const value = rows[index][filterColumn] ?? '';
      return exact ? value === view.filterValue : value.toLowerCase().includes(wanted);
    });
  }
  const query = search.trim().toLowerCase();
  if (query) indices = indices.filter((index) => rows[index].some((cell) => cell.toLowerCase().includes(query)));
  const sortColumn = view.sortBy === null ? -1 : headers.indexOf(view.sortBy);
  if (sortColumn >= 0) {
    const checkbox = columnMeta(meta, headers[sortColumn]).type === 'checkbox';
    const dir = view.sortDir === 'desc' ? -1 : 1;
    indices = [...indices].sort((a, b) => {
      const x = rows[a][sortColumn] ?? '', y = rows[b][sortColumn] ?? '';
      return dir * (checkbox ? Number(isChecked(x)) - Number(isChecked(y)) : compareText(x, y));
    });
  }
  return indices;
}
