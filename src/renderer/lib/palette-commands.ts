// The command palette's own commands, as data: what each is called, what it
// does, and which configurable shortcut (keybindings.ts) runs the same thing.
// The palette renders this list; tools/palette.test.mjs checks it.
import {
  Blocks, Chrome, Columns2, Rows2, Database, FolderOpen, FolderPlus, Focus, Frame, Globe, PanelsTopLeft, Settings, Shapes,
  SquareStack, Share2, Table2, TerminalSquare, type LucideIcon,
} from 'lucide-react';
import type { SavedLayout, WorkbenchLayout } from './layout';
import type { RepositoryInfo } from '../electron.d';
import { formatChord, type Bindings } from './keybindings';
import { parentFolder, sharedName } from './workspace-names';

export type PaletteGroup = 'Actions' | 'Workspaces' | 'Layout';

export interface PaletteCommand {
  /** Stable and unique. */
  id: string;
  group: PaletteGroup;
  /** What the row says, and what typing filters on. Unique. */
  label: string;
  icon: LucideIcon;
  /** The KEY_ACTIONS id whose chord does the same thing, shown on the row. */
  shortcut?: string;
  /** Shown after the label, muted: the folder of a workspace whose name another shares. */
  detail?: string;
  /** What typing matches, when more than the label. */
  value?: string;
  disabled?: boolean;
  /** Close the palette before running: the command opens a dialog or a window of its own. */
  closeFirst?: boolean;
  /** The command puts focus somewhere itself (a new table's first cell); the palette must not take it back. */
  keepsFocus?: boolean;
  run: () => void;
}

export interface PaletteActions {
  onCreate: () => void;
  onCreateKind: (kind: 'database' | 'canvas' | 'table') => void;
  onCreateSurface: () => void;
  onToggleShell: () => void;
  onToggleGraph: () => void;
  onOpenWebsite: () => void;
  onImportChromeLogins: () => void;
  onOpenMarketplace: () => void;
  onOpenGallery: () => void;
  onOpenSettings: () => void;
  onOpenRepo: () => void;
  onCreateRepo: () => void;
  onSwitchRepo: (dir: string) => void;
  onLayoutChange: (patch: Partial<WorkbenchLayout>) => void;
  onToggleFullScreen: () => void;
  onToggleTerminal: () => void;
  onResetLayout: () => void;
  onSearchNotes?: () => void;
  onSplitEditor?: (direction: 'row' | 'column') => void;
  onCloseEditorGroup?: () => void;
  onFocusNextGroup?: () => void;
  onApplySavedLayout?: (id: string) => void;
}

export interface PaletteState {
  layout: WorkbenchLayout;
  savedLayouts: SavedLayout[];
  recents: RepositoryInfo[];
  editorGroups: number;
  canSplitRight: boolean;
  canSplitDown: boolean;
  shellActive: boolean;
  graphActive: boolean;
}

const DOCKS = ['sidebar', 'leftPanel', 'rightPanel', 'bottomPanel'] as const;

