import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BarChart3, Columns2, Columns3, Database, Hash, Info, Minus, SquarePen, type LucideIcon } from 'lucide-react';
import { parseDb } from '../lib/db';

// The menu `/` opens on an empty line in Live: blocks to build a page with.
// A data block starts out pointed at the workspace's first database, so it
// shows something the moment it is inserted.

export type InsertKind = 'columns-2' | 'columns-3' | 'stat' | 'chart' | 'form' | 'dbview' | 'divider' | 'callout';

const ITEMS: { kind: InsertKind; label: string; icon: LucideIcon }[] = [
  { kind: 'columns-2', label: 'Columns (2)', icon: Columns2 },
  { kind: 'columns-3', label: 'Columns (3)', icon: Columns3 },
  { kind: 'stat', label: 'Stat', icon: Hash },
  { kind: 'chart', label: 'Chart', icon: BarChart3 },
  { kind: 'form', label: 'Form', icon: SquarePen },
  { kind: 'dbview', label: 'Database view', icon: Database },
  { kind: 'divider', label: 'Divider', icon: Minus },
  { kind: 'callout', label: 'Callout', icon: Info },
];

export interface DataDefault { path: string; table: string; group: string | null }

/** The first database in the workspace, by path, and its first table. */
export async function firstDatabase(): Promise<DataDefault | null> {
  const api = window.electronAPI;
  if (!api) return null;
  const paths = (await api.listNotes()).filter((p) => /\.db$/i.test(p) && !p.startsWith('.neuron/')).sort((a, b) => a.localeCompare(b));
  for (const path of paths) {
    const parsed = parseDb(await api.readNote(path), path);
    const tableId = parsed.db ? Object.keys(parsed.db.tables)[0] : undefined;
    if (!parsed.db || !tableId) continue;
    const { order, properties } = parsed.db.tables[tableId].schema;
    return { path, table: tableId, group: order.find((id) => properties[id].type === 'select') ?? null };
  }
  return null;
}

/**
 * The lines a kind inserts, and where the caret goes when its editor opens:
 * inside `source=""` when there is no database to point at.
 */
export function snippetFor(kind: InsertKind, data: DataDefault | null): { lines: string[]; cursor?: number } {
  const source = data ? `source="${data.path}" table="${data.table}"` : 'source=""';
  const withCursor = (line: string) => ({ lines: [line], cursor: data ? undefined : line.indexOf('source="') + 'source="'.length });
  const column = (text: string) => ['<Column>', '', text, '', '</Column>'];
  switch (kind) {
    case 'columns-2': return { lines: ['<Columns>', ...column('Left column'), ...column('Right column'), '</Columns>'] };
    case 'columns-3': return { lines: ['<Columns>', ...column('First column'), ...column('Second column'), ...column('Third column'), '</Columns>'] };
    case 'stat': return withCursor(`<Stat label="Rows" ${source} count />`);
    case 'chart': return withCursor(`<Chart type="bar" ${source} group="${data?.group ?? ''}" count />`);
    case 'form': return withCursor(`<Form ${source} submit="Add" />`);
    case 'dbview': return withCursor(`<DbView ${source} editable />`);
    case 'divider': return { lines: ['<Divider />'] };
    case 'callout': return { lines: ['<Callout type="info" title="Note">', 'Write here.', '</Callout>'] };
  }
}

/** `onClose(true)`: put the caret back on the line the menu was opened from. */
export default function InsertMenu({ anchor, onChoose, onClose }: { anchor: DOMRect; onChoose: (kind: InsertKind) => void; onClose: (restore: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  const listId = useId();
  const words = query.trim().toLowerCase();
  const shown = ITEMS.filter((item) => !words || item.label.toLowerCase().includes(words) || item.kind.includes(words));

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [words]);
  // Open above the line when there is no room below it.
  useLayoutEffect(() => {
    const height = menu.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 4 + height <= window.innerHeight - 8;
    setPlace({ left: Math.min(anchor.left, window.innerWidth - 248), top: below ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4) });
  }, [anchor, shown.length]);

  return (
    <div
      ref={menu}
      className="fixed z-[var(--z-modal)] w-60 rounded-md border border-[var(--divider)] bg-[var(--nav)] p-1 font-sans shadow-lg"
      style={place}
      data-insert-menu
      onMouseDown={(e) => { if (e.target !== input.current) e.preventDefault(); }}
    >
      <input
        ref={input}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={shown[active] ? `${listId}-${shown[active].kind}` : undefined}
        aria-label="Insert a block"
        placeholder="Insert a block…"
        className="mb-1 h-7 w-full rounded-md bg-transparent px-2 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => onClose(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (shown.length ? (i + 1) % shown.length : 0)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (shown.length ? (i - 1 + shown.length) % shown.length : 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) onChoose(shown[active].kind); }
          else if (e.key === 'Escape' || (e.key === 'Backspace' && !query)) { e.preventDefault(); e.stopPropagation(); onClose(true); }
        }}
      />
      <div id={listId} role="listbox" aria-label="Blocks" className="max-h-72 overflow-y-auto">
        {shown.length === 0 && <div className="px-2 py-1.5 text-xs text-[var(--ink-muted)]">No block matches.</div>}
        {shown.map((item, index) => (
          <div
            key={item.kind}
            id={`${listId}-${item.kind}`}
            role="option"
            aria-selected={index === active}
            className={`flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] ${index === active ? 'bg-[var(--surface-hover)] text-[var(--ink)]' : 'text-[var(--ink-secondary)]'}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => onChoose(item.kind)}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" aria-hidden />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
