import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FolderGit2, Info, Keyboard, Palette, PencilLine, Plug, Settings } from 'lucide-react';
import type { RepositoryInfo } from '../electron.d';
import { settingsSectionOf, type SettingsSection } from '../../main/workspace-windows';
import type { Appearance } from '../lib/theme';
import type { Bindings } from '../lib/keybindings';
import { cn } from '../lib/utils';
import { AboutSettings, AppearanceSettings, EditorSettings, KeyboardSettings, type PropertiesSettings } from './SettingsPage';
import ConnectorsPage from './ConnectorsPage';
import RepositoriesPage from './RepositoriesPage';

const APP_SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'workspaces', label: 'Workspaces', icon: FolderGit2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'editor', label: 'Editor', icon: PencilLine },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'about', label: 'About', icon: Info },
];

const HEADINGS: Record<SettingsSection, { title: string; description?: string }> = {
  appearance: { title: 'Appearance', description: 'Presets update the whole workspace immediately.' },
  keyboard: { title: 'Keyboard' },
  editor: { title: 'Editor' },
  connectors: { title: 'Connectors', description: 'Services you set up once and use in every workspace.' },
  workspaces: { title: 'Workspaces', description: 'A workspace is just a folder of notes — local or in a synced folder like OneDrive or Google Drive.' },
  about: { title: 'About' },
};

function initialSection(): SettingsSection {
  return settingsSectionOf(new URLSearchParams(window.location.search).get('section')) ?? 'appearance';
}

/** A row in a settings section list; the Workspace settings dialog uses it too. */
export function SectionRow({ label, icon: Icon, selected, onSelect }: { label: string; icon: React.ComponentType<{ className?: string }>; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-current={selected ? 'page' : undefined} onClick={onSelect}
      className={cn('interactive flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]',
        selected && 'bg-[var(--surface-hover)] text-[var(--ink)]')}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

interface SettingsWindowProps {
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  bindings: Bindings;
  onBindingsChange: (bindings: Bindings) => void;
  properties: PropertiesSettings;
  onPropertiesChange: (properties: PropertiesSettings) => void;
  recents: RepositoryInfo[];
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
      const next = settingsSectionOf(asked);
      if (next) setSection(next);
      loadOpener();
    });
    // Workspaces open and close in other windows while this one waits.
    window.addEventListener('focus', reload);
    return () => { unsubscribe?.(); window.removeEventListener('focus', reload); };
  }, [loadOpener, reload]);

  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [section]);

  const heading = HEADINGS[section];
  // The same icon as the section's row in the list beside it.
  const HeadingIcon = APP_SECTIONS.find((row) => row.id === section)!.icon;
  let content: React.ReactNode;
  switch (section) {
    case 'appearance': content = <AppearanceSettings appearance={props.appearance} onAppearanceChange={props.onAppearanceChange} />; break;
    case 'keyboard': content = <KeyboardSettings bindings={props.bindings} onBindingsChange={props.onBindingsChange} />; break;
    case 'editor': content = <EditorSettings properties={props.properties} onPropertiesChange={props.onPropertiesChange} />; break;
    case 'connectors': content = <ConnectorsPage />; break;
    case 'workspaces': content = <RepositoriesPage opener={opener} recents={props.recents} onSwitch={props.onSwitchRepo} onReload={reload} />; break;
    case 'about': content = <AboutSettings />; break;
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--nav)] font-sans text-[var(--ink)]" data-utility-window="settings">
      <header className="titlebar flex h-10 shrink-0 items-center gap-2 px-4 text-[13px] font-medium text-[var(--ink-secondary)]">
        <Settings className="h-[15px] w-[15px] shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />Settings
      </header>
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <nav aria-label="Settings sections" className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto p-1">
          <p className="px-2 pb-1 text-xs text-[var(--ink-muted)]">Neuron</p>
          {APP_SECTIONS.map((row) => (
            <SectionRow key={row.id} label={row.label} icon={row.icon} selected={section === row.id} onSelect={() => setSection(row.id)} />
          ))}
        </nav>
        <main className="shell-card flex min-w-0 flex-1 flex-col" data-settings-section={section}>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="w-full max-w-[720px] px-7 pb-12 pt-6">
              <h1 className="flex items-center gap-2 text-[18px] font-semibold text-[var(--ink)]">
                <HeadingIcon className="h-[18px] w-[18px] shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />{heading.title}
              </h1>
              {heading.description && <p className="mt-1 text-[13px] leading-5 text-[var(--ink-secondary)]">{heading.description}</p>}
              <div className="mt-6">{content}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