export function paletteCommands(state: PaletteState, actions: PaletteActions): PaletteCommand[] {
  const { layout } = state;
  const a = (command: Omit<PaletteCommand, 'group'>): PaletteCommand => ({ ...command, group: 'Actions' });
  const w = (command: Omit<PaletteCommand, 'group'>): PaletteCommand => ({ ...command, group: 'Workspaces' });
  const l = (command: Omit<PaletteCommand, 'group'>): PaletteCommand => ({ ...command, group: 'Layout' });
  return [
    a({ id: 'create-note', label: 'Create note or section', icon: FolderPlus, shortcut: 'new-note', run: actions.onCreate }),
    a({ id: 'new-database', label: 'New database', icon: Database, keepsFocus: true, run: () => actions.onCreateKind('database') }),
    a({ id: 'new-canvas', label: 'New canvas', icon: Frame, keepsFocus: true, run: () => actions.onCreateKind('canvas') }),
    a({ id: 'new-table', label: 'New table', icon: Table2, keepsFocus: true, run: () => actions.onCreateKind('table') }),
    a({ id: 'new-view', label: 'New HTMX view in current folder', icon: SquareStack, shortcut: 'new-view', run: actions.onCreateSurface }),
    a({ id: 'toggle-shell', label: state.shellActive ? 'Hide workspace layout' : 'Use workspace layout (.neuron/layout.json)', icon: PanelsTopLeft, run: actions.onToggleShell }),
    a({ id: 'toggle-graph', label: state.graphActive ? 'Hide workspace graph' : 'Show workspace graph', icon: Share2, shortcut: 'toggle-graph', run: actions.onToggleGraph }),
    a({ id: 'open-website', label: 'Open website tab', icon: Globe, shortcut: 'open-website', run: actions.onOpenWebsite }),
    a({ id: 'import-chrome-logins', label: 'Import Chrome logins', icon: Chrome, run: actions.onImportChromeLogins }),
    a({ id: 'plugins', label: 'Plugins & integrations', icon: Blocks, run: actions.onOpenMarketplace }),
    a({ id: 'gallery', label: 'Component gallery', icon: Shapes, run: actions.onOpenGallery }),
    a({ id: 'settings', label: 'Open settings', icon: Settings, run: actions.onOpenSettings }),

    w({ id: 'open-folder', label: 'Open folder…', icon: FolderOpen, closeFirst: true, run: actions.onOpenRepo }),
    w({ id: 'create-workspace', label: 'Create workspace…', icon: FolderPlus, closeFirst: true, run: actions.onCreateRepo }),
    ...state.recents.map((repo) => w({
      id: 'switch:' + repo.path,
      label: 'Switch workspace: ' + repo.name,
      detail: sharedName(state.recents, repo) ? parentFolder(repo.path) : undefined,
      value: 'Switch workspace: ' + repo.name + ' ' + repo.path,
      icon: FolderOpen, closeFirst: true, run: () => actions.onSwitchRepo(repo.path),
    })),

    l({ id: 'sidebar-collapse', label: layout.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar to icons', icon: PanelsTopLeft, run: () => actions.onLayoutChange({ sidebar: true, sidebarCollapsed: !layout.sidebarCollapsed }) }),
    l({ id: 'status-bar', label: `${layout.statusBar ? 'Hide' : 'Show'} status bar`, icon: PanelsTopLeft, run: () => actions.onLayoutChange({ statusBar: !layout.statusBar }) }),
    l({ id: 'toggle-fullscreen', label: 'Toggle full screen', icon: Focus, shortcut: 'toggle-fullscreen', closeFirst: true, run: actions.onToggleFullScreen }),
    l({ id: 'toggle-zen', label: layout.zen ? 'Exit zen mode' : 'Zen mode', icon: Focus, shortcut: 'toggle-zen', run: () => actions.onLayoutChange({ zen: !layout.zen }) }),
    l({ id: 'toggle-terminal', label: 'Toggle terminal', icon: TerminalSquare, shortcut: 'toggle-terminal', run: actions.onToggleTerminal }),
    ...DOCKS.map((key) => l({
      id: 'dock:' + key,
      label: `${layout[key] ? 'Hide' : 'Show'} ${key === 'sidebar' ? 'sidebar' : key.replace('Panel', ' dock')}`,
      icon: PanelsTopLeft, run: () => actions.onLayoutChange({ [key]: !layout[key] }),
    })),
    l({ id: 'sidebar-left', label: 'Move sidebar to the left', icon: PanelsTopLeft, disabled: layout.sidebarSide === 'left', run: () => actions.onLayoutChange({ sidebarSide: 'left' }) }),
    l({ id: 'sidebar-right', label: 'Move sidebar to the right', icon: PanelsTopLeft, disabled: layout.sidebarSide === 'right', run: () => actions.onLayoutChange({ sidebarSide: 'right' }) }),
    l({ id: 'reset-layout', label: 'Reset layout', icon: PanelsTopLeft, run: actions.onResetLayout }),
    // Full-text search lives in the sidebar; this is its way in now that it has no row there.
    l({ id: 'search-notes', label: 'Search in notes', icon: PanelsTopLeft, run: () => actions.onSearchNotes?.() }),
    l({ id: 'split-right', label: 'Split editor right', icon: Columns2, shortcut: 'split-editor-right', disabled: !state.canSplitRight, run: () => actions.onSplitEditor?.('row') }),
    l({ id: 'split-down', label: 'Split editor down', icon: Rows2, disabled: !state.canSplitDown, run: () => actions.onSplitEditor?.('column') }),
    // The command Split editor right replaced, under its old name.
    l({ id: 'open-to-side', label: 'Open current note to the side', icon: Columns2, disabled: !state.canSplitRight, run: () => actions.onSplitEditor?.('row') }),
    l({ id: 'close-group', label: 'Close editor group', icon: PanelsTopLeft, disabled: state.editorGroups < 2, run: () => actions.onCloseEditorGroup?.() }),
    l({ id: 'focus-next-group', label: 'Focus next editor group', icon: PanelsTopLeft, disabled: state.editorGroups < 2, run: () => actions.onFocusNextGroup?.() }),
    ...state.savedLayouts.map((saved) => l({ id: 'layout:' + saved.id, label: 'Layout: switch to ' + saved.name, icon: PanelsTopLeft, run: () => actions.onApplySavedLayout?.(saved.id) })),
  ];
}

/** The chord a command's row shows: the user's own binding for its shortcut, as the platform writes it. */
export function shortcutText(command: Pick<PaletteCommand, 'shortcut'>, bindings: Bindings): string | null {
  const chord = command.shortcut ? bindings[command.shortcut] : undefined;
  return chord ? formatChord(chord) : null;
}
