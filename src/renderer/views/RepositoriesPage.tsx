import { useRef, useState } from 'react';
import { AlertCircle, Check, Cloud, FolderGit2, FolderOpen, FolderPlus, MoreHorizontal, Sparkles, X } from 'lucide-react';
import type { RepositoryInfo } from '../electron.d';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useWorkspaceTemplates } from '../lib/useWorkspaceTemplates';

interface RepositoriesPageProps {
  /** The workspace whose window opened Settings: the one workspace known to be on screen. */
  opener: RepositoryInfo | null;
  recents: RepositoryInfo[];
  onCreate: () => void;
  onOpen: () => void;
  onSwitch: (dir: string) => void;
  onReload: () => void;
}

/** The Workspaces section of the Settings window. */
export default function RepositoriesPage({ opener, recents, onCreate, onOpen, onSwitch, onReload }: RepositoriesPageProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const keepFocus = useRef(false);
  const { templates, busy, error, start } = useWorkspaceTemplates();

  // Merge the opener into the list in case it isn't in recents yet.
  const repos = opener && !recents.some((r) => r.path === opener.path) ? [opener, ...recents] : recents;

  const startEdit = (repo: RepositoryInfo) => { setPendingRemove(null); setEditing(repo.path); setDraftName(repo.name); };
  const saveEdit = async (dir: string) => {
    await window.electronAPI.repository.setName(dir, draftName);
    setEditing(null);
    onReload();
  };
  const reveal = (dir: string) => window.electronAPI.repository.reveal(dir);
  const remove = async (dir: string) => {
    await window.electronAPI.repository.remove(dir);
    setPendingRemove(null);
    onReload();
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onOpen}><FolderOpen className="h-3.5 w-3.5" /> Open folder…</Button>
        <Button size="sm" variant="outline" onClick={onCreate}><FolderPlus className="h-3.5 w-3.5" /> Create workspace…</Button>
      </div>

      {templates.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
            <Sparkles className="h-3 w-3" /> Start from a template
          </h2>
          <div className="overflow-hidden rounded-md border border-[var(--divider)]">
            {templates.map((template, index) => (
              <button
                key={template.id}
                onClick={() => void start(template)}
                disabled={busy !== null}
                className={`interactive flex min-h-[36px] w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-[var(--surface-hover)] disabled:opacity-60 ${index > 0 ? 'border-t border-[var(--divider)]' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">
                  {template.name}
                  <span className="ml-2 text-xs text-[var(--ink-muted)]">
                    {template.description || `${template.noteCount} note${template.noteCount === 1 ? '' : 's'} to start from`}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-[var(--ink-muted)]">{busy === template.id ? 'Creating…' : 'Choose folder'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-[var(--danger)] px-3 py-2 text-xs text-[var(--ink)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
          <span>{error}</span>
        </div>
      )}

      <h2 className="mb-2 mt-7 text-xs font-medium text-[var(--ink-muted)]">Known workspaces</h2>
      {repos.length === 0 ? (
        <p className="text-sm text-[var(--ink-secondary)]">No workspaces yet. Open a folder of notes or create a workspace to begin.</p>
      ) : (
        <ul aria-label="Known workspaces" className="divide-y divide-[var(--divider)] overflow-hidden rounded-md border border-[var(--divider)]">
          {repos.map((repo) => {
            const shown = opener?.path === repo.path;
            const isEditing = editing === repo.path;
            const isConfirming = pendingRemove === repo.path;
            return (
              <li key={repo.path} data-workspace-row={repo.path} className="flex min-h-[52px] items-center gap-3 px-3 py-2">
                <FolderGit2 className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <Input autoFocus aria-label="Workspace name" value={draftName} onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(repo.path); if (e.key === 'Escape') setEditing(null); }} className="h-7 w-56" />
                      <button aria-label="Save name" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" onClick={() => void saveEdit(repo.path)}><Check className="h-3.5 w-3.5" /></button>
                      <button aria-label="Cancel" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink)]">
                      <span className="truncate">{repo.name}</span>
                      {repo.cloud && <Cloud aria-label="In a synced folder" className="h-3 w-3 shrink-0 text-[var(--ink-muted)]" />}
                    </div>
                  )}
                  <div className="truncate font-mono text-xs text-[var(--ink-muted)]" title={repo.path}>{repo.path}</div>
                </div>
                {isConfirming ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs text-[var(--ink-secondary)]">Remove from list?</span>
                    <Button size="sm" variant="destructive" onClick={() => void remove(repo.path)}>Remove</Button>
                    <Button size="sm" variant="ghost" autoFocus onClick={() => setPendingRemove(null)}>Keep</Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => onSwitch(repo.path)}>{shown ? 'Show window' : 'Open'}</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button aria-label={`More actions for ${repo.name}`} className="interactive grid h-8 w-8 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      {/* Rename and Remove put a field or a question in the row; focus goes there, not back to this button. */}
                      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => { if (keepFocus.current) { e.preventDefault(); keepFocus.current = false; } }}>
                        <DropdownMenuItem onSelect={() => { keepFocus.current = true; startEdit(repo); }}>Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void reveal(repo.path)}>Reveal in file manager</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => { keepFocus.current = true; setEditing(null); setPendingRemove(repo.path); }}>Remove from list</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-[var(--ink-muted)]">Remove only forgets a workspace from this list — its folder and notes stay on disk.</p>
    </div>
  );
}
