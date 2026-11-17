import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, GripVertical, ChevronDown, ChevronRight, ChevronsDownUp, FileCode2, FilePlus2, FolderClosed, FolderOpen, FolderPlus, Plus, RefreshCw, Search, Tag, Trash2, X } from 'lucide-react';
import ActivityRail, { type SettingsTarget, type SidebarMode } from './ActivityRail';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import OtherFileIcon from './OtherFileIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { SIDEBAR_MIME } from '../lib/layout';
import { cn } from '../lib/utils';
import { searchNotes } from '../lib/search';

type View = 'notes' | 'gallery';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectMode: (mode: SidebarMode) => void;
  onOpenSettings: (section: SettingsTarget) => void;
  graphOpen: boolean;
  onToggleGraph: () => void;
  sidebarSide: 'left' | 'right';
  onMoveSidebar: (side: 'left' | 'right') => void;
  notes: string[];
  /** Note bodies, so search can look inside them and not only at filenames. */
  notesData?: { path: string; content: string }[];
  selectedNote: string | null;
  onSelectNote: (note: string) => void;
  /** Open as a tab that stays. A double click's first click has already opened the preview. */
  onKeepNote?: (note: string) => void;
  onDeleteNote: (note: string) => Promise<boolean>;
  onRequestCreate: (section?: string) => void;
  onRequestCreateFolder: () => void;
  onRequestCreateKind: (kind: 'database' | 'canvas') => void;
  onRefresh: () => Promise<void>;
  view: View;
  mode: SidebarMode;
  repositoryName: string;
  folders: string[];
  /** Files Neuron does not open: listed, selectable, never opened. */
  otherFiles: string[];
  onReveal: (path: string) => void;
  revealedFolder: string | null;
  tags: string[];
  onSelectTag: (tag: string | null) => void;
  selectedTag: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  folders: Map<string, TreeNode>;
  files: { name: string; path: string; other?: boolean }[];
}

function buildTree(paths: string[], other: ReadonlySet<string> = new Set()): TreeNode {
  const root: TreeNode = { name: '', path: '', folders: new Map(), files: [] };
  for (const full of paths) {
    const segments = full.split('/');
    const fileName = segments.pop() as string;
    let node = root;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (!node.folders.has(segment)) {
        node.folders.set(segment, { name: segment, path: prefix, folders: new Map(), files: [] });
      }
      node = node.folders.get(segment) as TreeNode;
    }
    if (fileName) node.files.push({ name: fileName, path: full, other: other.has(full) });
  }
  return root;
}

// A folder is a mini-app when it holds a neuron.app.json marker: its contents
// collapse into a single node that opens the folder's index.html entry.
const isAppFolder = (node: TreeNode): boolean => node.files.some((f) => f.name === 'neuron.app.json');
const isAppInternal = (name: string): boolean => name === 'neuron.app.json';
const NONE: string[] = [];

function allFolderPaths(node: TreeNode, out: string[] = []): string[] {
  for (const child of node.folders.values()) {
    out.push(child.path);
    allFolderPaths(child, out);
  }
  return out;
}

