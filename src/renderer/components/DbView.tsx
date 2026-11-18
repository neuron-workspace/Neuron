import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { boardColumns, MAX_CARDS, parseDb, resolveView, visibleRows, type DbFile, type DbProperty, type DbViewMode } from '../lib/db';
import { BoardColumnHeader, CardLimitNote, Chip, DbCard } from './db/DbCards';

// Read-only inline embed of a .db database inside MDX, via <DbView path="@Foo.db" />.
// It reads the referenced file over the same IPC bridge the DbSurface editor uses
// and re-reads on external change, so an embedded table stays live. Multi-table
// files use the stable map key: <DbView path="@Planner.db" table="tasks" />.
// Without a `view` prop it follows the view saved in the file; the prop only
// overrides the mode.

function normalizeMode(value: string | undefined): DbViewMode | null {
  if (value === undefined) return null;
  const v = value.toLowerCase();
  if (v === 'board' || v === 'kanban') return 'board';
  // "card" and "cards" are the names older notes used for the gallery.
  if (v === 'card' || v === 'cards' || v === 'gallery') return 'gallery';
  return 'table';
}

function cellNodes(prop: DbProperty, value: unknown): React.ReactNode {
  if (value === undefined || value === null || value === '') return <span className="text-[var(--ink-muted)]">—</span>;
  if (prop.type === 'checkbox') return <Checkbox className="shadow-none" checked={!!value} disabled aria-label={prop.name} />;
  if (prop.type === 'url' && typeof value === 'string') {
    return /^https?:\/\//.test(value)
      ? <a href={value} target="_blank" rel="noreferrer" className="text-[var(--md-link)] underline underline-offset-2">{value}</a>
      : value;
  }
  if (prop.type === 'select') {
    const o = prop.options?.find((x) => x.id === value);
    return o ? <Chip option={o} /> : <span className="text-[var(--ink-muted)]">—</span>;
  }
  if (prop.type === 'multiselect') {
    const ids = Array.isArray(value) ? value : [];
    const chips = (prop.options ?? []).filter((o) => ids.includes(o.id));
    return chips.length ? <span className="flex flex-wrap gap-1">{chips.map((o) => <Chip key={o.id} option={o} />)}</span> : <span className="text-[var(--ink-muted)]">—</span>;
  }
  return String(value);
}

/** `table` is the stable key from a v2 file's `tables` map. */
interface DbViewProps { path: string; view?: string; table?: string }

export default function DbView({ path, view, table }: DbViewProps) {
  const rel = path.replace(/^@/, '');
  const modeOverride = normalizeMode(view);
  const [db, setDb] = useState<DbFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'invalid'>('loading');

  useEffect(() => {
    let alive = true;
    const load = () =>
      window.electronAPI.readNote(rel).then((text) => {
        if (!alive) return;
        if (typeof text !== 'string' || text.startsWith('Error:')) { setState('missing'); setDb(null); setParseError(null); return; }
        const parsed = parseDb(text, rel);
        if (parsed.db) { setDb(parsed.db); setParseError(null); setState('ready'); }
        else { setDb(null); setParseError(parsed.error); setState('invalid'); }
      });
    void load();
    const off = window.electronAPI.onNotesChanged((event, changed) => {
      if (changed === rel && event !== 'unlink') void load();
      // A deleted folder arrives as one unlink for the folder itself.
      if (event === 'unlink' && (changed === rel || rel.startsWith(changed + '/'))) { setState('missing'); setDb(null); setParseError(null); }
    });
    return () => { alive = false; off(); };
  }, [rel]);

  const tableIds = db ? Object.keys(db.tables) : [];
  const doc = db ? (table ? db.tables[table] : tableIds.length === 1 ? db.tables[tableIds[0]] : null) : null;
  const selectionError = db && table && !db.tables[table]
    ? `${rel} has no table named "${table}".`
    : db && tableIds.length > 1 && !table
      ? `${rel} contains multiple tables. Add table="${tableIds[0]}" to <DbView />.`
      : null;

  if (state !== 'ready' || !doc || selectionError) {
    const msg = state === 'loading' ? 'Loading database…'
      : state === 'missing' ? `No database found at ${rel}`
      : selectionError ?? parseError ?? `${rel} isn't valid database JSON`;
    return (
      <div className="my-4 flex items-center gap-2 rounded-md border border-[var(--divider)] bg-[var(--surface)] px-3 py-2 font-sans text-xs text-[var(--ink-muted)]" role={state === 'loading' ? 'status' : 'alert'}>
        <Database className="h-3.5 w-3.5 shrink-0" /> {msg}
      </div>
    );
  }

  const { order, properties } = doc.schema;
  const fileTitle = rel.split('/').pop()!.replace(/\.db$/i, '');
  const title = tableIds.length > 1 ? `${fileTitle} / ${doc.name}` : fileTitle;
  const resolved = resolveView(doc);
  const mode = modeOverride ?? resolved.mode;
  const rows = visibleRows(doc);
  const shown = rows.slice(0, MAX_CARDS);

  const header = (
    <div className="mb-2 flex items-center gap-1.5 font-sans text-xs font-medium text-[var(--ink-muted)]">
      <Database className="h-3.5 w-3.5" /> {title}
      <span className="ml-auto">{rows.length === doc.rows.length ? `${rows.length} rows` : `${rows.length} / ${doc.rows.length} rows`}</span>
    </div>
  );

  const board = mode === 'board' ? boardColumns(doc, shown) : null;
  if (board?.groupBy) {
    const groupName = properties[board.groupBy].name;
    return (
      <div className="my-4 font-sans" data-db-embed-mode="board">
        {header}
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {board.columns.filter((column) => column.option || column.rows.length > 0).map((column) => (
            <div key={column.id || '__none'} className="flex w-[272px] shrink-0 flex-col gap-3" role="group" aria-label={column.option?.name ?? `No ${groupName}`}>
              <BoardColumnHeader column={column} groupName={groupName} count={column.rows.length} />
              {column.rows.map((row) => <DbCard key={row.id} table={doc} row={row} view={resolved} variant="board" />)}
            </div>
          ))}
        </div>
        <CardLimitNote total={rows.length} />
      </div>
    );
  }

  if (mode === 'gallery') {
    return (
      <div className="my-4 font-sans" data-db-embed-mode="gallery">
        {header}
        <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
          {shown.map((row) => <DbCard key={row.id} table={doc} row={row} view={resolved} variant="gallery" />)}
        </div>
        <CardLimitNote total={rows.length} />
      </div>
    );
  }

  return (
    <div className="my-4 font-sans" data-db-embed-mode="table">
      {header}
      <div className="overflow-x-auto rounded-md border border-[var(--divider)]">
        <table className="w-full border-collapse text-sm text-[var(--md-text)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              {order.map((pid) => (
                <th key={pid} className="border-b border-[var(--divider)] px-3 py-2 text-left text-xs font-semibold text-[var(--md-heading)]">{properties[pid].name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--divider)] last:border-b-0">
                {order.map((pid) => (
                  <td key={pid} className="px-3 py-2 align-top text-xs leading-5">{cellNodes(properties[pid], row.values[pid])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
