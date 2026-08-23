import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Database, ExternalLink, LayoutGrid, Plus, Settings2, Table2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { addDbTable, drawableRelations, parseDb, serializeDb, updateDbTable, type DbFile, type DbOption, type DbProperty, type DbRow, type DbTable, type PropType } from '@/lib/db';
import { registerSurface, type SurfaceProps } from './index';

// ===========================================================================
// .db files are Notion-style databases: a single JSON document holding the
// property schema (with per-property metadata such as select options and tag
// colors), the persisted view state (sort + filter), and the row records as
// key-value maps keyed by property id. Every edit is serialized straight back
// to the file over the IPC bridge (atomic write in the main process); a file
// watcher picks up external edits and refreshes the table without a reload.
// ===========================================================================

const PROP_TYPES: { value: PropType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Select' },
  { value: 'multiselect', label: 'Multi-select' },
];

const PALETTE = ['#8b8b8b', '#a27763', '#e28f44', '#d9b23c', '#5aa06c', '#528fd1', '#9a6dd7', '#d15796', '#dd5c5c'];

const uid = () => Math.random().toString(36).slice(2, 9);
const isSelectType = (t: string) => t === 'select' || t === 'multiselect';

function starterDoc(tableName: string): DbFile {
  const name = uid(), status = uid(), tags = uid(), done = uid(), due = uid();
  const todo = uid(), doing = uid(), shipped = uid();
  const table: DbTable = {
    name: tableName,
    schema: {
      order: [name, status, tags, due, done],
      properties: {
        [name]: { name: 'Name', type: 'text' },
        [status]: {
          name: 'Status', type: 'select',
          options: [
            { id: todo, name: 'Todo', color: '#8b8b8b' },
            { id: doing, name: 'In progress', color: '#528fd1' },
            { id: shipped, name: 'Shipped', color: '#5aa06c' },
          ],
        },
        [tags]: { name: 'Tags', type: 'multiselect', options: [] },
        [due]: { name: 'Due', type: 'date' },
        [done]: { name: 'Done', type: 'checkbox' },
      }, extra: {},
    },
    view: {},
    rows: [{ id: uid(), values: { [name]: 'First entry', [status]: todo } }],
    extra: {},
    hadView: true,
  };
  return { format: 1, tables: { [tableName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'table']: table }, relations: [], extra: {}, hadRelations: false };
}

function Chip({ option }: { option: DbOption }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: `${option.color}2e`, color: option.color }}>
      {option.name || '…'}
    </span>
  );
}

// Text shown for a cell — used for search matching and sorting.
function displayValue(prop: DbProperty, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (prop.type === 'select') return prop.options?.find((o) => o.id === value)?.name ?? '';
  if (prop.type === 'multiselect') {
    const ids = Array.isArray(value) ? value : [];
    return ids.map((id) => prop.options?.find((o) => o.id === id)?.name ?? '').join(' ');
  }
  return String(value);
}

