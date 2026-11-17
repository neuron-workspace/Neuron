import { parseDb, serializeDb } from './db';
import { serializeCanvas } from '../canvas/model';

/** What "New ..." can make. HTML views are offered by their own command only. */
export type NewFileKind = 'note' | 'database' | 'canvas';

export const NEW_FILE_KINDS: Record<NewFileKind, { label: string; ext: string }> = {
  note: { label: 'Note', ext: '.md' },
  database: { label: 'Database', ext: '.db' },
  canvas: { label: 'Canvas', ext: '.canvas' },
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

export function startingContent(kind: NewFileKind): string | undefined {
  if (kind === 'database') return startingDatabase();
  if (kind === 'canvas') return startingCanvas();
  return undefined;
}
