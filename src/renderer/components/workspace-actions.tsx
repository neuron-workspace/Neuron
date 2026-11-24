import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { RecentWorkspace } from '../electron.d';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu';
import { cn } from '../lib/utils';

/**
 * Rename, reveal and remove for a list of workspaces. Settings › Workspaces and
 * the welcome page share these, so both ask the same question before removing.
 */
export function useWorkspaceActions(onReload: () => void) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  /** Rename and Remove put a field or a question in the row; focus goes there, not back to the menu button. */
  const keepFocus = useRef(false);

  return {
    editing, draftName, setDraftName, pendingRemove, keepFocus,
    startEdit: (repo: RecentWorkspace) => { setPendingRemove(null); setEditing(repo.path); setDraftName(repo.name); },
    cancelEdit: () => setEditing(null),
    saveEdit: async (dir: string) => {
      await window.electronAPI.repository.setName(dir, draftName);
      setEditing(null);
      onReload();
    },
    reveal: (dir: string) => window.electronAPI.repository.reveal(dir),
    askRemove: (dir: string) => { setEditing(null); setPendingRemove(dir); },
    cancelRemove: () => setPendingRemove(null),
    remove: async (dir: string) => {
      await window.electronAPI.repository.remove(dir);
      setPendingRemove(null);
      onReload();
    },
  };
}

export type WorkspaceActions = ReturnType<typeof useWorkspaceActions>;

/** The row menu: Reveal in file manager, Rename, Remove from list. */
export function WorkspaceMenuContent({ actions, repo }: { actions: WorkspaceActions; repo: RecentWorkspace }) {
  return (
    <DropdownMenuContent align="end" onCloseAutoFocus={(e) => { if (actions.keepFocus.current) { e.preventDefault(); actions.keepFocus.current = false; } }}>
      {/* A folder that is not there has nothing to show. */}
      <DropdownMenuItem disabled={repo.missing} onSelect={() => void actions.reveal(repo.path)}>Reveal in file manager</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { actions.keepFocus.current = true; actions.startEdit(repo); }}>Rename</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { actions.keepFocus.current = true; actions.askRemove(repo.path); }}>Remove from list</DropdownMenuItem>
    </DropdownMenuContent>
  );
}

/** The name field that replaces a workspace's name while it is renamed. */
export function RenameField({ actions, dir, onDone, className }: { actions: WorkspaceActions; dir: string; onDone?: () => void; className?: string }) {
  const save = () => void actions.saveEdit(dir).then(onDone);
  const cancel = () => { actions.cancelEdit(); onDone?.(); };
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Input autoFocus aria-label="Workspace name" value={actions.draftName} onChange={(e) => actions.setDraftName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }} className={cn('h-7 w-56', className)} />
      <button type="button" aria-label="Save name" className="interactive grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" onClick={save}><Check className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label="Cancel" className="interactive grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]" onClick={cancel}><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** "Remove from list?" with Remove and Keep; Keep has focus, so Enter is the safe answer. */
export function RemoveConfirm({ actions, dir, onDone }: { actions: WorkspaceActions; dir: string; onDone?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="text-xs text-[var(--ink-secondary)]">Remove from list?</span>
      <Button size="sm" variant="destructive" onClick={() => void actions.remove(dir).then(onDone)}>Remove</Button>
      <Button size="sm" variant="ghost" autoFocus onClick={() => { actions.cancelRemove(); onDone?.(); }}>Keep</Button>
    </div>
  );
}
