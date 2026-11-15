// Pure .db persistence model. Parsing is deliberately separate from the React
// surfaces so malformed files can never be "repaired" by an editor write.

export const MAX_DB_BYTES = 2 * 1024 * 1024;

export type PropType = 'text' | 'number' | 'checkbox' | 'date' | 'url' | 'select' | 'multiselect';

export interface DbOption {
  id: string;
  name: string;
  color: string;
  [key: string]: unknown;
}

export interface DbProperty {
  name: string;
  type: string;
  options?: DbOption[];
  [key: string]: unknown;
}

export interface DbRow {
  id: string;
  values: Record<string, unknown>;
  [key: string]: unknown;
}

export type DbViewMode = 'table' | 'board' | 'gallery';

export interface DbViewState {
  mode?: DbViewMode;
  groupBy?: string | null;
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
  filterProp?: string | null;
  filterValue?: string;
  /** Properties shown on a board or gallery card, in order. */
  cardProps?: string[];
  /** Text property shown as the card preview; null turns the preview off. */
  previewProp?: string | null;
  [key: string]: unknown;
}

export interface DbSchema {
  order: string[];
  properties: Record<string, DbProperty>;
  /** Unknown schema keys, restored verbatim on serialize. */
  extra: Record<string, unknown>;
}

export interface DbTable {
  name: string;
  schema: DbSchema;
  view: DbViewState;
  rows: DbRow[];
  /** Unknown table keys, restored verbatim on serialize. */
  extra: Record<string, unknown>;
  /** Avoid adding an empty view to a file that never had one. */
  hadView: boolean;
}

