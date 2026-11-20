import { useEffect, useRef, useState } from 'react';
import { Cloud, MoreHorizontal } from 'lucide-react';
import type { RecentWorkspace } from '../electron.d';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuTrigger } from './ui/dropdown-menu';
import NeuronMark from './NeuronMark';
import WorkspaceTemplatesDialog from './WorkspaceTemplatesDialog';
import { RemoveConfirm, RenameField, WorkspaceMenuContent, useWorkspaceActions } from './workspace-actions';
import { useWorkspaceTemplates } from '../lib/useWorkspaceTemplates';
import { APP_VERSION } from '../lib/appVersion';
import { cn } from '../lib/utils';

interface RepositoryOnboardingProps {
  /** Every workspace Neuron knows, most recent first (this window shows none). */
  recents: RecentWorkspace[];
  /** Opens a workspace by path; a folder that is not there shows the app's notice. */
  onSwitch: (dir: string) => void;
  onCreate: () => void;
  onOpen: () => void;
  /** Reload the list after a rename or removal. */
  onReload: () => void;
  /** The app's notice, shown over the page. */
  notice?: React.ReactNode;
}

/** The longest end of a path that always shows; a longer folder name keeps only its last characters. */
const PATH_TAIL = 22;

/**
 * A path shortened in the middle, at whatever width the row has: the start
 * gives way first (ending in an ellipsis) and the end, the folder's own name,
 * stays. The full path is in the row's tooltip.
 */
function MiddleTruncatedPath({ path }: { path: string }) {
  const name = path.match(/[\\/][^\\/]+[\\/]?$/)?.[0] ?? '';
  const cut = path.length - (name && name.length <= PATH_TAIL ? name.length : Math.min(path.length, 16));
  return (
    <span className="flex w-full min-w-0 whitespace-pre font-mono text-xs text-[var(--ink-muted)]">
      <span className="min-w-0 truncate">{path.slice(0, cut)}</span>
      <span className="shrink-0">{path.slice(cut)}</span>
    </span>
  );
}

function ActionRow({ title, description, action, onClick, buttonRef, disabled }: {
  title: string; description: string; action: string; onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>; disabled?: boolean;
}) {
  return (
    <div data-welcome-action={action} className="flex items-center gap-4 rounded-lg border border-[var(--divider)] bg-[var(--canvas)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-medium text-[var(--ink)]">{title}</h2>
        <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{description}</p>
      </div>
      <Button ref={buttonRef} size="sm" variant={action === 'Create' ? 'default' : 'outline'} className="min-w-[72px] shrink-0"
        aria-label={`${action}: ${title}`} disabled={disabled} onClick={onClick}>{action}</Button>
    </div>
  );
}

/**
 * Shown in a window with no workspace, laid out like a vault picker: every
 * known workspace on the left, and the ways to start one on the right.
 */
