import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Plus, Settings2, Table2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { HEADER_BUTTON, OptionListEditor, SaveNotice, SelectCell, TOOL_FIELD, TOOL_FIELD_BASE, UrlCell, useFileWriter, useRowVirtualizer } from '@/components/db/table-kit';
import { csvReadOnlyReason, parseCsv, serializeCsv, type CsvDialect } from '@/lib/csv';
import {
  checkboxValue, columnMeta, CSV_COLUMN_TYPES, defaultView, emptyColumns, inferTableMeta, isChecked, isIsoDate, OPTION_COLORS,
  optionsFromValues, parseTableMeta, serializeTableMeta, tableMetaPath, visibleRowIndices,
  type CsvColumnMeta, type CsvColumnType, type CsvTableMeta, type CsvViewState,
} from '@/lib/csv-table';
import type { DbOption } from '@/lib/db';
import { registerSurface, type SurfaceProps } from './index';

// ===========================================================================
// .csv files open as tables. The file stays a plain CSV that other programs
// read; Neuron writes it only when it manages the file, which is when
// `.neuron/tables/<path>.json` exists (a table created here, or one the person
// converted). Every other CSV is shown read-only and is never written: not on
// open, not on sort, not on close. Edits rewrite the whole file through
// serializeCsv with the file's own delimiter, line ends, BOM and quoting.
// ===========================================================================

interface Row { id: string; cells: string[] }

interface TableState {
  headers: string[];
  rows: Row[];
  dialect: CsvDialect;
  /** Writing the file back unchanged would give the same bytes. */
  exact: boolean;
  /** Some header names were empty or repeated and are shown changed. */
  renamed: boolean;
  /** Why the file can only be read, whatever its metadata says. */
  readOnly: string | null;
}

const uid = () => Math.random().toString(36).slice(2, 9);
// The row offered in an empty table; typing in it makes it a real row.
const NEW_ROW = 'new';

/** A textarea reports line breaks as LF; give an edited cell back the breaks it had. */
function keepBreaks(previous: string, edited: string): string {
  if (previous.includes('\r\n') && !/(^|[^\r])\n/.test(previous)) return edited.replace(/\r?\n/g, '\r\n');
  if (previous.includes('\r') && !previous.includes('\n')) return edited.replace(/\r?\n/g, '\r');
  return edited;
}

const copyColumns = (columns: Record<string, CsvColumnMeta>) => {
  const next = emptyColumns();
  for (const key of Object.keys(columns)) next[key] = columns[key];
  return next;
};

