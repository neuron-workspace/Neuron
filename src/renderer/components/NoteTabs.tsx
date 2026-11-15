import { FileCode2, Globe, Plus, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';

interface NoteTabsProps {
  tabs: string[];
  activeTab: string;
  onSelect: (note: string) => void;
  onClose: (note: string) => void;
  onNewTab: () => void;
  onNewBrowser: () => void;
  /** Show a note beside the editor. Notes only: a web page or a canvas has no side view. */
  onOpenToSide?: (note: string) => void;
}

const isUrl = (s: string) => /^https?:\/\//.test(s);

function noteLabel(path: string) {
  if (isUrl(path)) {
    try { return new URL(path).hostname.replace(/^www\./, ''); } catch { return path; }
  }
  return path.split('/').pop()?.replace(/\.(md|mdx)$/, '') ?? path;
}

export default function NoteTabs({ tabs, activeTab, onSelect, onClose, onNewTab, onNewBrowser, onOpenToSide }: NoteTabsProps) {
  return (
    <nav aria-label="Open notes" className="flex h-8 bg-[var(--surface)] min-w-0 flex-1 items-stretch overflow-x-auto whitespace-nowrap">
      {tabs.map((note) => {
        const active = note === activeTab;
        return (
          <ContextMenu key={note}>
          <ContextMenuTrigger asChild>
          <div
            className={cn(
              'group flex min-w-[8rem] max-w-[13rem] shrink-0 items-center border-r border-[var(--divider)]',
              active ? 'bg-[var(--canvas)] text-[var(--ink)] shadow-[inset_0_-2px_var(--accent)]' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink-secondary)]',
            )}
          >
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              title={note}
              className="interactive flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-2 text-left text-xs"
              onClick={() => onSelect(note)}
              onAuxClick={(event) => { if (event.button === 1) onClose(note); }}
            >
              {isUrl(note)
                ? <Globe className={cn('h-3 w-3 shrink-0', active && 'text-[var(--ink)]')} />
                : <FileCode2 className={cn('h-3 w-3 shrink-0', active && 'text-[var(--ink)]')} />}
              <span className="truncate font-sans">{noteLabel(note)}</span>
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
            <ContextMenuItem disabled={!onOpenToSide || !/\.(md|mdx)$/.test(note)} onSelect={() => onOpenToSide?.(note)}>Open to the side</ContextMenuItem>
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