export default function RepositoryOnboarding({ recents, onSwitch, onCreate, onOpen, onReload, notice }: RepositoryOnboardingProps) {
  const actions = useWorkspaceActions(onReload);
  const workspaceTemplates = useWorkspaceTemplates();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const create = useRef<HTMLButtonElement>(null);
  const hasList = recents.length > 0;

  // The list this window last heard of may predate the workspace it just let
  // go of; ask again as the page appears.
  const reloadOnShow = useRef(onReload);
  useEffect(() => { reloadOnShow.current(); }, []);

  // Focus starts on the first workspace, or on Create when there is none. The
  // list can arrive just after the page does, and a removed row takes its focus
  // with it; focus follows the list then, unless someone has already moved it.
  const autoFocused = useRef<Element | null>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== autoFocused.current) return;
    const target = (hasList ? rows.current.find((row) => row?.isConnected) : null) ?? create.current;
    target?.focus();
    autoFocused.current = target ?? null;
  }, [recents, hasList]);

  const focusRow = (index: number) => rows.current[Math.max(0, Math.min(recents.length - 1, index))]?.focus();
  const onRowKey = (event: React.KeyboardEvent, index: number) => {
    const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: recents.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    focusRow(to);
  };

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 bg-[var(--canvas)]" data-welcome-page>
      {notice}
      {hasList && (
        <nav aria-label="Workspaces" className="flex w-[280px] shrink-0 flex-col border-r border-[var(--divider)] bg-[var(--nav)]">
          <h2 className="shrink-0 px-4 pb-1 pt-4 text-xs font-medium text-[var(--ink-muted)]">Workspaces</h2>
          <ul aria-label="Known workspaces" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {recents.map((repo, index) => {
              const editing = actions.editing === repo.path;
              const confirming = actions.pendingRemove === repo.path;
              const backToRow = () => requestAnimationFrame(() => focusRow(index));
              return (
                <li key={repo.path} data-workspace-row={repo.path} data-missing={repo.missing || undefined} className="group relative">
                  {editing ? (
                    <div className="px-2 py-2">
                      <RenameField actions={actions} dir={repo.path} onDone={backToRow} className="w-full min-w-0 flex-1" />
                    </div>
                  ) : (
                    <button
                      ref={(el) => { rows.current[index] = el; }}
                      type="button"
                      title={repo.path}
                      onClick={() => onSwitch(repo.path)}
                      onKeyDown={(event) => onRowKey(event, index)}
                      className="interactive flex w-full flex-col items-start gap-0.5 rounded-md py-2 pl-3 pr-9 text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-offset-[-2px]"
                    >
                      <span className={cn('flex w-full min-w-0 items-center gap-1.5 text-[13px] font-medium', repo.missing ? 'text-[var(--ink-muted)]' : 'text-[var(--ink)]')}>
                        <span className="truncate">{repo.name}</span>
                        {repo.cloud && <Cloud aria-label="In a synced folder" className="h-3 w-3 shrink-0 text-[var(--ink-muted)]" />}
                      </span>
                      <MiddleTruncatedPath path={repo.path} />
                      {repo.missing && <span className="text-xs text-[var(--ink-secondary)]">Folder not found</span>}
                    </button>
                  )}
                  {confirming && (
                    <div className="px-3 pb-2">
                      <RemoveConfirm actions={actions} dir={repo.path} onDone={backToRow} />
                    </div>
                  )}
                  {!editing && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Workspace actions"
                          className="interactive absolute right-1.5 top-2 grid h-7 w-7 place-items-center rounded-md text-[var(--ink-muted)] opacity-0 hover:bg-[var(--canvas)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <WorkspaceMenuContent actions={actions} repo={repo} />
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <div className="flex min-w-0 flex-1 overflow-y-auto">
        <div className="m-auto w-full max-w-[460px] px-8 py-10">
          <div className="flex flex-col items-center text-center">
            <div className="neuron-logo-bg grid h-16 w-16 place-items-center rounded-[16px] border">
              <NeuronMark className="neuron-logo h-16 w-16" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-[-0.01em] text-[var(--ink)]">Neuron</h1>
            {APP_VERSION && <p className="mt-1 text-xs text-[var(--ink-muted)]">Version {APP_VERSION}</p>}
          </div>
          <div className="mt-8 flex flex-col gap-2">
            <ActionRow title="Create new workspace" description="Start an empty folder for new notes." action="Create" onClick={onCreate} buttonRef={create} />
            <ActionRow title="Open folder as workspace" description="Use a folder of notes you already have." action="Open" onClick={onOpen} />
            <ActionRow title="New workspace from a template" description="Start from one of Neuron's templates." action="Browse"
              onClick={() => setTemplatesOpen(true)} disabled={workspaceTemplates.templates.length === 0} />
          </div>
        </div>
      </div>
      <WorkspaceTemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} {...workspaceTemplates} />
    </div>
  );
}