function ToolbarButton({ label, onClick, busy, children }: { label: string; onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-busy={busy}
          onClick={onClick}
          className="interactive grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Sidebar(props: SidebarProps) {
  const dragHandle = (
    <button aria-label="Move sidebar" title={props.sidebarSide === 'left' ? 'Move sidebar to the right' : 'Move sidebar to the left'}
      draggable className="interactive grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]"
      onClick={() => props.onMoveSidebar(props.sidebarSide === 'left' ? 'right' : 'left')}
      onDragStart={(event) => { event.dataTransfer.setData(SIDEBAR_MIME, 'sidebar'); event.dataTransfer.effectAllowed = 'move'; }}>
      <GripVertical className="h-4 w-4" />
    </button>
  );
  const { notes, notesData, selectedNote, onSelectNote, onDeleteNote, onRequestCreate, onRequestCreateFolder, onRefresh, view, mode, repositoryName, tags, onSelectTag, selectedTag } = props;
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Folders start collapsed by default — collapse them all when a workspace's
  // explorer tree first populates (and again after switching workspaces). Search
  // mode overrides this per-folder below so matches stay visible.
  const collapsedForRepo = useRef<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The search box only filters in search mode; the explorer always shows all.
  const query = mode === 'search' ? search.trim() : '';

  // Ranked over names AND bodies. This used to be a substring test against the
  // path, so a word you knew you had written was unfindable unless it happened
  // to be in the filename.
  const hits = useMemo(
    () => (query ? searchNotes(notesData ?? notes.map((path) => ({ path, content: '' })), query) : []),
    [notesData, notes, query],
  );
  const filtered = useMemo(() => (query ? hits.map((hit) => hit.path) : notes), [hits, notes, query]);
  const otherFiles = query ? NONE : props.otherFiles;
  const tree = useMemo(
    () => buildTree([...filtered, ...otherFiles, ...props.folders.map(path => path + '/')], new Set(otherFiles)),
    [filtered, otherFiles, props.folders],
  );
  // An other file is selected here only: it has no tab to be the open one.
  const [selectedOther, setSelectedOther] = useState<string | null>(null);
  useEffect(() => setSelectedOther(null), [selectedNote]);

  useEffect(() => {
    if (collapsedForRepo.current === repositoryName || tree.folders.size === 0) return;
    collapsedForRepo.current = repositoryName;
    setCollapsed(new Set(allFolderPaths(tree)));
  }, [tree, repositoryName]);

  useEffect(() => {
    if (!props.revealedFolder) return;
    setCollapsed(previous => {
      const next = new Set(previous);
      next.delete(props.revealedFolder!);
      return next;
    });
    requestAnimationFrame(() => document.querySelector('[data-revealed-folder="true"]')?.scrollIntoView({ block: 'nearest' }));
  }, [props.revealedFolder]);

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const collapseAll = () => setCollapsed(new Set(allFolderPaths(tree)));

  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  const handleDelete = async (note: string) => {
    setDeletingNote(note);
    const ok = await onDeleteNote(note);
    setDeletingNote(null);
    if (ok) setPendingDelete(null);
  };

  const renderOther = (file: { name: string; path: string }, depth: number) => {
    const isSelected = selectedOther === file.path;
    return (
      <ContextMenu key={file.path}>
        <ContextMenuTrigger asChild>
          <div className="note-row group interactive mb-0.5 flex items-center gap-2 pr-2" data-selected={isSelected} data-other-file={file.path} style={{ paddingLeft: `${8 + depth * 14}px` }}>
            <button aria-pressed={isSelected} title={`${file.name} (Neuron does not open this kind of file)`} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[var(--ink-muted)]" onClick={() => { setSelectedOther(file.path); setPendingDelete(null); }}>
              <OtherFileIcon path={file.path} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-sans text-[12px]">{file.name}</span>
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => props.onReveal(file.path)}>Show in folder</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderFile = (file: { name: string; path: string; other?: boolean }, depth: number) => {
    if (file.other) return renderOther(file, depth);
    const isSelected = selectedNote === file.path && view === 'notes' && !selectedOther;
    const isConfirming = pendingDelete === file.path;
    return (
      <div key={file.path} className="note-row group interactive mb-0.5 flex items-center gap-2 pr-2" data-selected={isSelected} style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <button aria-current={isSelected ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onClick={() => { onSelectNote(file.path); setSelectedOther(null); setPendingDelete(null); }} onDoubleClick={() => props.onKeepNote?.(file.path)}>
          <FileCode2 className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]')} />
          <span className="truncate font-sans text-[12px]">{file.name.replace(/\.(md|mdx)$/, '')}</span>
        </button>
        {isConfirming ? (
          <button aria-busy={deletingNote === file.path} disabled={deletingNote === file.path} className="interactive min-h-[28px] rounded px-1.5 py-1 text-[10px] font-semibold text-[var(--danger)] hover:bg-[var(--danger-surface)]" onClick={() => handleDelete(file.path)}>
            {deletingNote === file.path ? 'Deleting…' : 'Delete'}
          </button>
        ) : (
          <button aria-label={`Delete ${file.name}`} title="Delete note" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:bg-[var(--danger-surface)] hover:text-[var(--danger)] group-focus-within:opacity-100 group-hover:opacity-100" onClick={() => setPendingDelete(file.path)}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  const renderApp = (node: TreeNode, depth: number): React.ReactNode => {
    const appPath = `${node.path}/index.html`;
    const isSelected = selectedNote === appPath && view === 'notes';
    return (
      <div key={node.path} className="note-row group interactive mb-0.5 flex items-center gap-2 pr-2" data-selected={isSelected} style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <button aria-current={isSelected ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onClick={() => onSelectNote(appPath)} onDoubleClick={() => props.onKeepNote?.(appPath)}>
          <AppWindow className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]')} />
          <span className="truncate text-[12px] font-medium">{node.name}</span>
          <span className="ml-auto shrink-0 rounded bg-[var(--surface)] px-1 font-sans text-[9px] uppercase tracking-wide text-[var(--ink-muted)]">app</span>
        </button>
      </div>
    );
  };

  const renderFolder = (node: TreeNode, depth: number): React.ReactNode => {
    if (isAppFolder(node)) return renderApp(node, depth);
    // Search mode force-opens every folder so matches aren't hidden inside a
    // collapsed folder; the explorer respects the collapsed set (default: all).
    const isOpen = mode === 'search' ? true : !collapsed.has(node.path);
    const files = node.files.filter((f) => !isAppInternal(f.name));
    return (
      <div key={node.path} data-revealed-folder={node.path === props.revealedFolder}>
        <div className="note-row group interactive mb-0.5 flex items-center gap-1.5 pr-2" style={{ paddingLeft: `${8 + depth * 14}px` }}>
          <button className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left" onClick={() => toggleFolder(node.path)}>
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)] transition-transform', isOpen && 'rotate-90')} />
            {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--ink)]" /> : <FolderClosed className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />}
            <span className="truncate text-[12px] font-medium">{node.name}</span>
          </button>
          <button aria-label={`New note in ${node.name}`} title="New note in section" className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] group-hover:opacity-100" onClick={() => onRequestCreate(node.path)}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {isOpen && (
          <div>
            {[...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => renderFolder(child, depth + 1))}
            {files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => renderFile(file, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const noteTree = (
    <div data-sidebar-tree className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
      {[...tree.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => renderFolder(child, 0))}
      {tree.files.filter((f) => !isAppInternal(f.name)).sort((a, b) => a.name.localeCompare(b.name)).map((file) => renderFile(file, 0))}
      {filtered.length === 0 && otherFiles.length === 0 && props.folders.length === 0 && <div className="px-2 py-8 text-center text-xs leading-5 text-[var(--ink-muted)]">{query ? 'No notes match your search.' : 'No notes yet. Create one to start writing.'}</div>}
    </div>
  );

  return (
    <aside aria-label="Workspace sidebar" data-sidebar-collapsed={props.collapsed} className="nav-surface flex h-full w-full shrink-0 select-none flex-col">
      <ActivityRail view={view} sidebarMode={mode} sidebarOpen tagCount={tags.length} collapsed={props.collapsed} onToggleCollapsed={props.onToggleCollapsed} onSelectMode={props.onSelectMode} onOpenSettings={props.onOpenSettings} graphOpen={props.graphOpen} onToggleGraph={props.onToggleGraph} dragHandle={dragHandle} sidebarSide={props.sidebarSide}>
      {mode === 'files' && (
        <section aria-label="Explorer" className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-7 shrink-0 items-center justify-between px-2">
            <span className="text-xs text-[var(--ink-muted)]">Files</span>
            <div className="flex shrink-0 items-center gap-0.5">
              <div className="flex items-center">
                <ToolbarButton label="New note" onClick={() => onRequestCreate()}><FilePlus2 className="h-3.5 w-3.5" /></ToolbarButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="New…" title="New…" className="interactive -ml-0.5 grid h-6 w-4 shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]">
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onRequestCreate()}>Note</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onRequestCreateKind('database')}>Database</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onRequestCreateKind('canvas')}>Canvas</DropdownMenuItem>
                    <DropdownMenuItem onSelect={onRequestCreateFolder}>Folder</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ToolbarButton label="New section" onClick={onRequestCreateFolder}><FolderPlus className="h-3.5 w-3.5" /></ToolbarButton>
              <ToolbarButton label="Refresh explorer" busy={refreshing} onClick={() => void refresh()}>
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              </ToolbarButton>
              <ToolbarButton label="Collapse sections" onClick={collapseAll}><ChevronsDownUp className="h-3.5 w-3.5" /></ToolbarButton>
            </div>
          </div>
          {noteTree}
        </section>
      )}

      {mode === 'search' && (
        <section aria-label="Search notes" className="flex min-h-0 flex-1 flex-col">
          <div className="p-3">
            <label className="relative block">
              <span className="sr-only">Search notes</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input autoFocus className="field py-1.5 pl-8 pr-8 text-xs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" />
              {search && <button aria-label="Clear search" className="tool-button interactive absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}><X className="h-3.5 w-3.5" /></button>}
            </label>
            <p className="mt-1.5 px-0.5 text-[11px] text-[var(--ink-muted)]">{filtered.length} of {notes.length} notes</p>
          </div>
          {query ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
              {hits.map((hit) => (
                <button
                  key={hit.path}
                  onClick={() => onSelectNote(hit.path)}
                  onDoubleClick={() => props.onKeepNote?.(hit.path)}
                  className={cn(
                    'interactive block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]',
                    selectedNote === hit.path && 'bg-[var(--surface-hover)]',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
                    <span className="truncate text-xs font-medium text-[var(--ink)]">{hit.path}</span>
                  </div>
                  {/* The line that matched, so a body hit does not look like a
                      filename hit with nothing behind it. */}
                  {hit.matches.map((match) => (
                    <div key={match.line} className="mt-0.5 flex gap-1.5 pl-5">
                      <span className="shrink-0 font-sans text-[10px] tabular-nums text-[var(--ink-muted)]">{match.line}</span>
                      <span className="truncate font-sans text-[10px] leading-4 text-[var(--ink-secondary)]">{match.text}</span>
                    </div>
                  ))}
                </button>
              ))}
              {hits.length === 0 && (
                <div className="px-2 py-8 text-center text-xs leading-5 text-[var(--ink-muted)]">No notes match your search.</div>
              )}
            </div>
          ) : noteTree}
        </section>
      )}

      {mode === 'tags' && (
        <section aria-label="Tag filters" className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-3 py-2 text-xs text-[var(--ink-muted)]">
            <span className="flex items-center gap-1.5 font-semibold text-[var(--ink)]"><Tag className="h-3.5 w-3.5 text-[var(--ink-muted)]" />Tags</span>
            {selectedTag && <button className="interactive text-[var(--ink)] hover:text-[var(--ink)]" onClick={() => onSelectTag(null)}>Clear filter</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tags.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs leading-5 text-[var(--ink-muted)]">No tags yet. Add #tags to your notes to filter by them.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => <button key={tag} aria-pressed={selectedTag === tag} className="tag-button interactive px-2 font-sans text-[10px]" onClick={() => onSelectTag(selectedTag === tag ? null : tag)}>#{tag}</button>)}
              </div>
            )}
          </div>
        </section>
      )}
      </ActivityRail>
    </aside>
  );
}
