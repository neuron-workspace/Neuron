import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Blocks, FolderGit2, Info, Keyboard, Palette, PencilLine, SlidersHorizontal } from 'lucide-react';
import type { RepositoryInfo } from '../electron.d';
import { isSettingsSection, type SettingsSection } from '../../main/workspace-windows';
import type { Appearance } from '../lib/theme';
import type { Bindings } from '../lib/keybindings';
import type { WorkbenchLayout } from '../lib/layout';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { AboutSettings, AppearanceSettings, EditorSettings, KeyboardSettings, type PropertiesSettings } from './SettingsPage';
import PluginsPage from './PluginsPage';
import RepositoriesPage from './RepositoriesPage';

const APP_SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'editor', label: 'Editor', icon: PencilLine },
  { id: 'plugins', label: 'Plugins', icon: Blocks },
  { id: 'workspaces', label: 'Workspaces', icon: FolderGit2 },
  { id: 'about', label: 'About', icon: Info },
];

const HEADINGS: Record<SettingsSection, { title: string; description?: string }> = {
  appearance: { title: 'Appearance', description: 'Presets update the whole workspace immediately.' },
  keyboard: { title: 'Keyboard' },
  editor: { title: 'Editor' },
  plugins: { title: 'Plugins & integrations' },
  workspaces: { title: 'Workspaces', description: 'A workspace is just a folder of notes — local or in a synced folder like OneDrive or Google Drive.' },
  about: { title: 'About' },
  workspace: { title: 'General', description: 'These apply to this workspace only.' },
};

function initialSection(): SettingsSection {
  const asked = new URLSearchParams(window.location.search).get('section');
  return isSettingsSection(asked) ? asked : 'appearance';
}

function SectionRow({ label, icon: Icon, selected, onSelect }: { label: string; icon: React.ComponentType<{ className?: string }>; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-current={selected ? 'page' : undefined} onClick={onSelect}
      className={cn('interactive flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]',
        selected && 'bg-[var(--surface-hover)] text-[var(--ink)]')}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function WorkspaceGeneral({ workspace, onRenamed }: { workspace: RepositoryInfo; onRenamed: (repo: RepositoryInfo) => void }) {
  const [draft, setDraft] = useState(workspace.name);
  useEffect(() => setDraft(workspace.name), [workspace.name, workspace.path]);
  const save = async () => {
    const result = await window.electronAPI.repository.setName(workspace.path, draft);
    if (result?.repository) onRenamed(result.repository);
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
      <p className="text-xs text-[var(--ink-muted)]">Layout for this workspace is set in .neuron/layout.json.</p>
    </div>
  );
}

interface SettingsWindowProps {
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  bindings: Bindings;
  onBindingsChange: (bindings: Bindings) => void;
  properties: PropertiesSettings;
  onPropertiesChange: (properties: PropertiesSettings) => void;
  layout: WorkbenchLayout;
  recents: RepositoryInfo[];
  onCreateRepo: () => void;
  onOpenRepo: () => void;
  onSwitchRepo: (dir: string) => void;
  /** Stable across renders: the window's listeners are set up once with it. */
  onReloadRepos: () => void;
}

/** The one Settings window: a fixed list of sections, one shown at a time. */
export default function SettingsWindow(props: SettingsWindowProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [opener, setOpener] = useState<RepositoryInfo | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const loadOpener = useCallback(() => {
    void window.electronAPI?.windowControls.openerWorkspace().then(setOpener).catch(() => setOpener(null));
  }, []);
  const { onReloadRepos } = props;
  const reload = useCallback(() => { onReloadRepos(); loadOpener(); }, [onReloadRepos, loadOpener]);

  useEffect(() => {
    loadOpener();
    // Another window asked for a section, possibly from another workspace.
    const unsubscribe = window.electronAPI?.windowControls.onShowSection((asked) => {
      if (isSettingsSection(asked)) setSection(asked);
      loadOpener();
    });
    // Workspaces open and close in other windows while this one waits.
    window.addEventListener('focus', reload);
    return () => { unsubscribe?.(); window.removeEventListener('focus', reload); };
  }, [loadOpener, reload]);

  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [section]);

  const heading = HEADINGS[section];
  let content: React.ReactNode;
  switch (section) {
    case 'appearance': content = <AppearanceSettings appearance={props.appearance} onAppearanceChange={props.onAppearanceChange} />; break;
    case 'keyboard': content = <KeyboardSettings bindings={props.bindings} onBindingsChange={props.onBindingsChange} />; break;
    case 'editor': content = <EditorSettings properties={props.properties} onPropertiesChange={props.onPropertiesChange} />; break;
    case 'plugins': content = <PluginsPage layout={props.layout} />; break;
    case 'workspaces': content = <RepositoriesPage opener={opener} recents={props.recents} onCreate={props.onCreateRepo} onOpen={props.onOpenRepo} onSwitch={props.onSwitchRepo} onReload={reload} />; break;
    case 'about': content = <AboutSettings />; break;
    case 'workspace': content = opener
      ? <WorkspaceGeneral workspace={opener} onRenamed={(repo) => { setOpener(repo); props.onReloadRepos(); }} />
      : <p className="text-sm text-[var(--ink-muted)]">Open a workspace to change its settings.</p>; break;
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--nav)] font-sans text-[var(--ink)]" data-utility-window="settings">
      <header className="titlebar flex h-10 shrink-0 items-center px-4 text-[13px] font-medium text-[var(--ink-secondary)]">Settings</header>
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <nav aria-label="Settings sections" className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto p-1">
          <p className="px-2 pb-1 text-xs text-[var(--ink-muted)]">Neuron</p>
          {APP_SECTIONS.map((row) => (
            <SectionRow key={row.id} label={row.label} icon={row.icon} selected={section === row.id} onSelect={() => setSection(row.id)} />
          ))}
          <div role="group" aria-label="This workspace" className="mt-4 flex flex-col gap-0.5">
            {opener ? (
              <>
                <p className="truncate px-2 pb-1 text-xs text-[var(--ink-muted)]" title={opener.path}>{opener.name}</p>
                <SectionRow label="General" icon={SlidersHorizontal} selected={section === 'workspace'} onSelect={() => setSection('workspace')} />
              </>
            ) : (
              <p className="px-2 text-xs leading-5 text-[var(--ink-muted)]">Open a workspace to change its settings.</p>
            )}
          </div>
        </nav>
        <main className="shell-card flex min-w-0 flex-1 flex-col" data-settings-section={section}>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="w-full max-w-[720px] px-7 pb-12 pt-6">
              <h1 className="text-[18px] font-semibold text-[var(--ink)]">{heading.title}</h1>
              {heading.description && <p className="mt-1 text-[13px] leading-5 text-[var(--ink-secondary)]">{heading.description}</p>}
              <div className="mt-6">{content}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
