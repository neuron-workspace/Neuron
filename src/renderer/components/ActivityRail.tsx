import * as React from 'react';
import { Blocks, FileCode2, FolderGit2, LayoutGrid, Search, Settings, Tag, Share2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';

type View = 'notes' | 'repositories' | 'plugins' | 'settings' | 'gallery';
export type SidebarMode = 'files' | 'search' | 'tags';

interface ActivityRailProps {
  view: View;
  sidebarMode: SidebarMode;
  sidebarOpen: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  graphOpen: boolean;
  onToggleGraph: () => void;
  children: React.ReactNode;
  tagCount: number;
  sidebarSide: 'left' | 'right';
  dragHandle: React.ReactNode;
  /** Select the content shown below the navigation rows. */
  onSelectMode: (mode: SidebarMode) => void;
  onNavigate: (view: View) => void;
}

function RailButton({ label, text, collapsed, active, badge, onClick, children }: {
  label: string; text: string; collapsed: boolean; active: boolean; badge?: number; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} aria-pressed={active} onClick={onClick}
          className={cn('interactive flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]',
            collapsed && 'justify-center', active && 'bg-[var(--surface-hover)] text-[var(--ink)]')}>
          {children}
          {!collapsed && <><span data-sidebar-label>{text}</span>{badge !== undefined && <span className="ml-auto text-xs text-[var(--ink-muted)]">{badge}</span>}</>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{text}{badge !== undefined ? ' (' + badge + ')' : ''}</TooltipContent>
    </Tooltip>
  );
}

export default function ActivityRail(props: ActivityRailProps) {
  const { view, sidebarMode, sidebarOpen, tagCount, onSelectMode, onNavigate, collapsed, children } = props;
  const modeActive = (mode: SidebarMode) => view === 'notes' && sidebarOpen && sidebarMode === mode;
  const row = (label: string, text: string, active: boolean, onClick: () => void, icon: React.ReactNode, badge?: number) => (
    <RailButton label={label} text={text} active={active} collapsed={collapsed} onClick={onClick} badge={badge}>{icon}</RailButton>
  );
  const collapseLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar to icons';
  return (
    <nav aria-label="Activity" className="flex h-full min-h-0 flex-col gap-0.5 p-1">
      <div className="flex h-7 items-center justify-end gap-0.5">
        {!collapsed && props.dragHandle}
        <Tooltip><TooltipTrigger asChild>
          <button type="button" aria-label={collapseLabel} onClick={props.onToggleCollapsed} className="tool-button interactive">
            {collapsed !== (props.sidebarSide === 'right') ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </TooltipTrigger><TooltipContent side="right">{collapseLabel}</TooltipContent></Tooltip>
      </div>
      {row('Explorer', 'Files', modeActive('files'), () => onSelectMode('files'), <FileCode2 className="h-4 w-4 shrink-0" />)}
      {row('Search notes', 'Search', modeActive('search'), () => onSelectMode('search'), <Search className="h-4 w-4 shrink-0" />)}
      {row('Tags', 'Tags', modeActive('tags'), () => onSelectMode('tags'), <Tag className="h-4 w-4 shrink-0" />, tagCount)}
      {row('Graph', 'Graph', props.graphOpen, props.onToggleGraph, <Share2 className="h-4 w-4 shrink-0" />)}
      {row('Plugins & integrations', 'Plugins', view === 'plugins', () => onNavigate('plugins'), <Blocks className="h-4 w-4 shrink-0" />)}
      {!collapsed && <div className="flex min-h-0 flex-1 flex-col pt-3">
        {sidebarMode !== 'files' && <p className="px-2 text-xs text-[var(--ink-muted)]">{sidebarMode === 'search' ? 'Search' : 'Tags'}</p>}
        {children}
      </div>}
      <div className="mt-auto flex shrink-0 flex-col gap-0.5 pt-2">
        {row('Workspaces', 'Workspaces', view === 'repositories', () => onNavigate('repositories'), <FolderGit2 className="h-4 w-4 shrink-0" />)}
        {row('Component gallery', 'Component gallery', view === 'gallery', () => onNavigate('gallery'), <LayoutGrid className="h-4 w-4 shrink-0" />)}
        {row('Settings', 'Settings', view === 'settings', () => onNavigate('settings'), <Settings className="h-4 w-4 shrink-0" />)}
      </div>
    </nav>
  );
}
