import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, Plus, Settings2, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Chip } from '@/components/db/DbCards';
import type { DbOption } from '@/lib/db';
import { rowWindow } from '@/lib/row-window';
import { decideExternalChange } from '@/lib/external-change';

// The pieces of a table surface that the database (.db) and CSV tables share:
// toolbar styles, the echo-guarded file write, row virtualisation, and the
// cell editors whose look does not depend on how a value is stored.

// Header controls are plain buttons so the app-wide focus ring applies.
export const HEADER_BUTTON = 'interactive inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--divider)] px-2.5 text-[12px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]';
// `.field` is a full-width 34px form control; the toolbar needs compact ones sized to content.
export const TOOL_FIELD_BASE = 'field !min-h-0 !h-8 shrink-0 text-[12px]';
export const TOOL_FIELD = `${TOOL_FIELD_BASE} !w-auto px-2`;

/**
 * Writes one workspace file and recognises its own writes when they come back.
 *
 * The watcher can report a write before the write call returns, and a reload
 * from disk must never replace what is being saved with older content. So a
 * write in flight, or one that failed, holds off reloads, and text equal to
 * what was last written or is being written is never adopted as a change.
 *
 * With `askOnConflict` (a surface that shows ExternalChangeBar), a different
 * outside version arriving while an edit is in flight or unsaved is not
 * dropped: `conflict` turns on, nothing is written until `keepMine` or
 * `takeDisk` is called, and the latter adopts the file on disk.
 */
export function useFileWriter(path: string, onExternalChange?: (text: string) => void, options: { askOnConflict?: boolean } = {}) {
  // inFlight: every write not yet answered (several when edits come quickly);
  // onDisk: the last version known to be on disk (adopted or saved); latest:
  // the last text asked to be written, kept while a conflict holds writes.
  const state = useRef({
    path, lastWritten: null as string | null, pending: null as string | null, latest: null as string | null,
    inFlight: [] as string[], onDisk: null as string | null, sequence: 0, unsaved: false, conflict: false,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflictState] = useState(false);
  const external = useRef(onExternalChange);
  external.current = onExternalChange;
  const askOnConflict = options.askOnConflict === true;
  const setConflict = (open: boolean) => {
    state.current.conflict = open;
    setConflictState(open);
  };

  /** Call before adopting content: a new path forgets the old file's writes. Returns true when it did. */
  const follow = (next: string): boolean => {
    const s = state.current;
    if (s.path === next) return false;
    s.path = next;
    s.lastWritten = null;
    s.pending = null;
    s.latest = null;
    s.inFlight = [];
    s.onDisk = null;
    s.sequence++;
    s.unsaved = false;
    setConflict(false);
    setSaveError(null);
    return true;
  };

  /** Text that must not be adopted as a change on disk. Raises the conflict when it is someone else's change to an edit not on disk. */
  const ignores = (text: string) => {
    const s = state.current;
    if (text === s.pending || text === s.lastWritten) return true;
    if (!askOnConflict) return s.unsaved;
    const decision = decideExternalChange({ disk: text, pending: s.unsaved || s.conflict, ours: [s.latest, s.onDisk, ...s.inFlight] });
    if (decision === 'ask') { if (!s.conflict) setConflict(true); return true; }
    s.onDisk = text;
    return decision === 'ignore';
  };

  const write = async (text: string): Promise<boolean> => {
    const s = state.current;
    s.latest = text;
    // Changed outside Neuron while an edit was pending: nothing is written
    // until the user picks a version.
    if (s.conflict) return false;
    const sequence = ++s.sequence;
    s.unsaved = true;
    // Watcher IPC can beat the write reply; keep its echo separate from confirmed saves.
    s.pending = text;
    s.inFlight.push(text);
    try {
      const result = await window.electronAPI.writeNote(path, text);
      if (sequence !== s.sequence) return false;
      s.pending = null;
      s.inFlight = [];
      if (result.success) {
        s.lastWritten = text;
        s.onDisk = text;
        // Only a write in flight or a failed one holds off reloads from disk.
        s.unsaved = false;
        setSaveError(null);
        return true;
      }
      setSaveError(result.error ?? 'Unknown error');
    } catch (error) {
      if (sequence !== s.sequence) return false;
      s.pending = null;
      s.inFlight = [];
      setSaveError(error instanceof Error ? error.message : String(error));
    }
    return false;
  };

  // The open file follows its file on disk: external edits (git pull, sync,
  // another editor) land without a reload.
  useEffect(() => {
    return window.electronAPI.onNotesChanged((event, changed) => {
      if (changed !== path || event === 'unlink') return;
      const s = state.current;
      const sequence = s.sequence;
      void window.electronAPI.readNote(path).then((text) => {
        if (s.path !== path || sequence !== s.sequence || text.startsWith('Error:') || ignores(text)) return;
        external.current?.(text);
      });
    });
  }, [path]);

  /** Write the local version over the outside one. */
  const keepMine = () => {
    const s = state.current;
    setConflict(false);
    if (s.latest !== null) void write(s.latest);
  };
  /** Drop the local version and adopt the file on disk. */
  const takeDisk = async () => {
    const s = state.current;
    const text = await window.electronAPI.readNote(path);
    if (s.path !== path || text.startsWith('Error:')) return;
    s.sequence++; // a write still in flight can no longer report over this
    s.pending = null;
    s.latest = null;
    s.inFlight = [];
    s.onDisk = text;
    s.unsaved = false;
    setConflict(false);
    setSaveError(null);
    external.current?.(text);
  };

  return { saveError, follow, ignores, write, conflict, keepMine, takeDisk };
}

export function SaveNotice({ error, path, onRetry }: { error: string | null; path: string; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-[var(--divider)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--danger)]">
      {/* Retry first: the message carries a full path, and a long one pushed the
          button under the floating graph. */}
      <button type="button" className="interactive shrink-0 rounded px-2 py-1 font-medium hover:bg-[var(--surface-hover)]" onClick={onRetry}>Retry</button>
      <span className="min-w-0 truncate" title={error}>Couldn't save {path.split(/[\\/]/).pop()}: {error}</span>
    </div>
  );
}

