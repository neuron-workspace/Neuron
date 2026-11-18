import { useEffect, useRef, useState } from 'react';
import { Database } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import { boardColumns, MAX_CARDS, moveRow, parseDb, resolveView, serializeDb, updateDbTable, visibleRows, type BoardColumn, type DbFile, type DbProperty, type DbRow, type DbTable, type DbViewMode } from '../lib/db';
import { BoardColumnHeader, CardLimitNote, Chip, columnLabel, DbCard } from './db/DbCards';
import { SelectCell, useFileWriter } from './db/table-kit';

// Inline embed of a .db database inside MDX, via <DbView path="@Foo.db" />.
// It reads the referenced file over the same IPC bridge the DbSurface editor uses
// and re-reads on external change, so an embedded table stays live. Multi-table
// files use the stable map key: <DbView path="@Planner.db" table="tasks" />.
// Without a `view` prop it follows the view saved in the file; the prop only
// overrides the mode. With `editable`, cells, board moves and checkboxes are
// changed in place and written through the same writer as the database surface;
// without it the embed is read-only.

const ROW_MIME = 'application/x-neuron-dbview-row';

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

/** A text, number or URL cell that saves when it loses focus or on Enter. */
function TextCell({ value, label, type, onCommit }: { value: unknown; label: string; type: string; onCommit: (value: unknown) => void }) {
  const text = value === undefined || value === null ? '' : String(value);
  const commit = (next: string) => {
    if (next === text) return;
    if (type === 'number') onCommit(next.trim() === '' || Number.isNaN(Number(next)) ? undefined : Number(next));
    else onCommit(next);
  };
  return (
    <input
      key={text}
      className={`vw-cell ${type === 'number' ? 'text-right tabular-nums' : ''}`}
      defaultValue={text}
      inputMode={type === 'number' ? 'decimal' : undefined}
      aria-label={label}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') { e.currentTarget.value = text; e.currentTarget.blur(); }
      }}
    />
  );
}

/** `table` is the stable key from a v2 file's `tables` map. */
interface DbViewProps { path: string; view?: string; table?: string; editable?: boolean }

