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

export interface DbViewState {
  mode?: 'table' | 'board' | 'gallery';
  groupBy?: string | null;
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
  filterProp?: string | null;
  filterValue?: string;
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

/** Relations valid enough to draw. Targets/properties deliberately need not exist. */
export function drawableRelations(db: DbFile): DbRelation[] {
  return db.relations.filter((value): value is DbRelation =>
    isObject(value) && isObject(value.from) && isObject(value.to)
    && typeof value.from.table === 'string' && typeof value.from.property === 'string'
    && typeof value.to.table === 'string');
}