export function CsvSurface({ path, content }: SurfaceProps) {
  const fileName = path.split('/').pop()!;
  const title = fileName.replace(/\.csv$/i, '');
  const metaPath = tableMetaPath(path);

  const [table, setTableState] = useState<TableState | null>(null);
  const tableRef = useRef<TableState | null>(null);
  const nextId = useRef(0);
  // null: no metadata file, so the CSV is not Neuron's to write.
  const [meta, setMetaState] = useState<CsvTableMeta | null>(null);
  const metaRef = useRef<CsvTableMeta | null>(null);
  const [metaKnown, setMetaKnown] = useState(false);
  const [localView, setLocalView] = useState<CsvViewState>(defaultView);
  const [search, setSearch] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const [headerDraft, setHeaderDraft] = useState<{ index: number; text: string } | null>(null);
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);
  const staged = useRef(false);
  const renamedOptions = useRef(new Map<string, string>());
  const firstNewCell = useRef<HTMLElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // The text the table was last built from: the same text arriving again (the
  // app's own read of the file) changes nothing and must not drop typing.
  const adoptedText = useRef<string | null>(null);
  const adoptText = (text: string) => {
    if (text === adoptedText.current && tableRef.current) return;
    adoptedText.current = text;
    const parsed = parseCsv(text);
    const next: TableState = {
      headers: parsed.headers,
      rows: parsed.rows.map((cells) => ({ id: String(nextId.current++), cells })),
      dialect: parsed.dialect,
      exact: parsed.exact,
      renamed: parsed.headers.some((header, index) => header !== parsed.rawHeaders[index]),
      readOnly: csvReadOnlyReason(text, parsed.rows.length),
    };
    tableRef.current = next;
    staged.current = false;
    setTableState(next);
  };
  const adoptMeta = (next: CsvTableMeta | null) => { metaRef.current = next; setMetaState(next); };
  const adoptMetaText = (text: string) => adoptMeta(text.startsWith('Error:') ? null : parseTableMeta(text));

  // The path whose text this surface has read for itself. Until then the
  // `content` prop can still be the previously open file's, so it is ignored.
  const loaded = useRef<string | null>(null);
  const adoptChange = (text: string) => { loaded.current = path; adoptText(text); };
  const csv = useFileWriter(path, adoptChange);
  const metaWriter = useFileWriter(metaPath, adoptMetaText);
  const [unreadable, setUnreadable] = useState(false);

  // Adopt file content after the first read: an external change, anything not our own write.
  useEffect(() => {
    if (csv.follow(path)) {
      metaWriter.follow(metaPath);
      setLocalView(defaultView());
      setSearch('');
      setOptionsFor(null);
      setHeaderDraft(null);
    }
    if (loaded.current !== path || csv.ignores(content)) return;
    adoptText(content);
  }, [content, path]);

  useEffect(() => {
    let cancelled = false;
    loaded.current = null;
    tableRef.current = null;
    setTableState(null);
    setMetaKnown(false);
    setUnreadable(false);
    void Promise.all([window.electronAPI.readNote(path), window.electronAPI.readNote(metaPath)]).then(([text, metaText]) => {
      if (cancelled) return;
      adoptMetaText(metaText);
      setMetaKnown(true);
      if (loaded.current === path) return;
      if (/^Error: (Could not read note\.|No workspace is open\.)/.test(text)) { setUnreadable(true); return; }
      adoptChange(text);
    });
    // Deleting the metadata makes the CSV unmanaged again, then and there.
    const unsubscribe = window.electronAPI.onNotesChanged((event, changed) => {
      if (changed === metaPath && event === 'unlink') adoptMeta(null);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [path]);

  const editable = !!meta && !!table && !table.readOnly;
  const canConvert = !meta && !!table && !table.readOnly;
  const view = editable ? meta!.view : localView;

  // --- Writes -----------------------------------------------------------------
  const stageTable = (next: TableState) => { tableRef.current = next; setTableState(next); };
  const writeTable = (next: TableState) => {
    // After this write the file is exactly what serializeCsv makes of it.
    const written = { ...next, exact: true, renamed: false };
    stageTable(written);
    staged.current = false;
    const text = serializeCsv(written.headers, written.rows.map((row) => row.cells), written.dialect);
    adoptedText.current = text;
    void csv.write(text);
  };
  const stageMeta = (next: CsvTableMeta) => adoptMeta(next);
  const writeMeta = (next: CsvTableMeta, headers = tableRef.current?.headers ?? []) => {
    adoptMeta(next);
    return metaWriter.write(serializeTableMeta(next, headers));
  };
  const t = () => tableRef.current!;
  const m = () => metaRef.current!;

  /** Open the conversion question instead of editing. After any menu has handed focus back. */
  const askConvert = () => {
    if (!canConvert) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => setConfirmOpen(true), 0);
  };
  const guarded = <A extends unknown[]>(edit: (...args: A) => void) => (...args: A) => { if (editable) edit(...args); else askConvert(); };

  const convert = async () => {
    const current = t();
    const next = inferTableMeta(current.headers, current.rows.map((row) => row.cells));
    next.view = { ...localView };
    // Only the metadata: the CSV is first written when the person edits it.
    if (await writeMeta(next, current.headers)) setConfirmOpen(false);
  };

  // --- Rows and cells ------------------------------------------------------------
  const setCell = (rowId: string, column: number, value: string, commit = true) => {
    const current = t();
    let rows = current.rows.map((row) => (row.id === rowId ? { ...row, cells: row.cells.map((cell, index) => (index === column ? value : cell)) } : row));
    if (rowId === NEW_ROW && !current.rows.some((row) => row.id === NEW_ROW)) {
      rows = [...rows, { id: NEW_ROW, cells: current.headers.map((_, index) => (index === column ? value : '')) }];
    }
    const next = { ...current, rows };
    if (commit) writeTable(next);
    else { stageTable(next); staged.current = true; }
  };
  const flush = () => { if (staged.current && editable) writeTable(t()); };
  const addRow = guarded(() => {
    const current = t();
    if (!current.headers.length) return;
    writeTable({ ...current, rows: [...current.rows, { id: String(nextId.current++), cells: current.headers.map(() => '') }] });
  });
  const deleteRow = guarded((rowId: string) => writeTable({ ...t(), rows: t().rows.filter((row) => row.id !== rowId) }));

  // --- Columns -------------------------------------------------------------------
  const addColumn = guarded(() => {
    const current = t();
    const taken = new Set(current.headers);
    let n = current.headers.length + 1;
    while (taken.has(`Column ${n}`)) n++;
    const name = `Column ${n}`;
    const headers = [...current.headers, name];
    writeTable({ ...current, headers, rows: current.rows.map((row) => ({ ...row, cells: [...row.cells, ''] })) });
    const columns = copyColumns(m().columns);
    columns[name] = { type: 'text' };
    void writeMeta({ ...m(), columns }, headers);
  });
  const renameColumn = (index: number, text: string) => {
    const current = t();
    const old = current.headers[index];
    if (text.trim() === '' || text === old) return;
    const others = new Set(current.headers.filter((_, j) => j !== index));
    let name = text;
    for (let k = 2; others.has(name); k++) name = `${text} (${k})`;
    const headers = current.headers.map((header, j) => (j === index ? name : header));
    writeTable({ ...current, headers });
    const columns = copyColumns(m().columns);
    if (Object.prototype.hasOwnProperty.call(columns, old)) { columns[name] = columns[old]; delete columns[old]; }
    const v = m().view;
    void writeMeta({ ...m(), columns, view: { ...v, sortBy: v.sortBy === old ? name : v.sortBy, filterProp: v.filterProp === old ? name : v.filterProp } }, headers);
    if (optionsFor === old) setOptionsFor(name);
  };
  const commitHeader = (index: number) => {
    const draft = headerDraft;
    setHeaderDraft(null);
    if (draft && draft.index === index && editable) renameColumn(index, draft.text);
  };
  const deleteColumn = guarded((index: number) => {
    const current = t();
    if (current.headers.length <= 1) return;
    const name = current.headers[index];
    const headers = current.headers.filter((_, j) => j !== index);
    writeTable({ ...current, headers, rows: current.rows.map((row) => ({ ...row, cells: row.cells.filter((_, j) => j !== index) })) });
    const columns = copyColumns(m().columns);
    delete columns[name];
    const v = m().view;
    void writeMeta({ ...m(), columns, view: { ...v, sortBy: v.sortBy === name ? null : v.sortBy, filterProp: v.filterProp === name ? null : v.filterProp } }, headers);
    if (optionsFor === name) setOptionsFor(null);
  });
  const moveColumn = guarded((index: number, delta: -1 | 1) => {
    const current = t();
    const j = index + delta;
    if (j < 0 || j >= current.headers.length) return;
    const swap = <T,>(list: T[]) => { const next = [...list]; [next[index], next[j]] = [next[j], next[index]]; return next; };
    writeTable({ ...current, headers: swap(current.headers), rows: current.rows.map((row) => ({ ...row, cells: swap(row.cells) })) });
  });
  const setColumn = (header: string, column: CsvColumnMeta) => {
    const columns = copyColumns(m().columns);
    columns[header] = column;
    void writeMeta({ ...m(), columns });
  };
  const setType = guarded((index: number, type: CsvColumnType) => {
    const header = t().headers[index];
    const column = columnMeta(m(), header);
    const options = type === 'select' && !column.options?.length
      ? optionsFromValues(t().rows.map((row) => row.cells[index]), uid)
      : column.options;
    setColumn(header, options ? { type, options } : { type });
  });

  // --- Select options ------------------------------------------------------------
  // Cells hold an option's name, so renaming an option renames those cells too:
  // once, when the name is committed, from the name it had before editing began.
  const optionsOf = (header: string) => columnMeta(m(), header).options ?? [];
  const setOptions = (header: string, options: DbOption[], commit = true) => {
    const columns = copyColumns(m().columns);
    columns[header] = { ...columnMeta(m(), header), options };
    if (commit) void writeMeta({ ...m(), columns });
    else stageMeta({ ...m(), columns });
  };
  const renameOption = (header: string, optionId: string, name: string) => {
    const option = optionsOf(header).find((o) => o.id === optionId);
    if (!option) return;
    if (!renamedOptions.current.has(optionId)) renamedOptions.current.set(optionId, option.name);
    setOptions(header, optionsOf(header).map((o) => (o.id === optionId ? { ...o, name } : o)), false);
  };
  const commitOptions = (header: string) => {
    const index = t().headers.indexOf(header);
    let options = optionsOf(header);
    const renames = new Map<string, string>();
    for (const [optionId, before] of renamedOptions.current) {
      const option = options.find((o) => o.id === optionId);
      if (!option || option.name === before) continue;
      const clash = option.name === '' || options.some((o) => o.id !== optionId && o.name === option.name);
      if (clash) options = options.map((o) => (o.id === optionId ? { ...o, name: before } : o));
      else renames.set(before, option.name);
    }
    renamedOptions.current.clear();
    if (renames.size && index >= 0) {
      const current = t();
      writeTable({ ...current, rows: current.rows.map((row) => {
        const value = row.cells[index];
        return renames.has(value) ? { ...row, cells: row.cells.map((cell, j) => (j === index ? renames.get(value)! : cell)) } : row;
      }) });
    }
    setOptions(header, options);
  };
  const addOption = (header: string) => {
    const options = optionsOf(header);
    let n = options.length + 1;
    while (options.some((o) => o.name === `Option ${n}`)) n++;
    setOptions(header, [...options, { id: uid(), name: `Option ${n}`, color: OPTION_COLORS[options.length % OPTION_COLORS.length] }]);
  };
  const moveOption = (header: string, optionId: string, delta: -1 | 1) => {
    const options = [...optionsOf(header)];
    const i = options.findIndex((o) => o.id === optionId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= options.length) return;
    [options[i], options[j]] = [options[j], options[i]];
    setOptions(header, options);
  };
  const cycleColor = (header: string, optionId: string) => setOptions(header, optionsOf(header).map((o) =>
    o.id === optionId ? { ...o, color: OPTION_COLORS[(OPTION_COLORS.indexOf(o.color) + 1) % OPTION_COLORS.length] } : o));
  // The cells keep their text; it simply no longer names an option.
  const deleteOption = (header: string, optionId: string) => setOptions(header, optionsOf(header).filter((o) => o.id !== optionId));

  // --- View: saved in the metadata when managed, for this visit only otherwise ----
  const setView = (patch: Partial<CsvViewState>, commit = true) => {
    if (!editable) { setLocalView((current) => ({ ...current, ...patch })); return; }
    const next = { ...m(), view: { ...m().view, ...patch } };
    if (commit) void writeMeta(next); else stageMeta(next);
  };
  const flushView = () => { if (editable) void writeMeta(m()); };
  const sortBy = (header: string, dir: 'asc' | 'desc') => setView({ sortBy: header, sortDir: dir });
  const cycleSort = (header: string) => (view.sortBy !== header ? setView({ sortBy: header, sortDir: 'asc' })
    : view.sortDir === 'asc' ? setView({ sortDir: 'desc' }) : setView({ sortBy: null }));

  // --- Derived rows ----------------------------------------------------------------
  const visibleRows = useMemo(() => {
    if (!table) return [];
    const cells = table.rows.map((row) => row.cells);
    return visibleRowIndices(table.headers, cells, meta, view, search).map((index) => table.rows[index]);
  }, [table, meta, view, search]);
  const showNewRow = editable && !!table && table.rows.length === 0 && table.headers.length > 0;
  const virtual = visibleRows.length >= 200;
  const { scrollRef, viewport, renderedIndices, setFocusedRow } = useRowVirtualizer(
    visibleRows, (row) => row.id, virtual, [search, view.filterProp, view.filterValue, path]);

  // A table created here opens ready to type in. The menus that create one do
  // not hand focus back to their button, so nothing takes it away again.
  useEffect(() => {
    if (!showNewRow || !metaKnown) return;
    const timer = window.setTimeout(() => firstNewCell.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [showNewRow, metaKnown, path]);

  if (unreadable) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[var(--ink-muted)]" role="alert">Neuron could not read {fileName}.</div>;
  }
  if (!table || !metaKnown) return null;

  const { headers } = table;
  const typeOf = (index: number) => columnMeta(meta, headers[index]).type;

  // Unmanaged cells are read-only inputs: typing, Delete or a paste asks to convert.
  const readOnlyKeys = (e: React.KeyboardEvent) => {
    if (editable) return;
    const typing = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (typing || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); askConvert(); }
  };
  const readOnlyClipboard = (e: React.ClipboardEvent) => { if (!editable) { e.preventDefault(); askConvert(); } };

  function textCell(row: Row, index: number, value: string, extra = '') {
    const label = headers[index];
    const common = {
      'aria-label': label,
      readOnly: !editable,
      onKeyDown: readOnlyKeys,
      onPaste: readOnlyClipboard,
      onCut: readOnlyClipboard,
      onBlur: flush,
      ref: row.id === NEW_ROW && index === 0 ? (node: HTMLElement | null) => { firstNewCell.current = node; } : undefined,
    };
    // An <input> drops line breaks from its value, so a cell that has them gets a textarea.
    if (/[\r\n]/.test(value)) {
      return (
        <textarea
          {...common}
          className={`vw-cell resize-none leading-[18px] ${extra}`}
          rows={Math.min(4, value.split(/\r\n|\r|\n/).length)}
          value={value}
          onChange={(e) => setCell(row.id, index, keepBreaks(value, e.target.value), false)}
        />
      );
    }
    return <input {...common} className={`vw-cell ${extra}`} value={value} onChange={(e) => setCell(row.id, index, e.target.value, false)} />;
  }

  function renderCell(row: Row, index: number) {
    const value = row.cells[index] ?? '';
    const type = typeOf(index);
    const number = type === 'number' ? 'text-right tabular-nums' : '';
    if (!editable) return textCell(row, index, value, number);
    const label = headers[index];
    if (type === 'checkbox') {
      const sample = value || table!.rows.map((r) => r.cells[index]).find((cell) => cell.trim() !== '') || '';
      return <div className="px-1"><Checkbox checked={isChecked(value)} onCheckedChange={(c) => setCell(row.id, index, checkboxValue(!!c, sample))} aria-label={label} /></div>;
    }
    if (type === 'date' && (value === '' || isIsoDate(value))) {
      return <input type="date" className="vw-cell" value={value} onChange={(e) => setCell(row.id, index, e.target.value)} aria-label={label} />;
    }
    if (type === 'url' && !/[\r\n]/.test(value)) {
      return <UrlCell value={value} label={label} onChange={(next) => setCell(row.id, index, next, false)} onBlur={flush} />;
    }
    if (type === 'select') {
      const options = columnMeta(meta, label).options ?? [];
      return (
        <SelectCell
          options={options}
          selected={options.find((o) => o.name === value)}
          fallback={value}
          onPick={(o) => setCell(row.id, index, o.name)}
          onClear={() => setCell(row.id, index, '')}
          onEditOptions={() => setOptionsFor(label)}
        />
      );
    }
    return textCell(row, index, value, number);
  }

  const columnMenu = (index: number) => {
    const header = headers[index];
    const armed = deleteArmed === header;
    return (
      <DropdownMenu onOpenChange={(open) => { if (!open) setDeleteArmed(null); }}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="vw-icon-btn opacity-0 group-hover/h:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" title="Column options" aria-label={`Column options for ${header}`}>
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[70vh] overflow-y-auto">
          <DropdownMenuItem onSelect={() => sortBy(header, 'asc')}><ArrowUp className="h-3.5 w-3.5" /> Sort ascending</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => sortBy(header, 'desc')}><ArrowDown className="h-3.5 w-3.5" /> Sort descending</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Type</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={typeOf(index)} onValueChange={(value) => setType(index, value as CsvColumnType)}>
            {CSV_COLUMN_TYPES.map((type) => <DropdownMenuRadioItem key={type.value} value={type.value}>{type.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {typeOf(index) === 'select' && editable && (
            <DropdownMenuItem onSelect={() => setOptionsFor(header)}><Settings2 className="h-3.5 w-3.5" /> Edit options…</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={index === 0} onSelect={() => moveColumn(index, -1)}><ChevronLeft className="h-3.5 w-3.5" /> Move left</DropdownMenuItem>
          <DropdownMenuItem disabled={index === headers.length - 1} onSelect={() => moveColumn(index, 1)}><ChevronRight className="h-3.5 w-3.5" /> Move right</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={headers.length <= 1}
            className="text-[var(--danger)]"
            onSelect={(e) => {
              if (editable && !armed) { e.preventDefault(); setDeleteArmed(header); return; }
              deleteColumn(index);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> {armed ? 'Click again to delete' : 'Delete column'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const filterType = view.filterProp !== null && headers.includes(view.filterProp) ? columnMeta(meta, view.filterProp).type : null;
  const editingOptions = optionsFor && editable && headers.includes(optionsFor) && columnMeta(meta, optionsFor).type === 'select' ? optionsFor : null;
  const fill = virtual;

  return (
    <main className={`font-sans h-full ${fill ? 'overflow-hidden' : 'overflow-auto'} bg-[var(--canvas)] text-[var(--ink)]`} data-csv-table={editable ? 'managed' : 'read-only'}>
      <SaveNotice error={csv.saveError} path={path} onRetry={() => { if (tableRef.current) writeTable(tableRef.current); }} />
      <SaveNotice error={metaWriter.saveError} path={metaPath} onRetry={() => { if (metaRef.current) void writeMeta(metaRef.current); }} />
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent onCloseAutoFocus={(e) => {
          const target = returnFocus.current;
          returnFocus.current = null;
          if (target?.isConnected) { e.preventDefault(); target.focus(); }
        }}>
          <DialogHeader>
            <DialogTitle>Convert to a Neuron table?</DialogTitle>
            <DialogDescription>
              Neuron will manage this file. Edits are saved to the CSV, and column settings are kept in the .neuron folder. Other programs can still open it.
              {!table.exact && <> Its quoting and line endings will be made consistent the first time you edit it.</>}
              {table.renamed && <> Empty or repeated column names will be saved as they are shown here.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => void convert()}>Convert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className={`mx-auto max-w-6xl px-6 py-6 vw-content space-y-3 ${fill ? 'flex h-full min-h-0 flex-col' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto flex items-center gap-2 text-base font-semibold tracking-tight"><Table2 className="h-4 w-4 text-[var(--accent-strong)]" /> {title}</h1>
          {!table.readOnly && <>
            <Button variant="outline" size="sm" onClick={addRow} disabled={!headers.length} aria-label="Add row"><Plus /> Row</Button>
            <Button variant="outline" size="sm" onClick={addColumn} aria-label="Add column"><Plus /> Column</Button>
          </>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${TOOL_FIELD_BASE} !w-full min-w-[10rem] max-w-[280px] flex-1 px-2.5`} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search rows" />
          <select className={TOOL_FIELD} value={view.sortBy ?? ''} onChange={(e) => setView({ sortBy: e.target.value || null })} aria-label="Sort column">
            <option value="">No sort</option>
            {headers.map((header) => <option key={header} value={header}>{header}</option>)}
          </select>
          {view.sortBy && (
            <button type="button" className={HEADER_BUTTON} onClick={() => setView({ sortDir: view.sortDir === 'desc' ? 'asc' : 'desc' })} aria-label={view.sortDir === 'desc' ? 'Sort descending' : 'Sort ascending'} title="Change sort direction">
              {view.sortDir === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </button>
          )}
          <select className={TOOL_FIELD} value={view.filterProp ?? ''} onChange={(e) => setView({ filterProp: e.target.value || null, filterValue: '' })} aria-label="Filter column">
            <option value="">No filter</option>
            {headers.map((header) => <option key={header} value={header}>{header}</option>)}
          </select>
          {view.filterProp && filterType && (filterType === 'select' ? (
            <select className={TOOL_FIELD} value={view.filterValue} onChange={(e) => setView({ filterValue: e.target.value })} aria-label="Filter value">
              <option value="">Any</option>
              {(columnMeta(meta, view.filterProp).options ?? []).map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
          ) : (
            <input className={`${TOOL_FIELD_BASE} !w-36 px-2.5`} placeholder="Contains…" value={view.filterValue} onChange={(e) => setView({ filterValue: e.target.value }, false)} onBlur={flushView} aria-label="Filter value" />
          ))}
          <span className="ml-auto whitespace-nowrap text-[12px] text-[var(--ink-muted)]">{visibleRows.length} / {table.rows.length} rows</span>
        </div>

        {(table.readOnly || !meta) && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-muted)]" role="status">
            {table.readOnly ?? 'This CSV is read-only. Convert it to a Neuron table to edit it.'}
            {canConvert && <button type="button" className={HEADER_BUTTON} onClick={() => setConfirmOpen(true)}>Convert</button>}
          </div>
        )}

        {editingOptions && (
          <div className="rounded-lg bg-[var(--surface)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--ink-muted)]">Options for {editingOptions}</span>
              <button type="button" className="vw-icon-btn ml-auto" onClick={() => setOptionsFor(null)} title="Close" aria-label="Close option editor"><X className="h-3.5 w-3.5" /></button>
            </div>
            <OptionListEditor
              options={optionsOf(editingOptions)}
              onRename={(optionId, name) => renameOption(editingOptions, optionId, name)}
              onCommit={() => commitOptions(editingOptions)}
              onCycleColor={(optionId) => cycleColor(editingOptions, optionId)}
              onMove={(optionId, delta) => moveOption(editingOptions, optionId, delta)}
              onDelete={(optionId) => deleteOption(editingOptions, optionId)}
              onAdd={() => addOption(editingOptions)}
            />
          </div>
        )}

        <div ref={scrollRef} data-db-scroll className={`overflow-auto ${virtual ? 'min-h-0 flex-1' : ''}`} style={virtual ? { overflowAnchor: 'none' } : undefined}>
          <table className="vw-db" aria-rowcount={visibleRows.length + 1} aria-label={title}>
            <thead>
              <tr aria-rowindex={1}>
                <th className="vw-db-gutter" />
                {headers.map((header, index) => (
                  <th key={`${index}:${header}`} className="group/h min-w-[8rem]">
                    <div className="flex items-center gap-1">
                      <input
                        className={`vw-cell font-medium text-[var(--ink-muted)] ${typeOf(index) === 'number' ? 'text-right' : ''}`}
                        value={headerDraft?.index === index ? headerDraft.text : header}
                        readOnly={!editable}
                        onKeyDown={(e) => { readOnlyKeys(e); if (editable && e.key === 'Enter') e.currentTarget.blur(); }}
                        onPaste={readOnlyClipboard}
                        onCut={readOnlyClipboard}
                        onChange={(e) => setHeaderDraft({ index, text: e.target.value })}
                        onBlur={() => commitHeader(index)}
                        aria-label="Column name"
                      />
                      <button type="button" className="vw-icon-btn opacity-0 group-hover/h:opacity-100 focus-visible:opacity-100" onClick={() => cycleSort(header)} title="Sort" aria-label={`Sort by ${header}`}>
                        {view.sortBy === header ? (view.sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3" />}
                      </button>
                      {columnMenu(index)}
                    </div>
                  </th>
                ))}
                <th className="vw-db-gutter">
                  {!table.readOnly && <button type="button" className="vw-icon-btn" onClick={addColumn} title="Add column" aria-label="Add column at the end"><Plus className="h-3.5 w-3.5" /></button>}
                </th>
              </tr>
            </thead>
            <tbody>
              {(showNewRow ? [0] : renderedIndices).map((index, position) => {
                const row = showNewRow ? { id: NEW_ROW, cells: headers.map(() => '') } : visibleRows[index];
                const previous = position === 0 ? -1 : renderedIndices[position - 1];
                const padding = (index - previous - 1) * viewport.rowHeight;
                return (
                  <Fragment key={row.id}>
                    {virtual && (position === 0 || padding > 0) && (
                      <tr aria-hidden="true" style={{ border: 0 }}><td colSpan={headers.length + 2} style={{ height: padding, padding: 0, border: 0 }} /></tr>
                    )}
                    <tr data-row-id={row.id} aria-rowindex={index + 2} className="group/r"
                      style={virtual ? { height: viewport.rowHeight } : undefined}
                      onFocusCapture={() => setFocusedRow(row.id)}
                    >
                      <td className="vw-db-gutter">
                        {!table.readOnly && !showNewRow && <button type="button" className="vw-icon-btn opacity-0 group-hover/r:opacity-100 focus-visible:opacity-100 hover:text-[var(--danger)]" onClick={() => deleteRow(row.id)} title="Delete row" aria-label="Delete row"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </td>
                      {headers.map((header, column) => <td key={`${column}:${header}`}>{virtual
                        ? <div style={{ height: viewport.rowHeight - 5, overflow: 'hidden' }}>{renderCell(row, column)}</div>
                        : renderCell(row, column)}</td>)}
                      <td className="vw-db-gutter" />
                    </tr>
                  </Fragment>
                );
              })}
              {virtual && (
                <tr aria-hidden="true" style={{ border: 0 }}><td colSpan={headers.length + 2} style={{ height: (visibleRows.length - (renderedIndices.at(-1) ?? -1) - 1) * viewport.rowHeight, padding: 0, border: 0 }} /></tr>
              )}
            </tbody>
          </table>
          {!table.readOnly && headers.length > 0 && <button type="button" className="vw-newrow" onClick={addRow}><Plus className="h-3.5 w-3.5" /> New row</button>}
        </div>
      </div>
    </main>
  );
}

registerSurface('csv', CsvSurface);

export default CsvSurface;
