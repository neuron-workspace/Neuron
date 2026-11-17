import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Database, ExternalLink, LayoutGrid, Plus, Rows3, Settings2, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { BoardColumnHeader, CardLimitNote, Chip, DbCard, cardTitle, columnLabel } from '@/components/db/DbCards';
import { addDbTable, boardColumns, displayValue, drawableRelations, MAX_CARDS, moveRow, parseDb, resolveView, serializeDb, updateDbTable, visibleRows as savedViewRows, type BoardColumn, type DbFile, type DbOption, type DbProperty, type DbRow, type DbTable, type DbViewMode, type PropType } from '@/lib/db';
import { rowWindow } from '@/lib/row-window';
import { Segmented } from '@/components/ui/segmented';
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

const ROW_MIME = 'text/neuron-row';
// Header controls are plain buttons so the app-wide focus ring applies.
const HEADER_BUTTON = 'interactive inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--divider)] px-2.5 text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]';
// `.field` is a full-width 34px form control; the toolbar needs compact ones sized to content.
const TOOL_FIELD_BASE = 'field !min-h-0 !h-8 shrink-0 text-[12px]';
const TOOL_FIELD = `${TOOL_FIELD_BASE} !w-auto px-2`;

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
  const pendingWrite = useRef<string | null>(null);
  const writeSequence = useRef(0);
  const unsaved = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activePath = useRef(path);
  const dbRef = useRef<DbFile | null>(null);
  const selectedTableRef = useRef<string | null>(null);
  // Board and gallery: the row open in the editor dialog, drag state, and the
  // card to focus once a move or a closing dialog has settled.
  const [editRowId, setEditRowId] = useState<string | null>(null);
  // Text properties the row editor shows as a textarea; fixed when it opens so a
  // field does not swap element (and lose focus) as its text crosses the limit.
  const [longProps, setLongProps] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [dropTarget, setDropTargetState] = useState<{ column: string; beforeRowId: string | null } | null>(null);
  const dropTargetRef = useRef<{ column: string; beforeRowId: string | null } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ rowId: string } | null>(null);
  const pendingOpen = useRef<string | null>(null);
  const stagedOnly = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  const selectTable = (tableId: string | null) => {
    // A reload from disk re-selects the same table; keep an open row editor then.
    if (tableId !== selectedTableRef.current) setEditRowId(null);
    selectedTableRef.current = tableId;
    setSelectedTableState(tableId);
    setEditingProp(null);
    setSearch('');
  };

  const adopt = (next: DbFile | null, nextError: string | null) => {
    dbRef.current = next;
    stagedOnly.current = false;
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
      pendingWrite.current = null;
      writeSequence.current++;
      unsaved.current = false;
      setSaveError(null);
      selectedTableRef.current = null;
    }
    if (unsaved.current || content === pendingWrite.current || content === lastWritten.current) return;
    if (!content.trim()) { adopt(null, null); return; }
    const parsed = parseDb(content, title);
    adopt(parsed.db, parsed.error);
  }, [content, path, title]);

  // The app doesn't reload open-note content on disk changes, so watch here:
  // external edits (git pull, sync, another editor) land without a reload.
  useEffect(() => {
    return window.electronAPI.onNotesChanged((event, changed) => {
      if (changed !== path || event === 'unlink') return;
      const sequence = writeSequence.current;
      void window.electronAPI.readNote(path).then((text) => {
        if (activePath.current !== path || sequence !== writeSequence.current || unsaved.current
          || text.startsWith('Error:') || text === pendingWrite.current || text === lastWritten.current) return;
        const parsed = parseDb(text, title);
        adopt(parsed.db, parsed.error);
      });
    });
  }, [path, title]);

  // stage: update UI while typing; write: serialize the whole doc to disk.
  const stageDb = (next: DbFile) => { dbRef.current = next; setDbState(next); };
  const writeDb = async (next: DbFile) => {
    stageDb(next);
    stagedOnly.current = false;
    const text = serializeDb(next);
    const sequence = ++writeSequence.current;
    unsaved.current = true;
    // Watcher IPC can beat the write reply; keep its echo separate from confirmed saves.
    pendingWrite.current = text;
    try {
      const result = await window.electronAPI.writeNote(path, text);
      if (sequence !== writeSequence.current) return;
      pendingWrite.current = null;
      if (result.success) {
        lastWritten.current = text;
        // Only a write in flight or a failed one holds off reloads from disk.
        unsaved.current = false;
        setSaveError(null);
      } else {
        setSaveError(result.error ?? 'Unknown error');
      }
    } catch (error) {
      if (sequence !== writeSequence.current) return;
      pendingWrite.current = null;
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };
  const replaceTable = (next: DbTable) => updateDbTable(dbRef.current!, selectedTableRef.current!, next);
  const stage = (next: DbTable) => { stageDb(replaceTable(next)); stagedOnly.current = true; };
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
  // The saved filter and sort, then this session's search on top.
  const visibleRows = useMemo(() => {
    if (!doc) return [];
    const { order, properties } = doc.schema;
    const q = search.trim().toLowerCase();
    const rows = savedViewRows(doc);
    return q ? rows.filter((r) => order.some((pid) => displayValue(properties[pid], r.values[pid]).toLowerCase().includes(q))) : rows;
  }, [doc, search]);
  const view = useMemo(() => (doc ? resolveView(doc) : null), [doc]);

  const tableScroll = useRef<HTMLDivElement>(null);
  const measuredHeight = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, viewportHeight: 0, rowHeight: 36 });
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const virtual = visibleRows.length >= 200 && view?.mode === 'table';

  // Focus a card after the render that moved it, and after Radix has finished
  // returning focus from a closing menu or dialog (it does so on a zero timeout).
  useEffect(() => {
    if (!focusRequest) return;
    const timer = window.setTimeout(() => {
      mainRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(focusRequest.rowId)}"]`)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusRequest]);

  useLayoutEffect(() => {
    const container = tableScroll.current;
    if (!container || !virtual) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const firstRow = container.querySelector<HTMLTableRowElement>('tbody tr[data-row-id]');
      if (measuredHeight.current === null && firstRow) {
        measuredHeight.current = firstRow.getBoundingClientRect().height || 36;
      }
      const headerHeight = container.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      setViewport({
        scrollTop: Math.max(0, container.scrollTop - headerHeight),
        viewportHeight: container.clientHeight,
        rowHeight: measuredHeight.current ?? 36,
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    container.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    return () => {
      container.removeEventListener('scroll', schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [virtual, visibleRows]);

  useLayoutEffect(() => {
    if (tableScroll.current) tableScroll.current.scrollTop = 0;
    setViewport((current) => ({ ...current, scrollTop: 0 }));
  }, [search, doc?.view.filterProp, doc?.view.filterValue, selectedTable, path]);

  const windowRows = rowWindow({ ...viewport, count: visibleRows.length, overscan: 10 });
  const focusedIndex = focusedRow === null ? -1 : visibleRows.findIndex((row) => row.id === focusedRow);
  // Keep the editor and its Tab neighbours mounted without filling a distant gap.
  // The last focused row stays pinned after focus leaves the table: at most three
  // extra rows, and Tab into the next row never finds it unmounted.
  const pinnedRows = focusedIndex < 0 ? [] : [focusedIndex - 1, focusedIndex, focusedIndex + 1]
    .filter((index) => index >= 0 && index < visibleRows.length && (index < windowRows.start || index >= windowRows.end));
  const renderedIndices = virtual
    ? [...pinnedRows, ...Array.from({ length: windowRows.end - windowRows.start }, (_, index) => windowRows.start + index)].sort((a, b) => a - b)
    : visibleRows.map((_, index) => index);

  // --- Cell renderers ---------------------------------------------------------
  // The option editor sits above the table, behind the row dialog, so close the dialog first.
  const editOptions = (propId: string) => { setEditRowId(null); setEditingProp(propId); };
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
            <DropdownMenuItem onClick={() => editOptions(propId)}><Settings2 className="h-3.5 w-3.5" /> Edit options…</DropdownMenuItem>
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
            <DropdownMenuItem onClick={() => editOptions(propId)}><Settings2 className="h-3.5 w-3.5" /> Edit options…</DropdownMenuItem>
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
  const saveNotice = saveError && (
    <div role="alert" className="flex items-center gap-3 border-b border-[var(--divider)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--danger)]">
      {/* Retry first: the message carries a full path, and a long one pushed the
          button under the floating graph. */}
      <button type="button" className="interactive shrink-0 rounded px-2 py-1 font-medium hover:bg-[var(--surface-hover)]" onClick={() => { if (dbRef.current) void writeDb(dbRef.current); }}>Retry</button>
      <span className="min-w-0 truncate" title={saveError}>Couldn't save {path.split(/[\\/]/).pop()}: {saveError}</span>
    </div>
  );

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

  if (Object.keys(db.tables).length > 1 && !doc) return (
    <div className="flex h-full flex-col">
      {saveNotice}
      <div className="min-h-0 flex-1"><SchemaOverview db={db} onOpen={selectTable} /></div>
    </div>
  );
  if (!doc) return null;

  const { order, properties } = doc.schema;
  const { filterProp, filterValue, sortBy, sortDir } = doc.view;
  const editing = editingProp && properties[editingProp] ? editingProp : null;
  const filterPropDef = filterProp ? properties[filterProp] : undefined;

  // --- View modes: table (edit-everything), board (kanban by a select), gallery
  const resolved = view!;
  const mode = resolved.mode;
  const selectProps = order.filter((pid) => properties[pid].type === 'select');
  const groupBy = resolved.groupBy;
  const sorted = !!resolved.sortBy;
  const setMode = (m: DbViewMode) => write({ ...d(), view: { ...d().view, mode: m } });
  const setSortBy = (propId: string | null) => write({ ...d(), view: { ...d().view, sortBy: propId } });
  const flipSortDir = () => write({ ...d(), view: { ...d().view, sortDir: d().view.sortDir === 'desc' ? 'asc' : 'desc' } });

  const announce = (message: string) => {
    // Clearing first makes a repeated message ("Moved up" twice) be read again.
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 50);
  };
  const focusCard = (rowId: string) => setFocusRequest({ rowId });
  const openRow = (rowId: string) => {
    const table = d();
    const row = table.rows.find((r) => r.id === rowId);
    const { previewProp } = resolveView(table);
    setLongProps(table.schema.order.filter((pid) => {
      if (table.schema.properties[pid].type !== 'text') return false;
      const value = row?.values[pid];
      return pid === previewProp || (typeof value === 'string' && (value.length > 60 || value.includes('\n')));
    }));
    setConfirmDelete(false);
    setEditRowId(rowId);
  };
  const addCard = (values: Record<string, unknown>) => {
    const id = uid();
    write({ ...d(), rows: [...d().rows, { id, values }] });
    openRow(id);
  };
  const flushStaged = () => { if (stagedOnly.current && dbRef.current && selectedTableRef.current) void write(d()); };
  const closeEditor = () => { flushStaged(); setEditRowId(null); setConfirmDelete(false); };
  const cardKeyDown = (rowId: string) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    openRow(rowId);
  };

  // --- Card properties and preview (shared by board and gallery) -------------
  const toggleCardProp = (propId: string, on: boolean) => {
    // Start from the stored list, stale entries included, so they stay in the file.
    const stored = Array.isArray(d().view.cardProps) ? d().view.cardProps! : resolveView(d()).cardProps;
    const cardProps = on ? (stored.includes(propId) ? stored : [...stored, propId]) : stored.filter((id) => id !== propId);
    write({ ...d(), view: { ...d().view, cardProps } });
  };
  const setPreviewProp = (propId: string | null) => write({ ...d(), view: { ...d().view, previewProp: propId } });
  const textProps = order.filter((pid) => properties[pid].type === 'text' && pid !== resolved.titleProp);
  const cardPropsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={HEADER_BUTTON}><SlidersHorizontal className="h-3.5 w-3.5" /> Card properties</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
        <DropdownMenuLabel>Show on cards</DropdownMenuLabel>
        {order.filter((pid) => pid !== resolved.titleProp).map((pid) => (
          <DropdownMenuCheckboxItem
            key={pid}
            checked={resolved.cardProps.includes(pid)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => toggleCardProp(pid, !!checked)}
          >
            {properties[pid].name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Preview</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={resolved.previewProp ?? ''} onValueChange={(value) => setPreviewProp(value || null)}>
          {textProps.map((pid) => <DropdownMenuRadioItem key={pid} value={pid}>{properties[pid].name}</DropdownMenuRadioItem>)}
          <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // --- Board ------------------------------------------------------------------
  const addStatusProperty = () => {
    const id = uid();
    const cur = d();
    const options: DbOption[] = [
      { id: uid(), name: 'Todo', color: '#8b8b8b' },
      { id: uid(), name: 'In progress', color: '#528fd1' },
      { id: uid(), name: 'Done', color: '#5aa06c' },
    ];
    write({
      ...cur,
      schema: { ...cur.schema, order: [...cur.schema.order, id], properties: { ...cur.schema.properties, [id]: { name: 'Status', type: 'select', options } } },
      view: { ...cur.view, groupBy: id },
    });
  };

  const board = mode === 'board' && groupBy ? boardColumns(doc, visibleRows) : null;
  const groupName = groupBy ? properties[groupBy].name : '';
  // Past the card limit only the first MAX_CARDS rows in display order are drawn;
  // column counts still say how many each column holds.
  const drawn = visibleRows.length > MAX_CARDS ? new Set(visibleRows.slice(0, MAX_CARDS).map((r) => r.id)) : null;

  const setDropTarget = (target: { column: string; beforeRowId: string | null } | null) => {
    const current = dropTargetRef.current;
    if (current?.column === target?.column && current?.beforeRowId === target?.beforeRowId) return;
    dropTargetRef.current = target;
    setDropTargetState(target);
  };
  const endDrag = () => { setDragRowId(null); setDropTarget(null); };
  const isRowDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(ROW_MIME);

  /** Move a card, then keep focus on it and say where it went. */
  const moveCard = (rowId: string, column: BoardColumn, beforeRowId: string | null | undefined, message: string) => {
    const cur = d();
    const next = moveRow(cur, rowId, { group: column.id, beforeRowId });
    if (next === cur) return;
    write(next);
    focusCard(rowId);
    announce(message);
  };
  const dropOn = (e: React.DragEvent, column: BoardColumn) => {
    e.preventDefault();
    const rowId = e.dataTransfer.getData(ROW_MIME);
    const target = dropTargetRef.current?.column === column.id ? dropTargetRef.current : null;
    endDrag();
    if (!rowId || !board) return;
    let before: string | null | undefined = sorted || !target ? undefined : target.beforeRowId;
    // Dropping a card just above or below itself changes nothing in the column;
    // skip it rather than reshuffle rows the column does not show.
    const index = column.rows.findIndex((r) => r.id === rowId);
    if (index >= 0 && (before === rowId || before === (column.rows[index + 1]?.id ?? null))) before = undefined;
    const from = board.columns.find((c) => c.rows.some((r) => r.id === rowId));
    moveCard(rowId, column, before, from?.id === column.id ? 'Moved' : `Moved to ${columnLabel(column, groupName)}`);
  };

  const boardView = mode === 'board' && (!groupBy ? (
    <div className="flex flex-col items-start gap-2 py-6 text-sm text-[var(--ink-secondary)]">
      <p>Add a select property to group cards into columns.</p>
      <button type="button" className={HEADER_BUTTON} onClick={addStatusProperty}><Plus className="h-3.5 w-3.5" /> Add Status property</button>
    </div>
  ) : board && (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {sorted && (
        <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span>Sorted by {properties[resolved.sortBy!].name}</span>
          <button type="button" className={HEADER_BUTTON} onClick={() => setSortBy(null)}>Clear sort</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2" role="list" aria-label={`Board grouped by ${groupName}`}>
        {board.columns.filter((column) => column.option || column.rows.length > 0 || dragRowId !== null).map((column) => {
          const rows = drawn ? column.rows.filter((r) => drawn.has(r.id)) : column.rows;
          const label = columnLabel(column, groupName);
          const targeted = dropTarget?.column === column.id;
          // The insertion line sits in the 12px between cards so it never moves them.
          const line = (edge: string) => <div aria-hidden="true" data-drop-line className={`pointer-events-none absolute inset-x-0.5 ${edge} h-0.5 rounded-full bg-[var(--accent)]`} />;
          return (
            <div
              key={column.id || '__none'}
              role="listitem"
              aria-label={label}
              data-board-column={column.id}
              className={`flex w-[272px] shrink-0 flex-col rounded-lg ${targeted && sorted ? 'bg-[var(--surface)]' : ''}`}
              onDragOver={(e) => { if (!isRowDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget({ column: column.id, beforeRowId: null }); }}
              onDrop={(e) => dropOn(e, column)}
            >
              <BoardColumnHeader column={column} groupName={groupName} count={column.rows.length}>
                <button type="button" className="vw-icon-btn" onClick={() => addCard(column.id ? { [groupBy]: column.id } : {})} title={`New card in ${label}`} aria-label={`New card in ${label}`}>
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </BoardColumnHeader>
              <div className="min-h-[3rem] flex-1 overflow-y-auto px-1 pb-1">
                {targeted && !sorted && rows.length === 0 && <div className="relative mt-1">{line('top-0')}</div>}
                {rows.map((row, index) => {
                  const lineBefore = targeted && !sorted && dropTarget!.beforeRowId === row.id && row.id !== dragRowId;
                  const lineAfter = targeted && !sorted && dropTarget!.beforeRowId === null && index === rows.length - 1;
                  return (
                    <div
                      key={row.id}
                      className="relative py-1.5"
                      onDragOver={(e) => {
                        if (!isRowDrag(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        const box = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > box.top + box.height / 2;
                        setDropTarget({ column: column.id, beforeRowId: after ? rows[index + 1]?.id ?? null : row.id });
                      }}
                    >
                      {lineBefore && line('-top-px')}
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <DbCard
                            table={doc}
                            row={row}
                            view={resolved}
                            variant="board"
                            interactive
                            draggable
                            className={dragRowId === row.id ? 'opacity-50' : undefined}
                            onClick={() => openRow(row.id)}
                            onKeyDown={cardKeyDown(row.id)}
                            onDragStart={(e) => {
                              e.dataTransfer.setData(ROW_MIME, row.id);
                              e.dataTransfer.effectAllowed = 'move';
                              // Re-rendering inside dragstart (the "No" column appears) can cancel the drag in Chromium.
                              window.setTimeout(() => setDragRowId(row.id), 0);
                            }}
                            onDragEnd={endDrag}
                          />
                        </ContextMenuTrigger>
                        <ContextMenuContent
                          onCloseAutoFocus={(e) => {
                            e.preventDefault();
                            if (pendingOpen.current === row.id) { pendingOpen.current = null; openRow(row.id); } else focusCard(row.id);
                          }}
                        >
                          <ContextMenuItem onSelect={() => { pendingOpen.current = row.id; }}>Open</ContextMenuItem>
                          <ContextMenuItem disabled={sorted || index === 0} onSelect={() => moveCard(row.id, column, rows[index - 1]?.id, 'Moved up')}>Move up</ContextMenuItem>
                          <ContextMenuItem disabled={sorted || index === rows.length - 1} onSelect={() => moveCard(row.id, column, rows[index + 2]?.id ?? null, 'Moved down')}>Move down</ContextMenuItem>
                          <ContextMenuSeparator />
                          {board.columns.filter((other) => other.id !== column.id).map((other) => (
                            <ContextMenuItem key={other.id || '__none'} onSelect={() => moveCard(row.id, other, undefined, `Moved to ${columnLabel(other, groupName)}`)}>
                              Move to {columnLabel(other, groupName)}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuContent>
                      </ContextMenu>
                      {lineAfter && line('-bottom-px')}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <CardLimitNote total={visibleRows.length} />
    </div>
  ));

  // --- Gallery ----------------------------------------------------------------
  const galleryView = mode === 'gallery' && (
    <div className="space-y-2">
      <div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {visibleRows.slice(0, MAX_CARDS).map((row) => (
          <DbCard
            key={row.id}
            table={doc}
            row={row}
            view={resolved}
            variant="gallery"
            interactive
            onClick={() => openRow(row.id)}
            onKeyDown={cardKeyDown(row.id)}
          />
        ))}
        <button
          type="button"
          className="interactive flex min-h-[5rem] items-center justify-center gap-1.5 rounded-lg text-xs text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          onClick={() => addCard({})}
          aria-label="New card"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>
      <CardLimitNote total={visibleRows.length} />
    </div>
  );

  // --- Row editor ---------------------------------------------------------------
  const editRow = editRowId ? doc.rows.find((r) => r.id === editRowId) : undefined;
  const deleteEditedRow = () => {
    if (!editRow) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    deleteRow(editRow.id);
    setEditRowId(null);
    setConfirmDelete(false);
    announce('Row deleted');
  };
  const rowEditor = (
    <Dialog open={!!editRow} onOpenChange={(open) => { if (!open) closeEditor(); }}>
      {editRow && (
        <DialogContent
          className="max-h-[85vh] max-w-xl overflow-y-auto bg-[var(--canvas)] shadow-none"
          onCloseAutoFocus={(e) => { e.preventDefault(); focusCard(editRow.id); }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-start gap-2 break-words leading-snug">
              <Rows3 className="mt-[3px] h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
              <span className="min-w-0">{cardTitle(resolved, editRow) || 'Untitled'}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Every property of this row. Changes save as you make them.</DialogDescription>
          </DialogHeader>
          {/* One child only: `.vw-content > * + *` adds a top margin to every later child. */}
          <div className="vw-content">
            <div className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] items-start gap-x-3 gap-y-1 text-[13px]" data-row-editor={editRow.id}>
              {order.map((pid) => (
                <Fragment key={pid}>
                  <span className="flex min-h-8 min-w-0 items-center text-[12px] text-[var(--ink-muted)]" title={properties[pid].name}>
                    <span className="truncate">{properties[pid].name}</span>
                  </span>
                  <div className="flex min-h-8 min-w-0 items-center [&>*]:min-w-0 [&>*]:flex-1">
                    {longProps.includes(pid) && properties[pid].type === 'text'
                      ? <textarea
                          className="vw-cell my-0.5 resize-none leading-[18px]"
                          // Grows with its text from 3 to 10 lines, then scrolls.
                          style={{ fieldSizing: 'content', minHeight: 'calc(3 * 18px + 0.6rem)', maxHeight: 'calc(10 * 18px + 0.6rem)', overflowY: 'auto' } as React.CSSProperties}
                          value={editRow.values[pid] == null ? '' : String(editRow.values[pid])}
                          onChange={(e) => setCell(editRow.id, pid, e.target.value, false)}
                          onBlur={flush}
                          aria-label={properties[pid].name}
                        />
                      : renderCell(editRow, pid, properties[pid])}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
          <DialogFooter className="sm:justify-start">
            <button
              type="button"
              className="interactive inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--danger)] hover:bg-[var(--surface-hover)]"
              onClick={deleteEditedRow}
              onBlur={() => setConfirmDelete(false)}
            >
              <Trash2 className="h-3.5 w-3.5" /> {confirmDelete ? 'Click again to delete' : 'Delete row'}
            </button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );

  const tableCount = Object.keys(db.tables).length;
  const addTable = () => {
    const next = addDbTable(dbRef.current!, `Table ${tableCount + 1}`);
    writeDb(next.db);
    selectTable(null);
  };

  // The virtual table and the board size themselves to the pane and scroll inside it.
  const fill = virtual || (mode === 'board' && !!groupBy);

  return (
    <main ref={mainRef} className={`font-sans h-full ${fill ? 'overflow-hidden' : 'overflow-auto'} bg-[var(--canvas)] text-[var(--ink)]`}>
      {saveNotice}
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {rowEditor}
      <div className={`mx-auto max-w-6xl px-6 py-6 vw-content space-y-3 ${fill ? 'flex h-full min-h-0 flex-col' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          {tableCount > 1 && <Button variant="ghost" size="sm" onClick={() => selectTable(null)} aria-label="Back to schema overview"><ArrowLeft /> Schema</Button>}
          <h1 className="mr-auto flex items-center gap-2 text-base font-semibold tracking-tight"><Database className="h-4 w-4 text-[var(--accent-strong)]" /> {doc.name}</h1>
          <Button variant="outline" size="sm" onClick={addTable}><Plus /> Table</Button>
          <Segmented
            label="View mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'table', label: 'Table', icon: <Table2 className="h-3.5 w-3.5" /> },
              { value: 'board', label: 'Board', icon: <Columns3 className="h-3.5 w-3.5" /> },
              { value: 'gallery', label: 'Gallery', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${TOOL_FIELD_BASE} !w-full min-w-[10rem] max-w-[280px] flex-1 px-2.5`} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search rows" />
          {mode === 'board' && selectProps.length > 1 && (
            <select className={TOOL_FIELD} value={groupBy ?? ''} onChange={(e) => write({ ...d(), view: { ...d().view, groupBy: e.target.value } })} aria-label="Group by">
              {selectProps.map((pid) => <option key={pid} value={pid}>{properties[pid].name}</option>)}
            </select>
          )}
          <select className={TOOL_FIELD} value={resolved.sortBy ?? ''} onChange={(e) => setSortBy(e.target.value || null)} aria-label="Sort property">
            <option value="">No sort</option>
            {order.map((pid) => <option key={pid} value={pid}>{properties[pid].name}</option>)}
          </select>
          {sorted && (
            <button type="button" className={HEADER_BUTTON} onClick={flipSortDir} aria-label={resolved.sortDir === 'desc' ? 'Sort descending' : 'Sort ascending'} title="Change sort direction">
              {resolved.sortDir === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </button>
          )}
          <select className={TOOL_FIELD} value={filterProp ?? ''} onChange={(e) => setFilter(e.target.value || null, '')} aria-label="Filter property">
            <option value="">No filter</option>
            {order.map((pid) => <option key={pid} value={pid}>{properties[pid].name}</option>)}
          </select>
          {filterProp && filterPropDef && (isSelectType(filterPropDef.type) ? (
            <select className={TOOL_FIELD} value={filterValue ?? ''} onChange={(e) => setFilter(filterProp, e.target.value)} aria-label="Filter value">
              <option value="">Any</option>
              {(filterPropDef.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : (
            <input className={`${TOOL_FIELD_BASE} !w-36 px-2.5`} placeholder="Contains…" value={filterValue ?? ''} onChange={(e) => setFilter(filterProp, e.target.value, false)} onBlur={flush} aria-label="Filter value" />
          ))}
          {mode !== 'table' && cardPropsMenu}
          <span className="ml-auto whitespace-nowrap text-[12px] text-[var(--ink-muted)]">{visibleRows.length} / {doc.rows.length} rows</span>
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

        {mode === 'board' ? boardView : mode === 'gallery' ? galleryView : (
        <div ref={tableScroll} data-db-scroll className={`overflow-auto ${virtual ? 'min-h-0 flex-1' : ''}`} style={virtual ? { overflowAnchor: 'none' } : undefined}>
          <table className="vw-db" aria-rowcount={visibleRows.length + 1}>
            <thead>
              <tr aria-rowindex={1}>
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
              {renderedIndices.map((index, position) => {
                const row = visibleRows[index];
                const previous = position === 0 ? -1 : renderedIndices[position - 1];
                const padding = (index - previous - 1) * viewport.rowHeight;
                return (
                  <Fragment key={row.id}>
                  {virtual && (position === 0 || padding > 0) && (
                    <tr aria-hidden="true" style={{ border: 0 }}><td colSpan={order.length + 2} style={{ height: padding, padding: 0, border: 0 }} /></tr>
                  )}
                  <tr data-row-id={row.id} aria-rowindex={index + 2} className="group/r"
                    style={virtual ? { height: viewport.rowHeight } : undefined}
                    // Never cleared on blur: moving to the next row fires blur first,
                    // and a render in between unmounted that row before it got focus.
                    onFocusCapture={() => setFocusedRow(row.id)}
                  >
                    <td className="vw-db-gutter">
                      <button type="button" className="vw-icon-btn opacity-0 group-hover/r:opacity-100 hover:text-[var(--danger)]" onClick={() => deleteRow(row.id)} title="Delete row" aria-label="Delete row"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                    {order.map((pid) => <td key={pid}>{virtual
                      ? <div style={{ height: viewport.rowHeight - 5, overflow: 'hidden' }}>{renderCell(row, pid, properties[pid])}</div>
                      : renderCell(row, pid, properties[pid])}</td>)}
                    <td className="vw-db-gutter" />
                  </tr>
                  </Fragment>
                );
              })}
              {virtual && (
                <tr aria-hidden="true" style={{ border: 0 }}><td colSpan={order.length + 2} style={{ height: (visibleRows.length - (renderedIndices.at(-1) ?? -1) - 1) * viewport.rowHeight, padding: 0, border: 0 }} /></tr>
              )}
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