/**
 * Which rows of a long table to mount. Rows stay in a real <table> so columns
 * keep their widths; the rows outside the window are replaced by spacer rows.
 */
export function useRowVirtualizer<T>(rows: readonly T[], idOf: (row: T) => string, virtual: boolean, resetDeps: readonly unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const measuredHeight = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, viewportHeight: 0, rowHeight: 36 });
  const [focusedRow, setFocusedRow] = useState<string | null>(null);

  useLayoutEffect(() => {
    const container = scrollRef.current;
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
  }, [virtual, rows]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setViewport((current) => ({ ...current, scrollTop: 0 }));
  }, resetDeps);

  const windowRows = rowWindow({ ...viewport, count: rows.length, overscan: 10 });
  const focusedIndex = focusedRow === null ? -1 : rows.findIndex((row) => idOf(row) === focusedRow);
  // Keep the editor and its Tab neighbours mounted without filling a distant gap.
  // The last focused row stays pinned after focus leaves the table: at most three
  // extra rows, and Tab into the next row never finds it unmounted.
  const pinnedRows = focusedIndex < 0 ? [] : [focusedIndex - 1, focusedIndex, focusedIndex + 1]
    .filter((index) => index >= 0 && index < rows.length && (index < windowRows.start || index >= windowRows.end));
  const renderedIndices = virtual
    ? [...pinnedRows, ...Array.from({ length: windowRows.end - windowRows.start }, (_, index) => windowRows.start + index)].sort((a, b) => a - b)
    : rows.map((_, index) => index);

  return { scrollRef, viewport, renderedIndices, setFocusedRow };
}

export function UrlCell({ value, label, onChange, onBlur }: { value: string; label: string; onChange: (value: string) => void; onBlur: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <input className="vw-cell" value={value} placeholder="https://" onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-label={label} />
      {/^https?:\/\//.test(value) && (
        <a href={value} target="_blank" rel="noreferrer" className="vw-icon-btn shrink-0" title={value} aria-label={`Open ${value}`}><ExternalLink className="h-3 w-3" /></a>
      )}
    </div>
  );
}

/** A select cell: the chosen option as a chip, and a menu to pick another. */
export function SelectCell({ options, selected, fallback, onPick, onClear, onEditOptions }: {
  options: DbOption[];
  selected: DbOption | undefined;
  /** Shown when the value names no option. */
  fallback?: string;
  onPick: (option: DbOption) => void;
  onClear: () => void;
  /** Without it the menu only picks; an embedded table does not edit its schema. */
  onEditOptions?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-1 rounded px-1 py-1 text-left hover:bg-[var(--surface-hover)]">
          {selected ? <Chip option={selected} /> : fallback ? <span className="min-w-0 truncate text-xs">{fallback}</span> : <span className="text-xs text-[var(--ink-muted)]">—</span>}
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-[var(--ink-muted)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onPick(o)}><Chip option={o} /></DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={onClear}>None</DropdownMenuItem>
        {onEditOptions && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onEditOptions}><Settings2 className="h-3.5 w-3.5" /> Edit options…</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The list of a select property's options: rename, recolor, reorder, delete, add. */
export function OptionListEditor({ options, onRename, onCommit, onCycleColor, onMove, onDelete, onAdd }: {
  options: DbOption[];
  /** While typing; `onCommit` saves on blur. */
  onRename: (optionId: string, name: string) => void;
  onCommit: () => void;
  onCycleColor: (optionId: string) => void;
  onMove: (optionId: string, delta: -1 | 1) => void;
  onDelete: (optionId: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-1">
      {options.map((o) => (
        <div key={o.id} className="flex items-center gap-1.5">
          <button type="button" className="h-4 w-4 shrink-0 rounded-full" style={{ background: o.color }} onClick={() => onCycleColor(o.id)} title="Change color" aria-label={`Change color of ${o.name}`} />
          <input
            className="field h-7 w-40 px-2 text-xs"
            value={o.name}
            onChange={(e) => onRename(o.id, e.target.value)}
            onBlur={onCommit}
            aria-label="Option name"
          />
          <button type="button" className="vw-icon-btn" onClick={() => onMove(o.id, -1)} title="Move up" aria-label={`Move ${o.name} up`}><ArrowUp className="h-3 w-3" /></button>
          <button type="button" className="vw-icon-btn" onClick={() => onMove(o.id, 1)} title="Move down" aria-label={`Move ${o.name} down`}><ArrowDown className="h-3 w-3" /></button>
          <button type="button" className="vw-icon-btn hover:text-[var(--danger)]" onClick={() => onDelete(o.id)} title="Delete option" aria-label={`Delete ${o.name}`}><Trash2 className="h-3 w-3" /></button>
          <Chip option={o} />
        </div>
      ))}
      <button type="button" className="vw-newrow" onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Add option</button>
    </div>
  );
}
