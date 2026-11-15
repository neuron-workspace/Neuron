import { useState } from 'react';
import { ArrowLeftRight, Eye, PenLine, X } from 'lucide-react';
import MDXPreview from './MDXPreview';
import { Segmented } from './ui/segmented';
import { cn } from '../lib/utils';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const saveText: Record<SaveState, string> = { idle: '', saving: 'Saving…', saved: 'Saved locally', error: 'Save failed' };
const iconButton = 'interactive grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]';

/** Tick or untick the task on one source line. Null when the line holds no task. */
export function toggleTaskLine(content: string, lineIndex: number, checked: boolean): string | null {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return null;
  const next = checked ? line.replace(/\[ \]/, '[x]') : line.replace(/\[[xX]\]/, '[ ]');
  if (next === line) return null;
  lines[lineIndex] = next;
  return lines.join('\n');
}

/**
 * A second note beside the editor, for reading one while writing another.
 *
 * It owns no file state: the app hands it the content and a change handler, so
 * a note open in both panes has one copy and one writer.
 */
export default function SideNote({ path, content, saveState, colorScheme, notes, tags, onChange, onOpenNote, onSwap, onClose }: {
  path: string;
  content: string;
  saveState: SaveState;
  colorScheme: 'dark' | 'light';
  notes: string[];
  tags: string[];
  onChange: (value: string) => void;
  /** Links open in the main pane, so this one stays on what you set beside it. */
  onOpenNote: (path: string) => void;
  onSwap: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'reading' | 'live'>('reading');
  const name = path.split('/').pop() ?? path;
  const toggleTask = (line: number, checked: boolean) => {
    const next = toggleTaskLine(content, line, checked);
    if (next !== null) onChange(next);
  };
  return (
    <section aria-label={`Side pane: ${name}`} data-side-note={path} className="shell-card flex h-full w-full min-w-0 flex-col">
      <div className="note-header flex h-8 min-w-0 shrink-0 items-center gap-2 border-b border-[var(--divider)] px-3">
        <div aria-label="Side note path" title={path} className="min-w-0 flex-1 truncate font-sans text-xs text-[var(--ink-muted)]">
          {path.includes('/') && <span>{path.slice(0, path.lastIndexOf('/') + 1)}</span>}
          <span className="text-[var(--ink-secondary)]">{name}</span>
        </div>
        <span role="status" className={cn('shrink-0 text-xs text-[var(--ink-muted)]', saveState === 'error' && 'text-[var(--danger)]')}>{saveText[saveState]}</span>
        <Segmented label="Side pane view" value={mode} onChange={setMode} options={[
          { value: 'reading', label: 'Reading', icon: <Eye className="h-3.5 w-3.5" /> },
          { value: 'live', label: 'Live', icon: <PenLine className="h-3.5 w-3.5" /> },
        ]} />
        <button aria-label="Swap panes" title="Swap panes" className={iconButton} onClick={onSwap}><ArrowLeftRight className="h-3.5 w-3.5" /></button>
        <button aria-label="Close side pane" title="Close side pane" className={iconButton} onClick={onClose}><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'live'
          ? <MDXPreview key={path} editable mdxContent={content} onChangeSource={onChange} onToggleTask={toggleTask} colorScheme={colorScheme} tagSuggestions={tags} notes={notes} onWikiLinkClick={onOpenNote} />
          : <MDXPreview key={path} mdxContent={content} onToggleTask={toggleTask} colorScheme={colorScheme} tagSuggestions={tags} notes={notes} onWikiLinkClick={onOpenNote} />}
      </div>
    </section>
  );
}
