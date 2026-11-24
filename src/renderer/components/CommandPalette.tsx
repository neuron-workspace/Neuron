import { useRef } from 'react';
import { Blocks, FileCode2 } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import type { SavedLayout, WorkbenchLayout } from '../lib/layout';
import type { RepositoryInfo } from '../electron.d';
import { usePlugins } from '../plugins/host';
import type { Bindings } from '../lib/keybindings';
import { paletteCommands, shortcutText, type PaletteCommand, type PaletteGroup } from '../lib/palette-commands';
import { useTerminalToggle } from '../lib/useTerminalToggle';

/**
 * The chord for a command, shown on the right of its row.
 *
 * A palette is the keyboard-first surface of the app, and this one listed nine
 * commands without once mentioning that five of them have a shortcut -- so the
 * fastest way to work was the one thing the interface never taught.
 */
function Shortcut({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <kbd className="ml-auto shrink-0 rounded border border-[var(--divider)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
      {text}
    </kbd>
  );
}

interface CommandPaletteProps {
  layout: WorkbenchLayout;
  savedLayouts?: SavedLayout[];
  /** Full-text search lives in the sidebar; this is its way in now that it has no row there. */
  onSearchNotes?: () => void;
  /** How many editor groups there are, and whether the focused group's file can split into a new one. */
  editorGroups?: number;
  canSplitRight?: boolean;
  canSplitDown?: boolean;
  onSplitEditor?: (direction: 'row' | 'column') => void;
  onCloseEditorGroup?: () => void;
  onFocusNextGroup?: () => void;
  onApplySavedLayout?: (id: string) => void;
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
  onCreateKind: (kind: 'database' | 'canvas' | 'table') => void;
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

const GROUPS: PaletteGroup[] = ['Actions', 'Workspaces', 'Layout'];

export default function CommandPalette(props: CommandPaletteProps) {
  const { layout, savedLayouts = [], editorGroups = 1, canSplitRight = false, canSplitDown = false, open, onOpenChange, notes, recents, onSelectNote, bindings } = props;
  const { commands: pluginCommands, runtimeFor } = usePlugins();
  const terminal = useTerminalToggle(layout, props.onLayoutChange, props.onOpenMarketplace);
  const close = () => onOpenChange(false);
  // A new file takes focus itself (a new table opens with its first cell
  // focused). Focus returned to the palette's trigger after that would take
  // the first keystrokes typed into it.
  const keepFocus = useRef(false);

  const commands = paletteCommands(
    { layout, savedLayouts, recents, editorGroups, canSplitRight, canSplitDown, shellActive: props.shellActive, graphActive: props.graphActive },
    {
      ...props,
      onToggleFullScreen: () => { void window.electronAPI.windowControls.toggleFullScreen(); },
      onToggleTerminal: () => terminal.toggle(),
    },
  );
  const select = (command: PaletteCommand) => {
    if (command.keepsFocus) keepFocus.current = true;
    if (command.closeFirst) { close(); command.run(); }
    else { command.run(); close(); }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} onCloseAutoFocus={(event) => { if (keepFocus.current) { keepFocus.current = false; event.preventDefault(); } }}>
      <CommandInput placeholder="Search notes or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {GROUPS.map((group) => (
          <CommandGroup key={group} heading={group}>
            {commands.filter((command) => command.group === group).map((command) => {
              const Icon = command.icon;
              return (
                <CommandItem key={command.id} value={command.value ?? command.label} disabled={command.disabled} data-command={command.id} onSelect={() => select(command)}>
                  <Icon /> {command.label}
                  {command.detail && <span className="ml-1 truncate text-[11px] text-[var(--ink-muted)]">{command.detail}</span>}
                  <Shortcut text={shortcutText(command, bindings)} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        {pluginCommands.length > 0 && (
          <CommandGroup heading="Plugin commands">
            {pluginCommands.map(({ pluginId, command }) => (
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
