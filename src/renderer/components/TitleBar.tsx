import React, { useEffect, useState } from 'react';
import {
  PanelLeft, PanelRight, PanelBottom, PanelsTopLeft, Search, Blocks, Minus, Square, Copy, X,
  FolderGit2, ChevronDown, FolderOpen, FolderPlus, Cloud, Focus, RotateCcw, Share2 } from 'lucide-react';
import type { RepositoryInfo } from '../electron.d';
import type { WorkbenchLayout } from '../lib/layout';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';
import { isMac, platform, usesCustomWindowControls } from '../lib/platform';
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

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="currentColor">
      <g transform="translate(256,256)">
        <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(0)"/>
        <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(72)"/>
        <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(144)"/>
        <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(216)"/>
        <polygon points="-24,-136 24,-136 16,6 -16,6" transform="rotate(288)"/>
      </g>
    </svg>
  );
}

export default function TitleBar(props: TitleBarProps) {
  const { repository, recents, activeNote } = props;
  const [maximized, setMaximized] = useState(false);

  // The platform never changes under a running window, so this is set once and
  // left alone. It is what scopes the Windows maximise workaround and the macOS
  // chrome rules in index.css, rather than either leaking onto the other.
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
    const apply = (state: { inset: boolean; fullScreen: boolean }) => {
      setMaximized(state.inset);
      document.body.classList.toggle('window-maximized', state.inset);
      document.body.classList.toggle('window-fullscreen', state.fullScreen);
    };
    window.electronAPI?.windowControls.chromeState().then(apply);
    return window.electronAPI?.windowControls.onChromeStateChanged(apply);
  }, []);

  return (
    <header
      className={cn(
        'titlebar flex items-center justify-between border-b pr-0',
        // The traffic lights are drawn by macOS in the window's top-left, over
        // whatever is there. Without this the logo and sidebar toggle end up
        // underneath them.
        isMac ? 'pl-[78px]' : 'pl-2',
        maximized && 'maximized',
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span className="neuron-logo-bg ml-1 grid h-6 w-6 shrink-0 place-items-center rounded border border-[var(--divider)]">
          <SparkIcon className="neuron-logo h-3.5 w-3.5" />
        </span>

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
                  <DropdownMenuItem key={repo.path} onClick={() => props.onSwitchRepo(repo.path)}>
                    <FolderGit2 className="h-4 w-4" />
                    <span className="truncate">{repo.name}</span>
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

      <div className="flex items-center">
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
              <DropdownMenuCheckboxItem checked={props.layout.rightPanel} onCheckedChange={(c) => props.onLayoutChange({ rightPanel: !!c })}>Side panel</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={props.layout.bottomPanel} onCheckedChange={(c) => props.onLayoutChange({ bottomPanel: !!c })}>Bottom panel</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={props.layout.statusBar} onCheckedChange={(c) => props.onLayoutChange({ statusBar: !!c })}>Status bar</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => props.onLayoutChange({ zen: !props.layout.zen })}>
                <Focus className="h-4 w-4" /> {props.layout.zen ? 'Exit zen mode' : 'Zen mode'}
                <span className="ml-auto pl-4 font-mono text-[10px] text-[var(--ink-muted)]">Alt+Z</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={props.onResetLayout}><RotateCcw className="h-4 w-4" /> Reset layout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* macOS draws its own traffic lights and they are the real controls.
            Painting a second set beside them would be three buttons that look
            native, are not, and sit next to the ones that are. */}
        {usesCustomWindowControls && (
          <div className="ml-1 flex items-center">
            <button className="window-control" aria-label="Minimize" onClick={() => window.electronAPI?.windowControls.minimize()}>
              <Minus className="h-4 w-4" />
            </button>
            <button
              className="window-control"
              // "Restore" alone collided with the Restore buttons in the panel
              // rail and in version history, so a by-name lookup could match a
              // window control and resize the window instead.
              aria-label={maximized ? 'Restore window' : 'Maximize window'}
              onClick={async () => setMaximized(await window.electronAPI.windowControls.toggleMaximize())}
            >
              {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
            </button>
            <button className="window-control danger" aria-label="Close" onClick={() => window.electronAPI?.windowControls.close()}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
