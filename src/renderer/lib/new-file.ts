import { parseDb, serializeDb } from './db';
import { serializeCanvas } from '../canvas/model';
import { NEW_TABLE_DIALECT, serializeCsv } from './csv';
import { inferTableMeta, serializeTableMeta, tableMetaPath } from './csv-table';

/** What "New ..." can make. HTML views are offered by their own command only. */
export type NewFileKind = 'note' | 'database' | 'canvas' | 'table';

export const NEW_FILE_KINDS: Record<NewFileKind, { label: string; ext: string }> = {
  note: { label: 'Note', ext: '.md' },
  database: { label: 'Database', ext: '.db' },
  canvas: { label: 'Canvas', ext: '.canvas' },
  table: { label: 'Table', ext: '.csv' },
};

const STARTING_DATABASE = {
  version: 2,
  tables: {
    table: { name: 'Table', schema: { order: ['name'], properties: { name: { name: 'Name', type: 'text' } } }, rows: [] },
  },
};

/** One table with a Name column, written the way the database surface writes files. */
export function startingDatabase(): string {
  const { db } = parseDb(JSON.stringify(STARTING_DATABASE), 'Untitled.db');
  return serializeDb(db!);
}

export function startingCanvas(): string {
  return serializeCanvas({ nodes: [], edges: [], extra: {} });
}

const TABLE_HEADERS = ['Name'];

export function startingContent(kind: NewFileKind): string | undefined {
  if (kind === 'database') return startingDatabase();
  if (kind === 'canvas') return startingCanvas();
  if (kind === 'table') return serializeCsv(TABLE_HEADERS, [], NEW_TABLE_DIALECT);
  return undefined;
}

/**
 * Files written alongside a new file. A table Neuron creates is managed from
 * the start, which is what its metadata file says.
 */
export function startingCompanions(kind: NewFileKind, path: string): { path: string; content: string }[] {
  if (kind === 'table') return [{ path: tableMetaPath(path), content: serializeTableMeta(inferTableMeta(TABLE_HEADERS, []), TABLE_HEADERS) }];
  return [];
}