function SchemaOverview({ db, onOpen }: { db: DbFile; onOpen: (tableId: string) => void }) {
  const ids = Object.keys(db.tables);
  const columns = Math.min(3, ids.length);
  const nodeWidth = 180, nodeHeight = 64, gapX = 80, gapY = 64, pad = 32;
  const positions = new Map(ids.map((id, index) => [id, {
    x: pad + (index % columns) * (nodeWidth + gapX),
    y: pad + Math.floor(index / columns) * (nodeHeight + gapY),
  }]));
  const width = pad * 2 + columns * nodeWidth + Math.max(0, columns - 1) * gapX;
  const rows = Math.ceil(ids.length / columns);
  const height = pad * 2 + rows * nodeHeight + Math.max(0, rows - 1) * gapY;
  const relations = drawableRelations(db).filter((relation) => positions.has(relation.from.table) && positions.has(relation.to.table));

  return (
    <main className="h-full overflow-auto bg-[var(--canvas)] font-sans text-[var(--ink)]">
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="max-w-full overflow-auto" role="group" aria-label="Database schema">
          <div className="relative" style={{ width, height }}>
            <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
              <defs>
                <marker id="db-relation-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--accent)" />
                </marker>
              </defs>
              {relations.map((relation, index) => {
                const from = positions.get(relation.from.table)!;
                const to = positions.get(relation.to.table)!;
                const dx = to.x - from.x, dy = to.y - from.y;
                const horizontal = Math.abs(dx) >= Math.abs(dy);
                const x1 = horizontal ? from.x + (dx > 0 ? nodeWidth : 0) : from.x + nodeWidth / 2;
                const y1 = horizontal ? from.y + nodeHeight / 2 : from.y + (dy > 0 ? nodeHeight : 0);
                const x2 = horizontal ? to.x + (dx > 0 ? 0 : nodeWidth) : to.x + nodeWidth / 2;
                const y2 = horizontal ? to.y + nodeHeight / 2 : to.y + (dy > 0 ? 0 : nodeHeight);
                return (
                  <g key={`${relation.from.table}-${relation.from.property}-${relation.to.table}-${index}`}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#db-relation-arrow)" />
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" fill="var(--ink-muted)" fontSize="11">{db.tables[relation.from.table].schema.properties[relation.from.property]?.name ?? relation.from.property}</text>
                  </g>
                );
              })}
            </svg>
            {ids.map((id) => {
              const table = db.tables[id];
              const pos = positions.get(id)!;
              return (
                <button
                  key={id}
                  type="button"
                  className="interactive absolute flex flex-col justify-center rounded-md border border-[var(--divider)] bg-[var(--surface)] px-4 text-left hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ left: pos.x, top: pos.y, width: nodeWidth, height: nodeHeight }}
                  onClick={() => onOpen(id)}
                  aria-label={`Open ${table.name} table`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium"><Table2 className="h-3.5 w-3.5 text-[var(--accent-strong)]" />{table.name}</span>
                  <span className="mt-1 font-mono text-[11px] text-[var(--ink-muted)]">{id}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}

export function DbSurface({ path, content }: SurfaceProps) {
  const title = path.split('/').pop()!.replace(/\.db$/i, '');
  const [db, setDbState] = useState<DbFile | null>(null);
  const [selectedTable, setSelectedTableState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editingProp, setEditingProp] = useState<string | null>(null);
  const lastWritten = useRef<string | null>(null);
  const activePath = useRef(path);
  const dbRef = useRef<DbFile | null>(null);
  const selectedTableRef = useRef<string | null>(null);

  const selectTable = (tableId: string | null) => {
    selectedTableRef.current = tableId;
    setSelectedTableState(tableId);
    setEditingProp(null);
    setSearch('');
  };

  const adopt = (next: DbFile | null, nextError: string | null) => {
    dbRef.current = next;
    setDbState(next);
    setError(nextError);
    const ids = next ? Object.keys(next.tables) : [];
    const current = selectedTableRef.current;
    selectTable(ids.length === 1 ? ids[0] : current && next?.tables[current] ? current : null);
  };

  // Adopt file content: initial open, Source-mode edits, anything not our own write.
  useEffect(() => {
    if (activePath.current !== path) {
      activePath.current = path;
      lastWritten.current = null;
      selectedTableRef.current = null;
    }
    if (content === lastWritten.current) return;
    if (!content.trim()) { adopt(null, null); return; }
    const parsed = parseDb(content, title);
    adopt(parsed.db, parsed.error);
  }, [content, path, title]);

  // The app doesn't reload open-note content on disk changes, so watch here:
  // external edits (git pull, sync, another editor) land without a reload.
  useEffect(() => {
    return window.electronAPI.onNotesChanged((event, changed) => {
      if (changed !== path || event === 'unlink') return;
      void window.electronAPI.readNote(path).then((text) => {
        if (text.startsWith('Error:') || text === lastWritten.current) return;
        const parsed = parseDb(text, title);
        adopt(parsed.db, parsed.error);
      });
    });
  }, [path, title]);

  // stage: update UI while typing; write: serialize the whole doc to disk.
  const stageDb = (next: DbFile) => { dbRef.current = next; setDbState(next); };
  const writeDb = (next: DbFile) => {
    stageDb(next);
    const text = serializeDb(next);
    lastWritten.current = text;
    void window.electronAPI.writeNote(path, text);
  };
  const replaceTable = (next: DbTable) => updateDbTable(dbRef.current!, selectedTableRef.current!, next);
  const stage = (next: DbTable) => stageDb(replaceTable(next));
  const write = (next: DbTable) => writeDb(replaceTable(next));
  const d = () => dbRef.current!.tables[selectedTableRef.current!]!;
  const flush = () => { if (dbRef.current && selectedTableRef.current) write(d()); };
  const doc = selectedTable && db?.tables[selectedTable] ? db.tables[selectedTable] : null;

  // --- Row + cell mutations --------------------------------------------------
  const setCell = (rowId: string, propId: string, value: unknown, commit = true) => {
    const next = { ...d(), rows: d().rows.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [propId]: value } } : r)) };
    (commit ? write : stage)(next);
  };
  const addRow = () => write({ ...d(), rows: [...d().rows, { id: uid(), values: {} }] });
  const deleteRow = (rowId: string) => write({ ...d(), rows: d().rows.filter((r) => r.id !== rowId) });

  // --- Schema mutations --------------------------------------------------------
  const patchProp = (propId: string, patch: Partial<DbProperty>, commit = true) => {
    const cur = d();
    const next = { ...cur, schema: { ...cur.schema, properties: { ...cur.schema.properties, [propId]: { ...cur.schema.properties[propId], ...patch } } } };
    (commit ? write : stage)(next);
  };
  const addProperty = () => {
    const id = uid();
    const cur = d();
    write({ ...cur, schema: { ...cur.schema, order: [...cur.schema.order, id], properties: { ...cur.schema.properties, [id]: { name: `Property ${cur.schema.order.length + 1}`, type: 'text' } } } });
    setEditingProp(id);
  };
  const deleteProperty = (propId: string) => {
    const cur = d();
    const properties = { ...cur.schema.properties };
    delete properties[propId];
    write({
      ...cur,
      schema: { ...cur.schema, order: cur.schema.order.filter((id) => id !== propId), properties },
      rows: cur.rows.map((r) => { const values = { ...r.values }; delete values[propId]; return { ...r, values }; }),
      view: { ...cur.view, sortBy: cur.view.sortBy === propId ? null : cur.view.sortBy, filterProp: cur.view.filterProp === propId ? null : cur.view.filterProp },
    });
    setEditingProp(null);
  };
  const moveProperty = (propId: string, delta: -1 | 1) => {
    const order = [...d().schema.order];
    const i = order.indexOf(propId);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    write({ ...d(), schema: { ...d().schema, order } });
  };
  const setType = (propId: string, type: PropType) => {
    const prop = d().schema.properties[propId];
    patchProp(propId, { type, options: isSelectType(type) ? prop.options ?? [] : prop.options });
  };

  // --- Select option mutations --------------------------------------------------
  const setOptions = (propId: string, options: DbOption[], commit = true) => patchProp(propId, { options }, commit);
  const addOption = (propId: string) => {
    const options = d().schema.properties[propId].options ?? [];
    setOptions(propId, [...options, { id: uid(), name: `Option ${options.length + 1}`, color: PALETTE[options.length % PALETTE.length] }]);
  };
  const deleteOption = (propId: string, optionId: string) => {
    const cur = d();
    const prop = cur.schema.properties[propId];
    // Strip the deleted option from every row that references it.
    const rows = cur.rows.map((r) => {
      const v = r.values[propId];
      if (prop.type === 'select' && v === optionId) return { ...r, values: { ...r.values, [propId]: '' } };
      if (prop.type === 'multiselect' && Array.isArray(v) && v.includes(optionId)) return { ...r, values: { ...r.values, [propId]: v.filter((x) => x !== optionId) } };
      return r;
    });
    write({ ...cur, rows, schema: { ...cur.schema, properties: { ...cur.schema.properties, [propId]: { ...prop, options: (prop.options ?? []).filter((o) => o.id !== optionId) } } } });
  };
  const moveOption = (propId: string, optionId: string, delta: -1 | 1) => {
    const options = [...(d().schema.properties[propId].options ?? [])];
    const i = options.findIndex((o) => o.id === optionId);
    const j = i + delta;
    if (j < 0 || j >= options.length) return;
    [options[i], options[j]] = [options[j], options[i]];
    setOptions(propId, options);
  };
  const cycleColor = (propId: string, optionId: string) => {
    const options = (d().schema.properties[propId].options ?? []).map((o) =>
      o.id === optionId ? { ...o, color: PALETTE[(PALETTE.indexOf(o.color) + 1) % PALETTE.length] } : o);
    setOptions(propId, options);
  };

  // --- View state (persisted sort + filter) ---------------------------------
  const setSort = (propId: string) => {
    const { sortBy, sortDir } = d().view;
    const view = sortBy !== propId ? { ...d().view, sortBy: propId, sortDir: 'asc' as const }
      : sortDir === 'asc' ? { ...d().view, sortDir: 'desc' as const }
      : { ...d().view, sortBy: null };
    write({ ...d(), view });
  };
  const setFilter = (filterProp: string | null, filterValue: string, commit = true) => {
    (commit ? write : stage)({ ...d(), view: { ...d().view, filterProp, filterValue } });
  };

  // --- Derived, filtered + sorted rows (all client-side) ---------------------
  const visibleRows = useMemo(() => {
    if (!doc) return [];
    const { order, properties } = doc.schema;
    const q = search.trim().toLowerCase();
    let rows = doc.rows;
    if (q) rows = rows.filter((r) => order.some((pid) => displayValue(properties[pid], r.values[pid]).toLowerCase().includes(q)));
    const { filterProp, filterValue, sortBy, sortDir } = doc.view;
    if (filterProp && properties[filterProp] && filterValue) {
      const fp = properties[filterProp];
      rows = rows.filter((r) => {
        const v = r.values[filterProp];
        if (fp.type === 'select') return v === filterValue;
        if (fp.type === 'multiselect') return Array.isArray(v) && v.includes(filterValue);
        return displayValue(fp, v).toLowerCase().includes(filterValue.toLowerCase());
      });
    }
    if (sortBy && properties[sortBy]) {
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
  }, [doc, search]);

  // --- Cell renderers ---------------------------------------------------------
  function renderCell(row: DbRow, propId: string, prop: DbProperty) {
    const v = row.values[propId];
    if (prop.type === 'checkbox') {
      return <div className="px-1"><Checkbox checked={!!v} onCheckedChange={(c) => setCell(row.id, propId, !!c)} aria-label={prop.name} /></div>;
    }
    if (prop.type === 'date') {
      return <input type="date" className="vw-cell" value={typeof v === 'string' ? v : ''} onChange={(e) => setCell(row.id, propId, e.target.value)} aria-label={prop.name} />;
    }
    if (prop.type === 'select') {
      const selected = prop.options?.find((o) => o.id === v);
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex w-full items-center gap-1 rounded px-1 py-1 text-left hover:bg-[var(--surface-hover)]">
              {selected ? <Chip option={selected} /> : <span className="text-xs text-[var(--ink-muted)]">—</span>}
              <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-[var(--ink-muted)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(prop.options ?? []).map((o) => (
              <DropdownMenuItem key={o.id} onClick={() => setCell(row.id, propId, o.id)}><Chip option={o} /></DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => setCell(row.id, propId, '')}>None</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setEditingProp(propId)}><Settings2 className="h-3.5 w-3.5" /> Edit options…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    if (prop.type === 'multiselect') {
      const ids = Array.isArray(v) ? (v as string[]) : [];
      const selected = (prop.options ?? []).filter((o) => ids.includes(o.id));
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex w-full flex-wrap items-center gap-1 rounded px-1 py-1 text-left hover:bg-[var(--surface-hover)]">
              {selected.length ? selected.map((o) => <Chip key={o.id} option={o} />) : <span className="text-xs text-[var(--ink-muted)]">—</span>}
              <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-[var(--ink-muted)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(prop.options ?? []).map((o) => (
              <DropdownMenuCheckboxItem
                key={o.id}
                checked={ids.includes(o.id)}
                onCheckedChange={(c) => setCell(row.id, propId, c ? [...ids, o.id] : ids.filter((x) => x !== o.id))}
              >
                <Chip option={o} />
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setEditingProp(propId)}><Settings2 className="h-3.5 w-3.5" /> Edit options…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    if (prop.type === 'url') {
      const url = typeof v === 'string' ? v : '';
      return (
        <div className="flex items-center gap-1">
          <input className="vw-cell" value={url} placeholder="https://" onChange={(e) => setCell(row.id, propId, e.target.value, false)} onBlur={flush} aria-label={prop.name} />
          {/^https?:\/\//.test(url) && (
            <a href={url} target="_blank" rel="noreferrer" className="vw-icon-btn shrink-0" title={url} aria-label={`Open ${url}`}><ExternalLink className="h-3 w-3" /></a>
          )}
        </div>
      );
    }
    return (
      <input
        className="vw-cell"
        inputMode={prop.type === 'number' ? 'decimal' : undefined}
        value={v === undefined || v === null ? '' : String(v)}
        onChange={(e) => setCell(row.id, propId, e.target.value, false)}
        onBlur={flush}
        aria-label={prop.name}
      />
    );
  }

  // --- Empty / invalid states -------------------------------------------------
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--ink-muted)]" role="alert">
        <Database className="h-5 w-5" />
        This file isn't valid database JSON. Switch to Source mode to fix it — the table will come back once it parses.
        <span className="max-w-xl text-[var(--ink-secondary)]">{error}</span>
      </div>
    );
  }
  if (!db) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Database className="h-6 w-6 text-[var(--ink-muted)]" />
        <p className="text-sm text-[var(--ink-secondary)]">An empty database. Initialize it with a starter schema — everything is customizable afterwards.</p>
        <Button onClick={() => { const next = starterDoc(title); writeDb(next); selectTable(Object.keys(next.tables)[0]); }}><Plus className="h-4 w-4" /> Initialize database</Button>
      </div>
    );
  }

  if (Object.keys(db.tables).length > 1 && !doc) return <SchemaOverview db={db} onOpen={selectTable} />;
  if (!doc) return null;

  const { order, properties } = doc.schema;
  const { filterProp, filterValue, sortBy, sortDir } = doc.view;
  const editing = editingProp && properties[editingProp] ? editingProp : null;
  const filterPropDef = filterProp ? properties[filterProp] : undefined;

  // --- View modes: table (edit-everything), board (kanban by a select), gallery
  const mode = doc.view.mode ?? 'table';
  const selectProps = order.filter((pid) => properties[pid].type === 'select');
  const groupBy = doc.view.groupBy && properties[doc.view.groupBy]?.type === 'select' ? doc.view.groupBy : selectProps[0];
  const titleProp = order.find((pid) => properties[pid].type === 'text') ?? order[0];
  const setMode = (m: 'table' | 'board' | 'gallery') => write({ ...d(), view: { ...d().view, mode: m } });

  // Compact read-only rendering of secondary properties on board/gallery cards.
  const cardMeta = (row: DbRow, skip: string[]) => order.filter((pid) => !skip.includes(pid)).map((pid) => {
    const prop = properties[pid];
    const v = row.values[pid];
    if (prop.type === 'select') { const o = prop.options?.find((x) => x.id === v); return o ? <Chip key={pid} option={o} /> : null; }
    if (prop.type === 'multiselect') {
      const ids = Array.isArray(v) ? v : [];
      return (prop.options ?? []).filter((o) => ids.includes(o.id)).map((o) => <Chip key={`${pid}-${o.id}`} option={o} />);
    }
    if (prop.type === 'date' && typeof v === 'string' && v) return <span key={pid} className="text-[11px] text-[var(--ink-muted)]">{v}</span>;
    if (prop.type === 'checkbox' && v) return <span key={pid} className="flex items-center gap-0.5 text-[11px] text-[var(--ink-muted)]"><Check className="h-3 w-3" />{prop.name}</span>;
    return null;
  });

  const board = groupBy && (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {[...(properties[groupBy].options ?? []), null].map((option) => {
        const colId = option?.id ?? '';
        const colRows = visibleRows.filter((r) => (r.values[groupBy] ?? '') === colId);
        return (
          <div
            key={colId || '__none'}
            className="w-64 shrink-0 rounded-lg bg-[var(--surface)] p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { const rid = e.dataTransfer.getData('text/neuron-row'); if (rid) setCell(rid, groupBy, colId); }}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              {option ? <Chip option={option} /> : <span className="text-xs text-[var(--ink-muted)]">No {properties[groupBy].name.toLowerCase()}</span>}
              <span className="ml-auto text-[11px] text-[var(--ink-muted)]">{colRows.length}</span>
            </div>
            <div className="space-y-1.5">
              {colRows.map((row) => (
                <div
                  key={row.id}
                  className="cursor-grab rounded-md bg-[var(--canvas)] p-2.5 active:cursor-grabbing"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/neuron-row', row.id)}
                >
                  <div className="text-sm text-[var(--ink)]">{String(row.values[titleProp] ?? '') || 'Untitled'}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">{cardMeta(row, [groupBy, titleProp])}</div>
                </div>
              ))}
            </div>
            <button type="button" className="vw-newrow" onClick={() => { const id = uid(); write({ ...d(), rows: [...d().rows, { id, values: { [groupBy]: colId } }] }); }}>
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>
        );
      })}
    </div>
  );

  const gallery = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {visibleRows.map((row) => (
        <div key={row.id} className="rounded-lg bg-[var(--surface)] p-3">
          <div className="text-sm font-medium text-[var(--ink)]">{String(row.values[titleProp] ?? '') || 'Untitled'}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1">{cardMeta(row, [titleProp])}</div>
        </div>
      ))}
    </div>
  );
  const tableCount = Object.keys(db.tables).length;
  const addTable = () => {
    const next = addDbTable(dbRef.current!, `Table ${tableCount + 1}`);
    writeDb(next.db);
    selectTable(null);
  };

  return (
    <main className="font-sans h-full overflow-auto bg-[var(--canvas)] text-[var(--ink)]">
      <div className="mx-auto max-w-6xl px-6 py-6 vw-content space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {tableCount > 1 && <Button variant="ghost" size="sm" onClick={() => selectTable(null)} aria-label="Back to schema overview"><ArrowLeft /> Schema</Button>}
          <h1 className="mr-auto flex items-center gap-2 text-base font-semibold tracking-tight"><Database className="h-4 w-4 text-[var(--accent-strong)]" /> {doc.name}</h1>
          <Button variant="outline" size="sm" onClick={addTable}><Plus /> Table</Button>
          <div className="mode-switch" aria-label="View mode">
            <button type="button" aria-pressed={mode === 'table'} className="interactive flex items-center gap-1 text-xs font-medium" onClick={() => setMode('table')}><Table2 className="h-3.5 w-3.5" /> Table</button>
            <button type="button" aria-pressed={mode === 'board'} className="interactive flex items-center gap-1 text-xs font-medium disabled:opacity-40" disabled={!groupBy} title={groupBy ? undefined : 'Add a Select property to use the board'} onClick={() => setMode('board')}><Columns3 className="h-3.5 w-3.5" /> Board</button>
            <button type="button" aria-pressed={mode === 'gallery'} className="interactive flex items-center gap-1 text-xs font-medium" onClick={() => setMode('gallery')}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
          </div>
          {mode === 'board' && selectProps.length > 1 && (
            <select className="field h-8 px-2 text-xs" value={groupBy ?? ''} onChange={(e) => write({ ...d(), view: { ...d().view, groupBy: e.target.value } })} aria-label="Group by">
              {selectProps.map((pid) => <option key={pid} value={pid}>{properties[pid].name}</option>)}
            </select>
          )}
          <input className="field h-8 w-44 px-2.5 text-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search rows" />
          <select
            className="field h-8 px-2 text-xs"
            value={filterProp ?? ''}
            onChange={(e) => setFilter(e.target.value || null, '')}
            aria-label="Filter property"
          >
            <option value="">No filter</option>
            {order.map((pid) => <option key={pid} value={pid}>{properties[pid].name}</option>)}
          </select>
          {filterProp && filterPropDef && (isSelectType(filterPropDef.type) ? (
            <select className="field h-8 px-2 text-xs" value={filterValue ?? ''} onChange={(e) => setFilter(filterProp, e.target.value)} aria-label="Filter value">
              <option value="">Any</option>
              {(filterPropDef.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : (
            <input className="field h-8 w-36 px-2.5 text-xs" placeholder="Contains…" value={filterValue ?? ''} onChange={(e) => setFilter(filterProp, e.target.value, false)} onBlur={flush} aria-label="Filter value" />
          ))}
          <span className="text-xs text-[var(--ink-muted)]">{visibleRows.length} / {doc.rows.length} rows</span>
        </div>

        {editing && (
          <div className="rounded-lg bg-[var(--surface)] p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[var(--ink-muted)]">Property</span>
              <input className="field h-8 w-40 px-2.5 text-xs" value={properties[editing].name} onChange={(e) => patchProp(editing, { name: e.target.value }, false)} onBlur={flush} aria-label="Property name" />
              <select className="field h-8 px-2 text-xs" value={properties[editing].type} onChange={(e) => setType(editing, e.target.value as PropType)} aria-label="Property type">
                {PROP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <button type="button" className="vw-icon-btn" onClick={() => moveProperty(editing, -1)} title="Move left" aria-label="Move property left"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <button type="button" className="vw-icon-btn" onClick={() => moveProperty(editing, 1)} title="Move right" aria-label="Move property right"><ChevronRight className="h-3.5 w-3.5" /></button>
              <button type="button" className="vw-icon-btn hover:text-[var(--danger)]" onClick={() => deleteProperty(editing)} title="Delete property" aria-label="Delete property"><Trash2 className="h-3.5 w-3.5" /></button>
              <button type="button" className="vw-icon-btn ml-auto" onClick={() => setEditingProp(null)} title="Close" aria-label="Close property editor"><X className="h-3.5 w-3.5" /></button>
            </div>
            {isSelectType(properties[editing].type) && (
              <div className="space-y-1">
                {(properties[editing].options ?? []).map((o) => (
                  <div key={o.id} className="flex items-center gap-1.5">
                    <button type="button" className="h-4 w-4 shrink-0 rounded-full" style={{ background: o.color }} onClick={() => cycleColor(editing, o.id)} title="Change color" aria-label={`Change color of ${o.name}`} />
                    <input
                      className="field h-7 w-40 px-2 text-xs"
                      value={o.name}
                      onChange={(e) => setOptions(editing, (properties[editing].options ?? []).map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)), false)}
                      onBlur={flush}
                      aria-label="Option name"
                    />
                    <button type="button" className="vw-icon-btn" onClick={() => moveOption(editing, o.id, -1)} title="Move up" aria-label={`Move ${o.name} up`}><ArrowUp className="h-3 w-3" /></button>
                    <button type="button" className="vw-icon-btn" onClick={() => moveOption(editing, o.id, 1)} title="Move down" aria-label={`Move ${o.name} down`}><ArrowDown className="h-3 w-3" /></button>
                    <button type="button" className="vw-icon-btn hover:text-[var(--danger)]" onClick={() => deleteOption(editing, o.id)} title="Delete option" aria-label={`Delete ${o.name}`}><Trash2 className="h-3 w-3" /></button>
                    <Chip option={o} />
                  </div>
                ))}
                <button type="button" className="vw-newrow" onClick={() => addOption(editing)}><Plus className="h-3.5 w-3.5" /> Add option</button>
              </div>
            )}
          </div>
        )}

        {mode === 'board' ? board : mode === 'gallery' ? gallery : (
        <div className="overflow-auto">
          <table className="vw-db">
            <thead>
              <tr>
                <th className="vw-db-gutter" />
                {order.map((pid) => (
                  <th key={pid} className="group/h min-w-[8rem]">
                    <div className="flex items-center gap-1">
                      <input className="vw-cell font-medium text-[var(--ink-muted)]" value={properties[pid].name} onChange={(e) => patchProp(pid, { name: e.target.value }, false)} onBlur={flush} aria-label="Column name" />
                      <button type="button" className="vw-icon-btn opacity-0 group-hover/h:opacity-100" onClick={() => setSort(pid)} title="Sort" aria-label={`Sort by ${properties[pid].name}`}>
                        {sortBy === pid ? (sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3" />}
                      </button>
                      <button type="button" className="vw-icon-btn opacity-0 group-hover/h:opacity-100" onClick={() => setEditingProp(pid)} title="Property settings" aria-label={`Settings for ${properties[pid].name}`}>
                        <Settings2 className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                ))}
                <th className="vw-db-gutter">
                  <button type="button" className="vw-icon-btn" onClick={addProperty} title="Add property" aria-label="Add property"><Plus className="h-3.5 w-3.5" /></button>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="group/r">
                  <td className="vw-db-gutter">
                    <button type="button" className="vw-icon-btn opacity-0 group-hover/r:opacity-100 hover:text-[var(--danger)]" onClick={() => deleteRow(row.id)} title="Delete row" aria-label="Delete row"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                  {order.map((pid) => <td key={pid}>{renderCell(row, pid, properties[pid])}</td>)}
                  <td className="vw-db-gutter" />
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="vw-newrow" onClick={addRow}><Plus className="h-3.5 w-3.5" /> New row</button>
        </div>
        )}
      </div>
    </main>
  );
}

registerSurface('db', DbSurface);

export default DbSurface;
