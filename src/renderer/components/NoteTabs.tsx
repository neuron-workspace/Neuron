import { useState, type DragEvent } from 'react';
import { FileCode2, Globe, Plus, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { SplitDirection } from '../lib/tabs';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';

/** A tab being dragged: which group it left and which file it is. */
export const TAB_MIME = 'application/x-neuron-tab';
export interface DraggedTab { group: number; path: string }

/** The tab a drop carries, or null for any other drag. */
export function readDraggedTab(event: DragEvent): DraggedTab | null {
  if (!event.dataTransfer.types.includes(TAB_MIME)) return null;
  try {
    const tab = JSON.parse(event.dataTransfer.getData(TAB_MIME)) as Partial<DraggedTab>;
    return typeof tab.group === 'number' && typeof tab.path === 'string' ? { group: tab.group, path: tab.path } : null;
  } catch { return null; }
}

interface NoteTabsProps {
  tabs: string[];
  /** The tab a single click opened, which the next single click replaces. */
  previewTab?: string | null;
  activeTab: string;
  /** Whether this strip's group is the focused one: only then does its active tab carry the accent. */
  focused?: boolean;
  /** This strip's group, carried by a dragged tab. */
  group?: number;
  onSelect: (note: string) => void;
  /** Turn the preview into a tab that stays. */
  onKeep?: (note: string) => void;
  onClose: (note: string) => void;
  onNewTab: () => void;
  onNewBrowser: () => void;
  /** Open a copy of the tab in a new group to the right or below. */
  onSplit?: (note: string, direction: SplitDirection) => void;
  /** Why a split in a direction is not possible, or null when it is. */
  splitBlocked?: (direction: SplitDirection) => string | null;
  /** A tab dropped on this strip, before `before` (at the end when null). */
  onDropTab?: (from: number, note: string, before: string | null) => void;
}

const isUrl = (s: string) => /^https?:\/\//.test(s);

function noteLabel(path: string) {
  if (isUrl(path)) {
    try { return new URL(path).hostname.replace(/^www\./, ''); } catch { return path; }
  }
  return path.split('/').pop()?.replace(/\.(md|mdx)$/, '') ?? path;
}

export default function NoteTabs({ tabs, previewTab = null, activeTab, focused = true, group = 0, onSelect, onKeep, onClose, onNewTab, onNewBrowser, onSplit, splitBlocked, onDropTab }: NoteTabsProps) {
  // Where a dragged tab would land: before this tab, at the end (null), or nowhere (undefined).
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (!onDropTab || !event.dataTransfer.types.includes(TAB_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const over = (event.target as HTMLElement).closest?.('[data-tab]');
    const index = over ? tabs.indexOf(over.getAttribute('data-tab') ?? '') : -1;
    let before: string | null = null;
    if (over && index >= 0) {
      const rect = over.getBoundingClientRect();
      before = event.clientX < rect.left + rect.width / 2 ? tabs[index] : tabs[index + 1] ?? null;
    }
    if (before !== dropBefore) setDropBefore(before);
  };
  const split = (direction: SplitDirection, label: string, note: string) => {
    const blocked = splitBlocked?.(direction) ?? null;
    return (
      // Hoverable while disabled, so its title can say why.
      <ContextMenuItem disabled={!onSplit || !!blocked} title={blocked ?? undefined} className="data-[disabled]:pointer-events-auto" onSelect={() => onSplit?.(note, direction)}>
        {label}
      </ContextMenuItem>
    );
  };
  return (
    <nav aria-label="Open notes" className="flex h-8 bg-[var(--surface)] min-w-0 flex-1 items-stretch overflow-x-auto whitespace-nowrap"
      onDragOver={dragOver}
      onDragLeave={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX <= rect.left || event.clientX >= rect.right || event.clientY <= rect.top || event.clientY >= rect.bottom) setDropBefore(undefined);
      }}
      onDrop={(event) => {
        const tab = readDraggedTab(event);
        if (!tab || !onDropTab) return;
        event.preventDefault();
        const before = dropBefore ?? null;
        setDropBefore(undefined);
        onDropTab(tab.group, tab.path, before);
      }}>
      {tabs.map((note, index) => {
        const active = note === activeTab;
        const preview = note === previewTab;
        return (
          <ContextMenu key={note}>
          <ContextMenuTrigger asChild>
          <div
            data-tab={note}
            data-preview={preview ? 'true' : undefined}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_MIME, JSON.stringify({ group, path: note } satisfies DraggedTab));
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDropBefore(undefined)}
            className={cn(
              'group relative flex min-w-[8rem] max-w-[13rem] shrink-0 items-center border-r border-[var(--divider)]',
              active ? 'bg-[var(--canvas)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink-secondary)]',
              active && focused && 'shadow-[inset_0_-2px_var(--accent)]',
            )}
          >
            {/* The insertion line while a tab is dragged over the strip. */}
            {(dropBefore === note || (dropBefore === null && index === tabs.length - 1)) && (
              <span aria-hidden="true" data-drop-line className={cn('pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-[var(--accent)]', dropBefore === note ? 'left-0' : 'right-0')} />
            )}
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              title={preview ? `${note} (preview: double-click to keep)` : note}
              className="interactive flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-2 text-left text-xs"
              onClick={() => onSelect(note)}
              onDoubleClick={() => onKeep?.(note)}
              // A middle press over the scrollable strip would start the
              // browser's autoscroll, which swallows the click that closes.
              onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
              onAuxClick={(event) => { if (event.button === 1) onClose(note); }}
            >
              {isUrl(note)
                ? <Globe className={cn('h-3 w-3 shrink-0', active && 'text-[var(--ink)]')} />
                : <FileCode2 className={cn('h-3 w-3 shrink-0', active && 'text-[var(--ink)]')} />}
              <span className={cn('truncate font-sans', preview && 'italic')}>{noteLabel(note)}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${noteLabel(note)}`}
              title="Close tab"
              className={cn(
                'interactive mr-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
                active ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
              )}
              onClick={() => onClose(note)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={!preview || !onKeep} onSelect={() => onKeep?.(note)}>Keep open</ContextMenuItem>
            {split('row', 'Split right', note)}
            {split('column', 'Split down', note)}
            <ContextMenuItem onSelect={() => onClose(note)}>Close tab</ContextMenuItem>
          </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        data-workspace-home
        title="New tab"
        className="interactive grid h-[18px] w-[18px] self-center mx-1 shrink-0 place-items-center text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
        onClick={onNewTab}
      >
        <Plus className="h-3 w-3" />
      </button>
      <button
        type="button"
        aria-label="Open website tab"
        title="Open website tab"
        className="interactive grid h-[18px] w-[18px] self-center mx-1 shrink-0 place-items-center text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
        onClick={onNewBrowser}
      >
        <Globe className="h-3 w-3" />
      </button>
    </nav>
  );
}
