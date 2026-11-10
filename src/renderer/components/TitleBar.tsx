import React, { useEffect } from 'react';
import {
  PanelLeft, PanelRight, PanelBottom, PanelsTopLeft, Search, Blocks,
  FolderGit2, ChevronDown, FolderOpen, FolderPlus, Cloud, Focus, RotateCcw, Share2 } from 'lucide-react';
import type { RepositoryInfo } from '../electron.d';
import type { WorkbenchLayout } from '../lib/layout';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';
import { isMac, platform } from '../lib/platform';
import { formatChord } from '../lib/keybindings';

interface TitleBarProps {
  repository: RepositoryInfo | null;
  recents: RepositoryInfo[];
  activeNote: string | null;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  graphOpen: boolean;
  bottomPanelOpen: boolean;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onToggleGraph: () => void;
  onToggleBottomPanel: () => void;
  onOpenMarketplace: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onSwitchRepo: (dir: string) => void;
  onOpenRepo: () => void;
  onCreateRepo: () => void;
  layout: WorkbenchLayout;
  onLayoutChange: (patch: Partial<WorkbenchLayout>) => void;
  onResetLayout: () => void;
}

function IconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'titlebar-no-drag interactive grid h-7 w-7 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]',
            active && 'bg-[var(--surface-hover)] text-[var(--ink)]',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Two different folders with the same name need their location to tell them apart. */
export function sharedName(recents: RepositoryInfo[], repo: RepositoryInfo): boolean {
  return recents.some((other) => other.path !== repo.path && other.name === repo.name);
}

export function parentFolder(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-3, -1).join('/');
}