export default function DbView({ path, view, table, editable = false }: DbViewProps) {
  const rel = path.replace(/^@/, '');
  const modeOverride = normalizeMode(view);
  const [db, setDb] = useState<DbFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'invalid'>('loading');
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const writer = useFileWriter(rel);
  const dbRef = useRef<DbFile | null>(null);
  const ignores = useRef(writer.ignores);
  ignores.current = writer.ignores;

  useEffect(() => {
    let alive = true;
    const adopt = (next: DbFile | null) => { dbRef.current = next; setDb(next); };
    const load = (fromWatcher: boolean) =>
      window.electronAPI.readNote(rel).then((text) => {
        if (!alive) return;
        if (typeof text !== 'string' || text.startsWith('Error:')) { setState('missing'); adopt(null); setParseError(null); return; }
        // Our own write coming back must not replace an edit made since.
        if (fromWatcher && ignores.current(text)) return;
        const parsed = parseDb(text, rel);
        if (parsed.db) { adopt(parsed.db); setParseError(null); setState('ready'); }
        else { adopt(null); setParseError(parsed.error); setState('invalid'); }
      });
    void load(false);
    const off = window.electronAPI.onNotesChanged((event, changed) => {
      if (changed === rel && event !== 'unlink') void load(true);
      // A deleted folder arrives as one unlink for the folder itself.
      if (event === 'unlink' && (changed === rel || rel.startsWith(changed + '/'))) { setState('missing'); adopt(null); setParseError(null); }
    });
    return () => { alive = false; off(); };
  }, [rel]);

  const tableIds = db ? Object.keys(db.tables) : [];
  const tableId = db ? (table ? (db.tables[table] ? table : null) : tableIds.length === 1 ? tableIds[0] : null) : null;
  const doc = db && tableId ? db.tables[tableId] : null;
  const selectionError = db && table && !db.tables[table]
    ? `${rel} has no table named "${table}".`
    : db && tableIds.length > 1 && !table
      ? `${rel} contains multiple tables. Add table="${tableIds[0]}" to <DbView />.`
      : null;

  if (state !== 'ready' || !doc || !tableId || selectionError) {
    const msg = state === 'loading' ? 'Loading database…'
      : state === 'missing' ? `No database found at ${rel}`
      : selectionError ?? parseError ?? `${rel} isn't valid database JSON`;
    return (
      <div className="my-4 flex items-center gap-2 rounded-md border border-[var(--divider)] bg-[var(--surface)] px-3 py-2 font-sans text-xs text-[var(--ink-muted)]" role={state === 'loading' ? 'status' : 'alert'}>
        <Database className="h-3.5 w-3.5 shrink-0" /> {msg}
      </div>
    );
  }

  // Edits apply to the latest table, not the one this render closed over.
  const current = () => dbRef.current?.tables[tableId] ?? doc;
  const write = (next: DbTable) => {
    if (!editable || !dbRef.current) return;
    const nextDb = updateDbTable(dbRef.current, tableId, next);
    dbRef.current = nextDb;
    setDb(nextDb);
    void writer.write(serializeDb(nextDb));
  };
  const setCell = (rowId: string, propId: string, value: unknown) => {
    const t = current();
    write({ ...t, rows: t.rows.map((r) => {
      if (r.id !== rowId) return r;
      const values = { ...r.values };
      if (value === undefined) delete values[propId]; else values[propId] = value;
      return { ...r, values };
    }) });
  };
  const moveTo = (rowId: string, column: BoardColumn) => {
    const t = current();
    const next = moveRow(t, rowId, { group: column.id });
    if (next !== t) write(next);
  };

  const { order, properties } = doc.schema;
  const fileTitle = rel.split('/').pop()!.replace(/\.db$/i, '');
  const title = tableIds.length > 1 ? `${fileTitle} / ${doc.name}` : fileTitle;
  const resolved = resolveView(doc);
  const mode = modeOverride ?? resolved.mode;
  const rows = visibleRows(doc);
  const shown = rows.slice(0, MAX_CARDS);
  const rowTitle = (row: DbRow) => (resolved.titleProp ? String(row.values[resolved.titleProp] ?? '').trim() : '') || 'Untitled';
  const tick = order.find((pid) => properties[pid].type === 'checkbox');

  // Clicks and double-clicks inside an editable embed are edits, not a request
  // to jump to the note's source or to switch the note into Live.
  const stop = editable ? { onClick: (e: React.MouseEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() } : {};
  const saveError = editable && writer.saveError
    ? <div role="alert" className="mb-2 text-xs text-[var(--danger)]">Couldn't save {fileTitle}: {writer.saveError}</div>
    : null;

  const header = (
    <div className="mb-2 flex items-center gap-1.5 font-sans text-xs font-medium text-[var(--ink-muted)]">
      <Database className="h-3.5 w-3.5" /> {title}
      <span className="ml-auto">{rows.length === doc.rows.length ? `${rows.length} rows` : `${rows.length} / ${doc.rows.length} rows`}</span>
    </div>
  );

  /** A card, with its task checkbox and moves when the embed is editable. */
  const card = (row: DbRow, variant: 'board' | 'gallery', columns?: BoardColumn[], from?: BoardColumn) => {
    const plain = <DbCard table={doc} row={row} view={resolved} variant={variant} />;
    if (!editable) return <div key={row.id}>{plain}</div>;
    const body = (
      <div
        key={row.id}
        className={`relative ${dragRow === row.id ? 'opacity-50' : ''}`}
        draggable={!!columns}
        onDragStart={columns ? (e) => {
          e.dataTransfer.setData(ROW_MIME, row.id);
          e.dataTransfer.effectAllowed = 'move';
          window.setTimeout(() => setDragRow(row.id), 0);
        } : undefined}
        onDragEnd={() => { setDragRow(null); setDropColumn(null); }}
      >
        {tick && (
          <span className="absolute right-2.5 top-2.5 z-[1] flex">
            <Checkbox
              checked={row.values[tick] === true}
              onCheckedChange={(checked) => setCell(row.id, tick, checked === true)}
              aria-label={`${properties[tick].name}: ${rowTitle(row)}`}
            />
          </span>
        )}
        <DbCard table={doc} row={row} view={resolved} variant={variant} className={tick ? 'pr-8' : undefined} />
      </div>
    );
    if (!columns || !from) return body;
    const groupName = properties[resolved.groupBy!].name;
    return (
      <ContextMenu key={row.id}>
        <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
        <ContextMenuContent>
          {columns.filter((other) => other.id !== from.id).map((other) => (
            <ContextMenuItem key={other.id || '__none'} onSelect={() => moveTo(row.id, other)}>Move to {columnLabel(other, groupName)}</ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const board = mode === 'board' ? boardColumns(doc, shown) : null;
  if (board?.groupBy) {
    const groupName = properties[board.groupBy].name;
    return (
      <div className="my-4 font-sans" data-db-embed-mode="board" data-db-embed-editable={editable || undefined} {...stop}>
        {header}
        {saveError}
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {board.columns.filter((column) => column.option || column.rows.length > 0 || dragRow !== null).map((column) => (
            <div
              key={column.id || '__none'}
              className={`flex w-[272px] shrink-0 flex-col gap-3 rounded-lg ${dropColumn === column.id ? 'bg-[var(--surface-hover)]' : ''}`}
              role="group"
              aria-label={column.option?.name ?? `No ${groupName}`}
              data-board-column={column.id}
              onDragOver={editable ? (e) => {
                if (!e.dataTransfer.types.includes(ROW_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropColumn(column.id);
              } : undefined}
              onDragLeave={editable ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropColumn(null); } : undefined}
              onDrop={editable ? (e) => {
                e.preventDefault();
                const rowId = e.dataTransfer.getData(ROW_MIME);
                setDragRow(null);
                setDropColumn(null);
                if (rowId) moveTo(rowId, column);
              } : undefined}
            >
              <BoardColumnHeader column={column} groupName={groupName} count={column.rows.length} />
              {column.rows.map((row) => card(row, 'board', board.columns, column))}
            </div>
          ))}
        </div>
        <CardLimitNote total={rows.length} />
      </div>
    );
  }

  if (mode === 'gallery') {
    return (
      <div className="my-4 font-sans" data-db-embed-mode="gallery" data-db-embed-editable={editable || undefined} {...stop}>
        {header}
        {saveError}
        <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}>
          {shown.map((row) => card(row, 'gallery'))}
        </div>
        <CardLimitNote total={rows.length} />
      </div>
    );
  }

  const cell = (row: DbRow, pid: string) => {
    const prop = properties[pid];
    const value = row.values[pid];
    if (!editable) return cellNodes(prop, value);
    const label = `${prop.name}: ${rowTitle(row)}`;
    if (prop.type === 'checkbox') return <Checkbox className="shadow-none" checked={value === true} onCheckedChange={(checked) => setCell(row.id, pid, checked === true)} aria-label={label} />;
    if (prop.type === 'select') {
      const options = prop.options ?? [];
      return <SelectCell options={options} selected={options.find((o) => o.id === value)} onPick={(o) => setCell(row.id, pid, o.id)} onClear={() => setCell(row.id, pid, undefined)} />;
    }
    if (prop.type === 'date') {
      return <input type="date" className="vw-cell" value={typeof value === 'string' ? value : ''} aria-label={label} onChange={(e) => setCell(row.id, pid, e.target.value || undefined)} />;
    }
    if (prop.type === 'multiselect') return cellNodes(prop, value);
    return <TextCell value={value} label={label} type={prop.type} onCommit={(next) => setCell(row.id, pid, next)} />;
  };

  return (
    <div className="my-4 font-sans" data-db-embed-mode="table" data-db-embed-editable={editable || undefined} {...stop}>
      {header}
      {saveError}
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
              <tr key={row.id} data-row-id={row.id} className="border-b border-[var(--divider)] last:border-b-0">
                {order.map((pid) => (
                  <td key={pid} className={`${editable ? 'px-1.5 py-1' : 'px-3 py-2'} align-top text-xs leading-5`}>{cell(row, pid)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
