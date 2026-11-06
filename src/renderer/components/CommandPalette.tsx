import { Blocks, Chrome, FileCode2, FolderOpen, FolderPlus, Focus, Globe, PanelsTopLeft, Settings, Shapes, SquareStack, Share2 } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import type { WorkbenchLayout } from '../lib/layout';
import type { RepositoryInfo } from '../electron.d';
import { usePlugins } from '../plugins/host';
import { parentFolder, sharedName } from './TitleBar';
import { formatChord, type Bindings } from '../lib/keybindings';

/**
 * The chord for a command, shown on the right of its row.
 *
 * A palette is the keyboard-first surface of the app, and this one listed nine
 * commands without once mentioning that five of them have a shortcut -- so the
 * fastest way to work was the one thing the interface never taught.
 */
function Shortcut({ chord }: { chord?: string }) {
  if (!chord) return null;
  return (
    <kbd className="ml-auto shrink-0 rounded border border-[var(--divider)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
      {formatChord(chord)}
    </kbd>
  );
}

interface CommandPaletteProps {
  layout: WorkbenchLayout;
  onLayoutChange: (patch: Partial<WorkbenchLayout>) => void;
  onResetLayout: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: string[];
  recents: RepositoryInfo[];
  onOpenRepo: () => void;
  onCreateRepo: () => void;
  onSwitchRepo: (dir: string) => void;
  onSelectNote: (note: string) => void;
  onOpenMarketplace: () => void;
  onOpenSettings: () => void;
  onCreate: () => void;
  onCreateSurface: () => void;
  onOpenWebsite: () => void;
  onOpenGallery: () => void;
  onToggleShell: () => void;
  onToggleGraph: () => void;
  graphActive: boolean;
  shellActive: boolean;
  onImportChromeLogins: () => void;
  /** The user's resolved chords, so the palette teaches the real ones. */
  bindings: Bindings;
}

export default function CommandPalette({ layout, onLayoutChange, onResetLayout, open, onOpenChange, notes, recents, onOpenRepo, onCreateRepo, onSwitchRepo, onSelectNote, onOpenMarketplace, onOpenSettings, onCreate, onCreateSurface, onOpenWebsite, onOpenGallery, onToggleShell, shellActive, onToggleGraph, graphActive, onImportChromeLogins, bindings }: CommandPaletteProps) {
  const { commands, runtimeFor } = usePlugins();
  const close = () => onOpenChange(false);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search notes or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { onCreate(); close(); }}><FolderPlus /> Create note or section<Shortcut chord={bindings['new-note']} /></CommandItem>
          <CommandItem onSelect={() => { onCreateSurface(); close(); }}><SquareStack /> New HTMX view in current folder<Shortcut chord={bindings['new-view']} /></CommandItem>
          <CommandItem onSelect={() => { onToggleShell(); close(); }}><PanelsTopLeft /> {shellActive ? 'Hide workspace layout' : 'Use workspace layout (.neuron/layout.json)'}</CommandItem>
          <CommandItem onSelect={() => { onToggleGraph(); close(); }}><Share2 /> {graphActive ? 'Hide workspace graph' : 'Show workspace graph'}<Shortcut chord={bindings['toggle-graph']} /></CommandItem>
          <CommandItem onSelect={() => { onOpenWebsite(); close(); }}><Globe /> Open website tab<Shortcut chord={bindings['open-website']} /></CommandItem>
          <CommandItem onSelect={() => { onImportChromeLogins(); close(); }}><Chrome /> Import Chrome logins</CommandItem>
          <CommandItem onSelect={() => { onOpenMarketplace(); close(); }}><Blocks /> Plugins & integrations</CommandItem>
          <CommandItem onSelect={() => { onOpenGallery(); close(); }}><Shapes /> Component gallery</CommandItem>
          <CommandItem onSelect={() => { onOpenSettings(); close(); }}><Settings /> Open settings</CommandItem>
        </CommandGroup>

        <CommandGroup heading="Workspaces">
          <CommandItem onSelect={() => { close(); onOpenRepo(); }}><FolderOpen /> Open folder…</CommandItem>
          <CommandItem onSelect={() => { close(); onCreateRepo(); }}><FolderPlus /> Create workspace…</CommandItem>
          {recents.map((repo) => (
            <CommandItem key={repo.path} value={'Switch workspace: ' + repo.name + ' ' + repo.path} onSelect={() => { close(); onSwitchRepo(repo.path); }}>
              <FolderOpen /> Switch workspace: {repo.name}
              {sharedName(recents, repo) && <span className="ml-1 truncate text-[11px] text-[var(--ink-muted)]">{parentFolder(repo.path)}</span>}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Layout">
          <CommandItem onSelect={() => { onLayoutChange({ activityBar: !layout.activityBar }); close(); }}><PanelsTopLeft /> {layout.activityBar ? 'Hide' : 'Show'} activity bar</CommandItem>
          <CommandItem onSelect={() => { onLayoutChange({ statusBar: !layout.statusBar }); close(); }}><PanelsTopLeft /> {layout.statusBar ? 'Hide' : 'Show'} status bar</CommandItem>
          <CommandItem onSelect={() => { close(); void window.electronAPI.windowControls.toggleFullScreen(); }}><Focus /> Toggle full screen<Shortcut chord={bindings['toggle-fullscreen']} /></CommandItem>
          <CommandItem onSelect={() => { onLayoutChange({ zen: !layout.zen }); close(); }}><Focus /> {layout.zen ? 'Exit zen mode' : 'Zen mode'}<Shortcut chord={bindings['toggle-zen']} /></CommandItem>
          {(['sidebar', 'leftPanel', 'rightPanel', 'bottomPanel'] as const).map((key) => (
            <CommandItem key={key} onSelect={() => { onLayoutChange({ [key]: !layout[key] }); close(); }}>
              <PanelsTopLeft /> {layout[key] ? 'Hide' : 'Show'} {key === 'sidebar' ? 'sidebar' : key.replace('Panel', ' dock')}
            </CommandItem>
          ))}
          <CommandItem disabled={layout.sidebarSide === 'left'} onSelect={() => { onLayoutChange({ sidebarSide: 'left' }); close(); }}><PanelsTopLeft /> Move sidebar to the left</CommandItem>
          <CommandItem disabled={layout.sidebarSide === 'right'} onSelect={() => { onLayoutChange({ sidebarSide: 'right' }); close(); }}><PanelsTopLeft /> Move sidebar to the right</CommandItem>
          <CommandItem onSelect={() => { onResetLayout(); close(); }}><PanelsTopLeft /> Reset layout</CommandItem>
        </CommandGroup>

        {commands.length > 0 && (
          <CommandGroup heading="Plugin commands">
            {commands.map(({ pluginId, command }) => (
              <CommandItem key={command.id} value={command.title} onSelect={() => { command.run(runtimeFor(pluginId)); close(); }}>
                <Blocks /> {command.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Notes">
          {notes.map((note) => (
            <CommandItem key={note} value={note} onSelect={() => { onSelectNote(note); close(); }}>
              <FileCode2 /> <span className="font-mono text-xs">{note}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
