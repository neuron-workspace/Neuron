import { Cloud, FolderGit2, MoreHorizontal } from 'lucide-react';
import type { RecentWorkspace } from '../electron.d';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { RemoveConfirm, RenameField, WorkspaceMenuContent, useWorkspaceActions } from '../components/workspace-actions';
import { cn } from '../lib/utils';

const ADD_HINT = 'Add a workspace from the workspace menu in the top-left of a window.';

interface RepositoriesPageProps {
  /**
   * Every workspace Neuron knows, once each, from main. The one whose window
   * opened Settings -- the one workspace known to be on screen -- is marked
   * `isOpener`; main matches folders by identity, not by spelling.
   */
  recents: RecentWorkspace[];
  onSwitch: (dir: string) => void;
  onReload: () => void;
}

/** The Workspaces section of the Settings window. */
export default function RepositoriesPage({ recents: repos, onSwitch, onReload }: RepositoriesPageProps) {
  const actions = useWorkspaceActions(onReload);

  return (
    <div>
      {repos.length === 0 ? (
        <p className="text-sm text-[var(--ink-secondary)]">{ADD_HINT}</p>
      ) : (
        <ul aria-label="Known workspaces" className="divide-y divide-[var(--divider)] overflow-hidden rounded-md border border-[var(--divider)]">
          {repos.map((repo) => {
            const isEditing = actions.editing === repo.path;
            const isConfirming = actions.pendingRemove === repo.path;
            return (
              <li key={repo.path} data-workspace-row={repo.path} data-missing={repo.missing || undefined} className="flex min-h-[52px] items-center gap-3 px-3 py-2">
                <FolderGit2 className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <RenameField actions={actions} dir={repo.path} />
                  ) : (
                    <div className={cn('flex items-center gap-1.5 text-[13px] font-medium', repo.missing ? 'text-[var(--ink-muted)]' : 'text-[var(--ink)]')}>
                      <button type="button" onClick={() => onSwitch(repo.path)} className="interactive min-w-0 truncate rounded-sm text-left hover:underline">{repo.name}</button>
                      {repo.cloud && <Cloud aria-label="In a synced folder" className="h-3 w-3 shrink-0 text-[var(--ink-muted)]" />}
                    </div>
                  )}
                  <div className="truncate font-mono text-xs text-[var(--ink-muted)]" title={repo.path}>{repo.path}</div>
                  {repo.missing && <div className="text-xs text-[var(--ink-secondary)]">Folder not found</div>}
                </div>
                {isConfirming ? (
                  <RemoveConfirm actions={actions} dir={repo.path} />
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    {repo.missing
                      ? <Button size="sm" variant="outline" onClick={() => actions.askRemove(repo.path)}>Remove from list</Button>
                      : <Button size="sm" variant="outline" onClick={() => onSwitch(repo.path)}>{repo.isOpener ? 'Show window' : 'Open'}</Button>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button aria-label={`More actions for ${repo.name}`} className="interactive grid h-8 w-8 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <WorkspaceMenuContent actions={actions} repo={repo} />
                    </DropdownMenu>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {repos.length > 0 && <p className="mt-3 text-xs text-[var(--ink-muted)]">{ADD_HINT}</p>}
    </div>
  );
}
