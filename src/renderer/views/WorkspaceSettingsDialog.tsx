import { useCallback, useEffect, useState } from 'react';
import { Blocks, SlidersHorizontal } from 'lucide-react';
import type { RepositoryInfo, TrustedHtmlView } from '../electron.d';
import { announceViewTrustChanged } from '../lib/view-trust';
import type { Dock, WorkbenchLayout } from '../lib/layout';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import PluginsPage from './PluginsPage';
import { SectionRow } from './SettingsWindow';

export type WorkspaceSettingsSection = 'plugins' | 'general';

const SECTIONS: { id: WorkspaceSettingsSection; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { id: 'plugins', label: 'Plugins', icon: Blocks, description: 'Switched on for this workspace only.' },
  { id: 'general', label: 'General', icon: SlidersHorizontal, description: 'These apply to this workspace only.' },
];

function WorkspaceGeneral({ workspace, onRenamed }: { workspace: RepositoryInfo; onRenamed: () => void }) {
  const [draft, setDraft] = useState(workspace.name);
  useEffect(() => setDraft(workspace.name), [workspace.name, workspace.path]);
  const save = async () => {
    const result = await window.electronAPI.repository.setName(workspace.path, draft);
    if (result?.repository) onRenamed();
  };
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="workspace-name" className="text-[13px] font-medium text-[var(--ink)]">Name</label>
        <div className="mt-1.5 flex items-center gap-2">
          <Input id="workspace-name" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} className="h-8 max-w-sm" />
          <Button size="sm" variant="outline" disabled={draft.trim() === workspace.name} onClick={() => void save()}>Save name</Button>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">Shown in the workspace switcher. Leave it empty to use the folder name.</p>
      </div>
      <div>
        <p id="workspace-folder-label" className="text-[13px] font-medium text-[var(--ink)]">Folder</p>
        <div className="mt-1.5 flex items-center gap-2">
          <code aria-labelledby="workspace-folder-label" title={workspace.path} className="min-w-0 truncate font-mono text-xs text-[var(--ink-secondary)]">{workspace.path}</code>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void window.electronAPI.repository.reveal(workspace.path)}>Reveal</Button>
        </div>
      </div>
      <TrustedHtmlViews workspacePath={workspace.path} />
      <p className="text-xs text-[var(--ink-muted)]">Layout for this workspace is set in .neuron/layout.json.</p>
    </div>
  );
}

/** HTML views trusted in this workspace (7B), each with a way to take it back. */
function TrustedHtmlViews({ workspacePath }: { workspacePath: string }) {
  const [views, setViews] = useState<TrustedHtmlView[] | null>(null);
  const load = useCallback(async () => {
    const result = await window.electronAPI.htmxViews.listTrusted();
    setViews(result.success ? result.views : []);
  }, []);
  useEffect(() => { void load(); }, [load, workspacePath]);
  const remove = async (path: string) => {
    await window.electronAPI.htmxViews.resetApproval(path);
    announceViewTrustChanged(path);
    await load();
  };
  return (
    <div data-trusted-views>
      <p id="trusted-views-label" className="text-[13px] font-medium text-[var(--ink)]">Trusted HTML views</p>
      <p className="mt-0.5 text-xs text-[var(--ink-muted)]">A view runs once you trust it, until it changes. Remove one to be asked again.</p>
      {views === null ? null : views.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">No views are trusted yet.</p>
      ) : (
        <ul aria-labelledby="trusted-views-label" className="mt-2 divide-y divide-[var(--divider)] rounded-md border border-[var(--divider)]">
          {views.map((view) => (
            <li key={view.path} data-trusted-view={view.path} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-[var(--ink)]">{view.name}</p>
                <p className="truncate font-mono text-[11px] text-[var(--ink-muted)]" title={view.path}>{view.path}</p>
              </div>
              <time dateTime={view.grantedAt} className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                Trusted {formatTrustedAt(view.grantedAt)}
              </time>
              <Button size="sm" variant="outline" className="shrink-0" aria-label={`Remove ${view.path}`} onClick={() => void remove(view.path)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatTrustedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface WorkspaceSettingsDialogProps {
  /** The section to show, or null while closed. */
  section: WorkspaceSettingsSection | null;
  onSectionChange: (section: WorkspaceSettingsSection | null) => void;
  workspace: RepositoryInfo;
  layout: WorkbenchLayout;
  onOpenDock: (dock: Dock) => void;
  onRenamed: () => void;
}

/** This workspace's own settings, in its window: its plugins, its name and folder. */
export default function WorkspaceSettingsDialog({ section, onSectionChange, workspace, layout, onOpenDock, onRenamed }: WorkspaceSettingsDialogProps) {
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const Icon = current.icon;
  return (
    <Dialog open={section !== null} onOpenChange={(open) => { if (!open) onSectionChange(null); }}>
      <DialogContent className="flex h-[min(560px,calc(100vh-4rem))] w-[min(760px,calc(100vw-4rem))] max-w-none gap-0 overflow-hidden p-0" data-workspace-settings={current.id}>
        <nav aria-label="Workspace settings sections" className="flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-[var(--divider)] p-2">
          <p className="px-2 pt-1 text-[13px] font-medium text-[var(--ink)]">Workspace settings</p>
          <p className="truncate px-2 pb-2 text-xs text-[var(--ink-muted)]" title={workspace.path}>{workspace.name}</p>
          {SECTIONS.map((row) => (
            <SectionRow key={row.id} label={row.label} icon={row.icon} selected={current.id === row.id} onSelect={() => onSectionChange(row.id)} />
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
            <DialogTitle className="flex items-center gap-2 text-[18px] leading-7">
              <Icon className="h-[18px] w-[18px] shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />{current.label}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-5">{current.description}</DialogDescription>
            <div className="mt-5">
              {current.id === 'plugins'
                ? <PluginsPage layout={layout}onOpenDock={(dock) => { onSectionChange(null); onOpenDock(dock); }} />
                : <WorkspaceGeneral workspace={workspace} onRenamed={onRenamed} />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