export default function TitleBar(props: TitleBarProps) {
  const { repository, recents, activeNote } = props;
  // Scope native overlay safe areas and macOS typography to the host.
  useEffect(() => {
    document.body.classList.add(`platform-${platform}`);
  }, []);

  // Only clicks arrive here. The macOS menu shows Cmd+F and Cmd+K without
  // registering them, so those keystrokes still reach CodeMirror's find and the
  // renderer's own chord dispatcher exactly as they did before.
  useEffect(() => {
    return window.electronAPI?.windowControls.onMenuCommand((command) => {
      if (command === 'palette') props.onOpenCommandPalette();
      else if (command === 'settings') props.onOpenSettings();
      else if (command === 'find') {
        // Find belongs to whichever editor has focus, so hand it the keystroke
        // rather than reaching into its internals from out here.
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true }),
        );
      }
    });
  }, [props.onOpenCommandPalette, props.onOpenSettings]);

  useEffect(() => {
    const apply = (state: { fullScreen: boolean }) => {
      document.body.classList.toggle('window-fullscreen', state.fullScreen);
    };
    // A state event takes precedence over the initial IPC snapshot.
    let awaitingInitialState = true;
    const unsubscribe = window.electronAPI?.windowControls.onChromeStateChanged((state) => {
      awaitingInitialState = false;
      apply(state);
    });
    void window.electronAPI?.windowControls.chromeState().then((state) => {
      if (awaitingInitialState) apply(state);
    });
    return () => {
      awaitingInitialState = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <header
      className={cn(
        'titlebar flex items-center justify-between border-b pr-0',
        // Keep toolbar actions clear of macOS traffic lights.
        isMac ? 'pl-[78px]' : 'pl-2',
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <IconButton label={props.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} active={props.sidebarOpen} onClick={props.onToggleSidebar}>
          <PanelLeft className="h-4 w-4" />
        </IconButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="titlebar-no-drag interactive flex min-h-[var(--control-sm)] min-w-0 items-center gap-1.5 rounded-md px-2 text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
              <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />
              <span className="max-w-[160px] truncate text-xs font-medium">{repository?.name ?? 'No workspace'}</span>
              {repository?.cloud && <Cloud className="h-3 w-3 shrink-0 text-[var(--ink-muted)]" />}
              <ChevronDown className="h-3 w-3 shrink-0 text-[var(--ink-muted)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            <DropdownMenuItem onClick={props.onOpenRepo}><FolderOpen className="h-4 w-4" /> Open folder…</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onCreateRepo}><FolderPlus className="h-4 w-4" /> Create workspace…</DropdownMenuItem>
            {recents.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Recent</DropdownMenuLabel>
                {recents.map((repo) => (
                  <DropdownMenuItem key={repo.path} title={repo.path} onClick={() => props.onSwitchRepo(repo.path)}>
                    <FolderGit2 className="h-4 w-4" />
                    <span className="truncate">{repo.name}</span>
                    {sharedName(recents, repo) && <span className="truncate text-[11px] text-[var(--ink-muted)]">{parentFolder(repo.path)}</span>}
                    {repo.cloud && <Cloud className="ml-auto h-3 w-3 text-[var(--ink-muted)]" />}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {activeNote && (
          <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
            <span className="text-[var(--ink-muted)]">/</span>
            <span className="truncate font-mono text-[11px] text-[var(--ink-muted)]">{activeNote}</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        <div className="mr-1 flex items-center gap-0.5">
          <button
            onClick={props.onOpenCommandPalette}
            className="titlebar-no-drag interactive mr-1 flex h-7 items-center gap-2 rounded-md border border-[var(--divider)] bg-[var(--canvas)] px-2.5 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Search & commands</span>
            {/* Was hard-coded to the Mac glyph, so Windows and Linux were told to
              press a key their keyboards do not have. */}
          <kbd className="hidden rounded bg-[var(--surface)] px-1 font-mono text-[10px] md:inline">{formatChord('mod+k')}</kbd>
          </button>
          <IconButton label="Plugins & integrations" onClick={props.onOpenMarketplace}>
            <Blocks className="h-4 w-4" />
          </IconButton>
          {/* A persistent control, because the other two ways in are unreliable:
              the palette and Ctrl+Shift+G both go through a global keydown with
              no focus scopes, so neither fires while the terminal or a webview
              holds focus. Closing the graph must not be one-way. */}
          <IconButton label={props.graphOpen ? 'Hide graph' : 'Show graph'} active={props.graphOpen} onClick={props.onToggleGraph}>
            <Share2 className="h-4 w-4" />
          </IconButton>
          <IconButton label={props.rightPanelOpen ? 'Hide panel' : 'Show panel'} active={props.rightPanelOpen} onClick={props.onToggleRightPanel}>
            <PanelRight className="h-4 w-4" />
          </IconButton>
          <IconButton label={props.bottomPanelOpen ? 'Hide bottom peek' : 'Show bottom peek'} active={props.bottomPanelOpen} onClick={props.onToggleBottomPanel}>
            <PanelBottom className="h-4 w-4" />
          </IconButton>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Customize layout"
                title="Customize layout"
                className="titlebar-no-drag interactive grid h-7 w-7 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
              >
                <PanelsTopLeft className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Customize layout</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={props.layout.activityBar} onCheckedChange={(c) => props.onLayoutChange({ activityBar: !!c })}>Activity bar</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={props.layout.sidebar} onCheckedChange={(c) => props.onLayoutChange({ sidebar: !!c })}>Sidebar</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={props.layout.leftPanel} onCheckedChange={(c) => props.onLayoutChange({ leftPanel: !!c })}>Left panel</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={props.layout.rightPanel} onCheckedChange={(c) => props.onLayoutChange({ rightPanel: !!c })}>Right panel</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={props.layout.bottomPanel} onCheckedChange={(c) => props.onLayoutChange({ bottomPanel: !!c })}>Bottom panel</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={props.layout.statusBar} onCheckedChange={(c) => props.onLayoutChange({ statusBar: !!c })}>Status bar</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => props.onLayoutChange({ zen: !props.layout.zen })}>
                <Focus className="h-4 w-4" /> {props.layout.zen ? 'Exit zen mode' : 'Zen mode'}
                <span className="ml-auto pl-4 font-mono text-[10px] text-[var(--ink-muted)]">Alt+Z</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={props.layout.sidebarSide === 'left'} onSelect={() => props.onLayoutChange({ sidebarSide: 'left' })}>Move sidebar to the left</DropdownMenuItem>
              <DropdownMenuItem disabled={props.layout.sidebarSide === 'right'} onSelect={() => props.onLayoutChange({ sidebarSide: 'right' })}>Move sidebar to the right</DropdownMenuItem>
              <DropdownMenuItem onClick={props.onResetLayout}><RotateCcw className="h-4 w-4" /> Reset layout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