export interface DbRelation {
  from: { table: string; property: string; [key: string]: unknown };
  to: { table: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface DbFile {
  format: 1 | 2;
  tables: Record<string, DbTable>;
  /** Relations stay raw so descriptive/dangling/future entries survive edits. */
  relations: unknown[];
  /** Unknown v2 top-level keys, restored verbatim on serialize. */
  extra: Record<string, unknown>;
  hadRelations: boolean;
}

export interface DbParseResult {
  db: DbFile | null;
  error: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const tableIdFor = (name: string): string => {
  const id = name.toLowerCase().replace(/\.db$/i, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return id || 'table';
};

function normalizeTable(raw: Record<string, unknown>, fallbackName: string, v2: boolean): DbTable | string {
  if (!isObject(raw.schema)) return 'Each table needs a schema object.';
  const { order: rawOrder, properties: rawProperties, ...schemaExtra } = raw.schema;
  if (!Array.isArray(rawOrder) || rawOrder.some((id) => typeof id !== 'string')) return 'Schema order must be an array of property ids.';
  if (!isObject(rawProperties)) return 'Schema properties must be an object.';

  const properties: Record<string, DbProperty> = {};
  for (const [id, value] of Object.entries(rawProperties)) {
    if (!isObject(value) || typeof value.name !== 'string' || typeof value.type !== 'string') {
      return `Property "${id}" needs string name and type fields.`;
    }
    if (value.options !== undefined && (!Array.isArray(value.options) || value.options.some((option) =>
      !isObject(option) || typeof option.id !== 'string' || typeof option.name !== 'string' || typeof option.color !== 'string'))) {
      return `Property "${id}" has invalid options.`;
    }
    properties[id] = { ...value } as DbProperty;
  }

  const order = rawOrder.filter((id) => properties[id]);
  for (const id of Object.keys(properties)) if (!order.includes(id)) order.push(id);

  if (!Array.isArray(raw.rows)) return 'Each table needs a rows array.';
  const rows: DbRow[] = [];
  for (const [index, value] of raw.rows.entries()) {
    if (!isObject(value) || typeof value.id !== 'string' || !isObject(value.values)) {
      return `Row ${index + 1} needs a string id and values object.`;
    }
    rows.push({ ...value, values: { ...value.values } } as DbRow);
  }

  if (raw.view !== undefined && !isObject(raw.view)) return 'Table view must be an object.';
  const { schema: _schema, view: _view, rows: _rows, ...extra } = raw;
  if (v2) delete extra.name;
  return {
    name: v2 && typeof raw.name === 'string' && raw.name.trim() ? raw.name : fallbackName,
    schema: { order, properties, extra: schemaExtra },
    view: isObject(raw.view) ? { ...raw.view } as DbViewState : {},
    rows,
    extra,
    hadView: raw.view !== undefined,
  };
}

/** Parse v1 (top-level schema) or D28 v2 without performing any writes. */
export function parseDb(text: string, fileName: string): DbParseResult {
  if (text.length > MAX_DB_BYTES) return { db: null, error: 'Database exceeds the 2 MB size limit.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { db: null, error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isObject(raw)) return { db: null, error: 'A database must be a JSON object.' };

  const displayName = fileName.split(/[\\/]/).pop()?.replace(/\.db$/i, '') || 'Table';
  if ('schema' in raw) {
    const table = normalizeTable(raw, displayName, false);
    if (typeof table === 'string') return { db: null, error: table };
    return {
      db: { format: 1, tables: { [tableIdFor(displayName)]: table }, relations: [], extra: {}, hadRelations: false },
      error: null,
    };
  }

  if (raw.version !== 2 || !isObject(raw.tables)) {
    return { db: null, error: 'A database needs a top-level schema (v1) or version 2 tables.' };
  }
  const tableEntries = Object.entries(raw.tables);
  if (tableEntries.length === 0) return { db: null, error: 'A version 2 database needs at least one table.' };
  const tables: Record<string, DbTable> = {};
  for (const [id, value] of tableEntries) {
    if (!isObject(value)) return { db: null, error: `Table "${id}" must be an object.` };
    const table = normalizeTable(value, id, true);
    if (typeof table === 'string') return { db: null, error: `Table "${id}": ${table}` };
    tables[id] = table;
  }
  if (raw.relations !== undefined && !Array.isArray(raw.relations)) {
    return { db: null, error: 'Relations must be an array.' };
  }
  const { version: _version, tables: _tables, relations: _relations, ...extra } = raw;
  return {
    db: {
      format: 2,
      tables,
      relations: Array.isArray(raw.relations) ? [...raw.relations] : [],
      extra,
      hadRelations: raw.relations !== undefined,
    },
    error: null,
  };
}

function serializeSchema(schema: DbSchema): Record<string, unknown> {
  return { ...schema.extra, order: schema.order, properties: schema.properties };
}

function serializeTable(table: DbTable, includeName: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...table.extra,
    ...(includeName ? { name: table.name } : {}),
    schema: serializeSchema(table.schema),
  };
  if (table.hadView || Object.keys(table.view).length > 0) out.view = table.view;
  out.rows = table.rows;
  return out;
}

/** Serialize in the file's current format; v1 stays v1 until addDbTable upgrades it. */
export function serializeDb(db: DbFile): string {
  if (db.format === 1) return JSON.stringify(serializeTable(Object.values(db.tables)[0], false), null, 2) + '\n';
  const tables = Object.fromEntries(Object.entries(db.tables).map(([id, table]) => [id, serializeTable(table, true)]));
  const out: Record<string, unknown> = { ...db.extra, version: 2, tables };
  if (db.hadRelations || db.relations.length > 0) out.relations = db.relations;
  return JSON.stringify(out, null, 2) + '\n';
}

export function updateDbTable(db: DbFile, tableId: string, table: DbTable): DbFile {
  return { ...db, tables: { ...db.tables, [tableId]: table } };
}

/** Add an empty table, upgrading v1 to v2 as the only migration trigger. */
export function addDbTable(db: DbFile, name: string): { db: DbFile; tableId: string } {
  const base = tableIdFor(name);
  let tableId = base;
  for (let suffix = 2; db.tables[tableId]; suffix++) tableId = `${base}_${suffix}`;
  const table: DbTable = {
    name,
    schema: { order: [], properties: {}, extra: {} },
    view: {},
    rows: [],
    extra: {},
    hadView: false,
  };
  return {
    db: {
      ...db,
      format: 2,
      tables: { ...db.tables, [tableId]: table },
      relations: [...db.relations],
      extra: db.format === 1 ? {} : db.extra,
      hadRelations: db.format === 2 ? db.hadRelations : true,
    },
    tableId,
  };
}

// --- Views -------------------------------------------------------------------
// The stored view is read through resolveView and never rewritten on parse: an
// unknown mode or a key naming a deleted property is ignored here but stays in
// the file, so a newer version of the app still finds what it wrote.

/** Board and gallery draw at most this many cards; the table is virtualised instead. */
export const MAX_CARDS = 300;

export interface ResolvedView {
  mode: DbViewMode;
  groupBy: string | null;
  sortBy: string | null;
  sortDir: 'asc' | 'desc';
  filterProp: string | null;
  filterValue: string;
  titleProp: string | null;
  cardProps: string[];
  previewProp: string | null;
}

export interface BoardColumn {
  /** Option id, or '' for the column of rows with no value. */
  id: string;
  option: DbOption | null;
  rows: DbRow[];
}

const hasProp = (table: DbTable, id: unknown): id is string =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(table.schema.properties, id);

/** Text shown for a cell, used for search, filter and sort. */
export function displayValue(prop: DbProperty, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (prop.type === 'select') return prop.options?.find((o) => o.id === value)?.name ?? '';
  if (prop.type === 'multiselect') {
    const ids = Array.isArray(value) ? value : [];
    return ids.map((id) => prop.options?.find((o) => o.id === id)?.name ?? '').join(' ');
  }
  return String(value);
}

/** A card's title is the first text property in column order. */
export function titleProp(table: DbTable): string | null {
  return table.schema.order.find((id) => table.schema.properties[id].type === 'text') ?? null;
}

function defaultPreviewProp(table: DbTable, title: string | null): string | null {
  const { order, properties } = table.schema;
  for (const id of order) {
    if (id === title || properties[id].type !== 'text') continue;
    const values = table.rows.map((row) => row.values[id]).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (values.length && values.reduce((sum, v) => sum + v.length, 0) / values.length > 40) return id;
  }
  return null;
}

export function resolveView(table: DbTable): ResolvedView {
  const { order, properties } = table.schema;
  const view = table.view;
  const title = titleProp(table);
  const isSelect = (id: unknown): id is string => hasProp(table, id) && properties[id].type === 'select';
  const groupBy = isSelect(view.groupBy) ? view.groupBy : order.find((id) => properties[id].type === 'select') ?? null;
  const previewProp = view.previewProp === null ? null
    : hasProp(table, view.previewProp) && view.previewProp !== title && properties[view.previewProp].type === 'text' ? view.previewProp
    : defaultPreviewProp(table, title);
  const cardProps = Array.isArray(view.cardProps)
    ? view.cardProps.filter((id, index, all): id is string => hasProp(table, id) && id !== title && all.indexOf(id) === index)
    : order.filter((id) => id !== title && id !== groupBy && id !== previewProp).slice(0, 3);
  return {
    mode: view.mode === 'board' || view.mode === 'gallery' ? view.mode : 'table',
    groupBy,
    sortBy: hasProp(table, view.sortBy) ? view.sortBy : null,
    sortDir: view.sortDir === 'desc' ? 'desc' : 'asc',
    filterProp: hasProp(table, view.filterProp) ? view.filterProp : null,
    filterValue: typeof view.filterValue === 'string' ? view.filterValue : '',
    titleProp: title,
    cardProps,
    previewProp,
  };
}

/** Rows after the saved filter and sort, in display order. */
export function visibleRows(table: DbTable): DbRow[] {
  const { properties } = table.schema;
  const { filterProp, filterValue, sortBy, sortDir } = resolveView(table);
  let rows = table.rows;
  if (filterProp && filterValue) {
    const fp = properties[filterProp];
    rows = rows.filter((r) => {
      const v = r.values[filterProp];
      if (fp.type === 'select') return v === filterValue;
      if (fp.type === 'multiselect') return Array.isArray(v) && v.includes(filterValue);
      return displayValue(fp, v).toLowerCase().includes(filterValue.toLowerCase());
    });
  }
  if (sortBy) {
    const sp = properties[sortBy];
    const dir = sortDir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = displayValue(sp, a.values[sortBy]), y = displayValue(sp, b.values[sortBy]);
      const nx = Number(x), ny = Number(y);
      const cmp = x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y);
      return cmp * dir;
    });
  }
  return rows;
}

/**
 * Board columns: first the rows with no value (or a value naming no option),
 * then one column per option in option order. Empty when nothing can group.
 */
export function boardColumns(table: DbTable, rows: DbRow[] = visibleRows(table)): { groupBy: string | null; columns: BoardColumn[] } {
  const { groupBy } = resolveView(table);
  if (!groupBy) return { groupBy: null, columns: [] };
  const options = table.schema.properties[groupBy].options ?? [];
  const none: BoardColumn = { id: '', option: null, rows: [] };
  const columns = options.map((option): BoardColumn => ({ id: option.id, option, rows: [] }));
  const byId = new Map(columns.map((column) => [column.id, column]));
  for (const row of rows) {
    const value = row.values[groupBy];
    ((typeof value === 'string' && byId.get(value)) || none).rows.push(row);
  }
  return { groupBy, columns: [none, ...columns] };
}

/**
 * Move a row to another board column and/or to just before another row in
 * `rows`, the file's only ordering. `beforeRowId: null` moves it to the end.
 * Unknown ids and moves that change nothing return the same table.
 */
export function moveRow(table: DbTable, rowId: string, to: { group?: string; beforeRowId?: string | null }): DbTable {
  const from = table.rows.findIndex((r) => r.id === rowId);
  if (from < 0) return table;
  let row = table.rows[from];
  if (to.group !== undefined) {
    const { groupBy } = resolveView(table);
    if (!groupBy) return table;
    const options = table.schema.properties[groupBy].options ?? [];
    if (to.group !== '' && !options.some((o) => o.id === to.group)) return table;
    const value = row.values[groupBy];
    const current = typeof value === 'string' && options.some((o) => o.id === value) ? value : '';
    if (current !== to.group) row = { ...row, values: { ...row.values, [groupBy]: to.group } };
  }
  const rest = table.rows.filter((r) => r.id !== rowId);
  let at = from;
  if (to.beforeRowId === null) at = rest.length;
  else if (to.beforeRowId !== undefined && to.beforeRowId !== rowId) {
    at = rest.findIndex((r) => r.id === to.beforeRowId);
    if (at < 0) return table;
  }
  if (at === from && row === table.rows[from]) return table;
  rest.splice(at, 0, row);
  return { ...table, rows: rest };
}

/** Relations valid enough to draw. Targets/properties deliberately need not exist. */
export function drawableRelations(db: DbFile): DbRelation[] {
  return db.relations.filter((value): value is DbRelation =>
    isObject(value) && isObject(value.from) && isObject(value.to)
    && typeof value.from.table === 'string' && typeof value.from.property === 'string'
    && typeof value.to.table === 'string');
}
