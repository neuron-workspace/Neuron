import * as React from 'react';
import { ChevronDown, Database, FileCode2, FilePlus2, FileText, Folder, FolderPlus, Frame, GitBranch, Image as ImageIcon, Table2 } from 'lucide-react';
import { breadcrumbs, describeCounts, listFolder, parentFolder, type RecentEntry } from '../lib/workspace-explorer';
import { nextUntitled } from '../lib/untitled';
import { NEW_FILE_KINDS, startingCompanions, startingContent, type NewFileKind } from '../lib/new-file';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { noteTags } from '../lib/note-tags';
import { Segmented } from '../components/ui/segmented';
import MDXPreview from '../components/MDXPreview';
import OtherFileIcon from '../components/OtherFileIcon';

const NONE: string[] = [];
const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' bytes';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ' + units[unit];
};

interface WorkspaceExplorerProps {
  repositoryName: string;
  paths: string[];
  /** Files Neuron does not open. Listed and selectable, never opened. */
  otherFiles?: string[];
  fileInfo?: Record<string, { size: number; modified: number }>;
  skipped?: number;
  truncated?: boolean;
  onReveal?: (path: string) => void;
  folders: string[];
  notesData: { path: string; content: string }[];
  folder: string;
  onNavigate: (folder: string) => void;
  onOpenFile: (path: string) => void;
  onOpenToSide?: (path: string) => void;
  onCreateNote: (path: string, content?: string, companions?: { path: string; content: string }[]) => Promise<boolean>;
  onCreateFolder: (path: string) => Promise<boolean>;
  recents: RecentEntry[];
  onClearRecents: () => void;
}

type Item = { path: string; name: string; kind: 'folder' | 'file'; extension: string; other?: boolean };
const isNote = (path: string) => /\.(md|mdx)$/i.test(path);
const wordCount = (content: string) => content.trim() ? content.trim().split(/\s+/u).length : 0;
const fileType = (entry: Item) => {
  if (entry.other) return 'Other file';
  if (isNote(entry.path)) return 'Note';
  if (entry.extension === 'db') return 'Database';
  if (entry.extension === 'canvas') return 'Canvas';
  if (entry.extension === 'csv') return 'Table';
  if (entry.extension === 'html') return 'Web view';
  return entry.extension ? entry.extension.toUpperCase() + ' file' : 'File';
};

function ItemIcon({ item }: { item: Item }) {
  if (item.kind === 'folder') return <Folder className="explorer-folder-icon" fill="currentColor" strokeWidth={1.25} />;
  if (item.other) return <OtherFileIcon path={item.path} strokeWidth={1.5} />;
  const Icon = ({ db: Database, canvas: Frame, csv: Table2, html: FileCode2, mmd: GitBranch,
    mermaid: GitBranch, png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, svg: ImageIcon, webp: ImageIcon }[item.extension] ?? FileText);
  return <Icon strokeWidth={1.5} />;
}

export default function WorkspaceExplorer({ repositoryName, paths: notePaths, otherFiles = NONE, fileInfo, skipped = 0, truncated = false, onReveal,
  folders, notesData, folder, onNavigate, onOpenFile, onOpenToSide, onCreateNote, onCreateFolder, recents, onClearRecents }: WorkspaceExplorerProps) {
  const paths = React.useMemo(() => otherFiles.length ? [...notePaths, ...otherFiles] : notePaths, [notePaths, otherFiles]);
  const others = React.useMemo(() => new Set(otherFiles), [otherFiles]);
  const toItems = React.useCallback((listing: ReturnType<typeof listFolder>): Item[] => [
    ...listing.folders.map(entry => ({ ...entry, kind: 'folder' as const, extension: '' })),
    ...listing.files.map(entry => ({ ...entry, kind: 'file' as const, other: others.has(entry.path) }))], [others]);
  const [view, setView] = React.useState<'list' | 'grid'>('list');
  const viewChanged = React.useRef(false);
  const [selection, setSelection] = React.useState<{ folder: string; path: string } | null>(null);
  const [draft, setDraft] = React.useState<{ kind: Item['kind']; fileKind: NewFileKind; name: string } | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const committing = React.useRef(false);
  const cancelled = React.useRef(false);
  const input = React.useRef<HTMLInputElement>(null);
  const itemsArea = React.useRef<HTMLDivElement>(null);
  const listbox = React.useRef<HTMLDivElement>(null);
  const focusListing = React.useRef(false);
  const focusCreatedFolder = React.useRef<string | null>(null);
  const optionRefs = React.useRef(new Map<string, HTMLDivElement>());
  const id = React.useId();
  const trail = breadcrumbs(folder);
  const items = React.useMemo<Item[]>(() => toItems(listFolder(paths, folder, folders)), [paths, folders, folder, toItems]);
  const selected = items.find(item => selection?.folder === folder && selection.path === item.path);
  const preview: Item = selected ?? { path: folder, name: trail.at(-1)?.name ?? repositoryName, kind: 'folder', extension: '' };
  const contentByPath = React.useMemo(() => new Map(notesData.map(note => [note.path, note.content])), [notesData]);
  const words = React.useMemo(() => new Map(notesData.filter(note => isNote(note.path)).map(note => [note.path, wordCount(note.content)])), [notesData]);
  const stats = React.useMemo(() => {
    const result = new Map<string, { notes: number; folders: number; other: number; words: number }>();
    const get = (path: string) => {
      if (!result.has(path)) result.set(path, { notes: 0, folders: 0, other: 0, words: 0 });
      return result.get(path)!;
    };
    const allFolders = new Set(folders);
    for (const path of [...paths, ...folders]) {
      let parent = parentFolder(path);
      while (parent) { allFolders.add(parent); parent = parentFolder(parent); }
    }
    for (const path of paths) {
      let parent = parentFolder(path);
      while (true) {
        const stat = get(parent);
        if (isNote(path)) { stat.notes++; stat.words += words.get(path) ?? 0; } else stat.other++;
        if (!parent) break;
        parent = parentFolder(parent);
      }
    }
    for (const path of allFolders) {
      let parent = parentFolder(path);
      while (true) { get(parent).folders++; if (!parent) break; parent = parentFolder(parent); }
    }
    return result;
  }, [paths, folders, words]);
  const counts = (path: string) => stats.get(path) ?? { notes: 0, folders: 0, other: 0, words: 0 };
  // A grid tile has room for the total only; the list and the preview say what it is made of.
  const detail = (item: Item) => item.kind === 'folder' ? describeCounts(counts(item.path), view === 'grid') : fileType(item);
  const children = React.useMemo(
    () => preview.kind === 'folder' ? toItems(listFolder(paths, preview.path, folders)) : [],
    [paths, folders, preview.kind, preview.path, toItems],
  );

  React.useEffect(() => {
    let alive = true;
    void window.electronAPI.settings.get<unknown>('explorerView').then(stored => {
      if (alive && !viewChanged.current && (stored === 'list' || stored === 'grid')) setView(stored);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  React.useEffect(() => { setDraft(null); setError(''); }, [folder]);
  React.useEffect(() => { if (draft) { input.current?.focus(); input.current?.select(); } }, [draft?.kind, draft?.fileKind]);

  React.useLayoutEffect(() => {
    if (focusListing.current) {
      focusListing.current = false;
      const item = selected ?? items[0];
      (item ? optionRefs.current.get(item.path) : listbox.current)?.focus();
    }
    if (focusCreatedFolder.current && selected?.path === focusCreatedFolder.current) {
      optionRefs.current.get(selected.path)?.focus();
      focusCreatedFolder.current = null;
    }
  }, [folder, items, selected?.path, draft]);

  const navigate = (path: string) => {
    if (path === folder) return;
    focusListing.current = true;
    setSelection(null);
    onNavigate(path);
  };
  const select = (item: Item) => { setSelection({ folder, path: item.path }); optionRefs.current.get(item.path)?.focus(); };
  // An other file is never opened, here or by the system: selecting is all it does.
  const open = (item: Item) => item.kind === 'folder' ? navigate(item.path) : item.other ? select(item) : onOpenFile(item.path);
  const onKeyDown = (event: React.KeyboardEvent, item: Item) => {
    const index = items.indexOf(item);
    let next = index;
    const columns = view === 'grid' ? Math.max(1, Math.floor(((itemsArea.current?.clientWidth ?? 132) + 4) / 136)) : 1;
    switch (event.key) {
      case 'Enter': open(item); break;
      case 'Backspace': if (folder) navigate(parentFolder(folder)); break;
      case 'ArrowDown': next = Math.min(items.length - 1, index + columns); break;
      case 'ArrowUp': next = Math.max(0, index - columns); break;
      case 'ArrowRight': if (view !== 'grid') return; next = Math.min(items.length - 1, index + 1); break;
      case 'ArrowLeft': if (view !== 'grid') return; next = Math.max(0, index - 1); break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key !== 'Enter' && event.key !== 'Backspace' && items[next]) {
      select(items[next]); optionRefs.current.get(items[next].path)?.scrollIntoView({ block: 'nearest' });
    }
  };
  const startCreate = (kind: Item['kind'], fileKind: NewFileKind = 'note') => {
    cancelled.current = false;
    const ext = kind === 'folder' ? '' : NEW_FILE_KINDS[fileKind].ext;
    const path = nextUntitled([...paths, ...folders], folder, kind === 'folder' ? 'Untitled folder' : 'Untitled', ext);
    setError('');
    const leaf = path.slice(path.lastIndexOf('/') + 1);
    setDraft({ kind, fileKind, name: ext ? leaf.slice(0, -ext.length) : leaf });
  };
  const cancelCreate = () => { cancelled.current = true; focusListing.current = true; setDraft(null); setError(''); };
  const commit = async () => {
    if (!draft || committing.current || cancelled.current) return;
    const name = draft.name.trim();
    if (!name) { cancelCreate(); return; }
    const filename = name + (draft.kind === 'file' ? NEW_FILE_KINDS[draft.fileKind].ext : '');
    let invalid = '';
    if (/[\/\\:*?"<>|]/.test(name)) invalid = 'Names cannot contain / \\ : * ? " < > |.';
    else if (name.startsWith('.')) invalid = 'Names cannot start with a dot.';
    else if (name.length > 120) invalid = 'Use 120 characters or fewer.';
    else if (items.some(item => item.name.toLowerCase() === filename.toLowerCase())) invalid = 'That name already exists.';
    if (invalid) { setError(invalid); return; }
    committing.current = true;
    setBusy(true);
    const path = (folder ? folder + '/' : '') + filename;
    try {
      const ok = draft.kind === 'file'
        ? await onCreateNote(path, startingContent(draft.fileKind) ?? '# ' + name + '\n\n', startingCompanions(draft.fileKind, path))
        : await onCreateFolder(path);
      if (ok) { setDraft(null); setError(''); if (draft.kind === 'folder') { focusCreatedFolder.current = path; setSelection({ folder, path }); } }
      else setError('Could not create this item. Try again.');
    } finally { committing.current = false; setBusy(false); }
  };
  const createButtons = <>
    <span className="explorer-split">
      <button type="button" className="explorer-action interactive" disabled={busy} onClick={() => startCreate('file')}><FilePlus2 />New file</button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="New file type…" title="New file type…" className="explorer-action explorer-split-chevron interactive" disabled={busy}><ChevronDown aria-hidden="true" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(['note', 'database', 'canvas', 'table'] as const).map(kind => <DropdownMenuItem key={kind} onSelect={() => startCreate('file', kind)}>{NEW_FILE_KINDS[kind].label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
    <button type="button" className="explorer-action interactive" disabled={busy} onClick={() => startCreate('folder')}><FolderPlus />New folder</button>
  </>;
  const previewContent = contentByPath.get(preview.path) ?? '';
  const tags = React.useMemo(() => isNote(preview.path) ? noteTags(previewContent) : [], [preview.path, previewContent]);
  const previewCounts = counts(preview.path);
  const previewInfo = preview.other ? fileInfo?.[preview.path] : undefined;

  return (
    <section className="workspace-explorer" data-workspace-explorer data-explorer-paths={paths.length}>
      <header className="explorer-toolbar">
        <nav aria-label="Breadcrumb" className="explorer-breadcrumb">
          {folder ? <button className="interactive" onClick={() => navigate('')}>{repositoryName}</button> : <span aria-current="page">{repositoryName}</span>}
          {trail.map((crumb, index) => <React.Fragment key={crumb.path}>
            <span aria-hidden="true">/</span>
            {index === trail.length - 1 ? <span aria-current="page">{crumb.name}</span> : <button className="interactive" onClick={() => navigate(crumb.path)}>{crumb.name}</button>}
          </React.Fragment>)}
        </nav>
        <div className="explorer-tools">{createButtons}<Segmented label="Explorer view" value={view}
          options={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }]}
          onChange={next => { viewChanged.current = true; setView(next); void window.electronAPI.settings.set('explorerView', next); }} /></div>
      </header>
      {(skipped > 0 || truncated) && <p className="explorer-notice" role="status">
        {[skipped > 0 && 'Some items could not be read.', truncated && 'Showing the first 20,000 items.'].filter(Boolean).join(' ')}
      </p>}
      <div className="explorer-body">
        <div className="explorer-list-scroll">
          <div ref={itemsArea} className={'explorer-items explorer-' + view}>
            {draft && <form className="explorer-draft" style={{ order: draft.kind === 'folder' ? -1 : 1 }} onSubmit={event => { event.preventDefault(); void commit(); }}>
              <label className="sr-only" htmlFor={id + '-name'}>{draft.kind === 'file' ? 'File name' : 'Folder name'}</label>
              <div className="explorer-draft-field">
                <input ref={input} id={id + '-name'} className="field" value={draft.name} disabled={busy}
                  aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined}
                  onChange={event => { setDraft({ ...draft, name: event.target.value }); setError(''); }}
                  onBlur={() => void commit()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancelCreate(); } }} />
                {draft.kind === 'file' && <span aria-hidden="true" className="explorer-draft-ext">{NEW_FILE_KINDS[draft.fileKind].ext}</span>}
              </div>
              {error && <p id={id + '-error'} role="alert">{error}</p>}
            </form>}
            <div ref={listbox} role="listbox" aria-label={folder ? 'Contents of ' + previewFolderName(folder) : 'Workspace contents'} className="explorer-listbox"
              tabIndex={items.length ? undefined : 0} onKeyDown={event => { if (event.key === 'Backspace' && folder) { event.preventDefault(); navigate(parentFolder(folder)); } }}>
              {items.map((item, index) => <div key={item.path} role="option" aria-label={item.name} aria-selected={selected?.path === item.path}
                ref={node => { if (node) optionRefs.current.set(item.path, node); else optionRefs.current.delete(item.path); }}
                tabIndex={selected ? (selected.path === item.path ? 0 : -1) : index === 0 ? 0 : -1}
                data-folder={item.kind === 'folder' ? item.path : undefined} data-file={item.kind === 'file' && !item.other ? item.path : undefined}
                data-other-file={item.other ? item.path : undefined}
                className="explorer-item interactive" style={{ order: item.kind === 'folder' ? 0 : 2 }} title={item.name}
                onClick={() => select(item)} onDoubleClick={() => open(item)} onKeyDown={event => onKeyDown(event, item)}>
                <ItemIcon item={item} />
                <span className="explorer-item-name">{item.name}</span>
                <span className="explorer-item-detail">{detail(item)}</span>
                {item.kind === 'file' && isNote(item.path) && <span className="explorer-word-count">{words.get(item.path) ?? 0} words</span>}
              </div>)}
            </div>
          </div>
          {!items.length && !draft && <div className="explorer-empty"><p>This folder is empty.</p><div className="explorer-tools">{createButtons}</div></div>}
          {!folder && recents.length > 0 && <section className="explorer-recents" aria-label="Recent">
            <div className="flex items-center gap-2"><h2>Recent</h2><button className="explorer-action interactive" onClick={onClearRecents}>Clear</button></div>
            {recents.map(entry => <button key={entry.path} className="explorer-recent interactive" data-recent={entry.path}
              onClick={() => entry.kind === 'folder' ? navigate(entry.path) : onOpenFile(entry.path)} title={entry.path}>{entry.path}</button>)}
          </section>}
        </div>
        <aside aria-label="Preview" className="explorer-preview">
          <h2>{preview.name}</h2><p className="explorer-preview-path">{preview.path || '/'}</p>
          {preview.kind === 'folder' ? <>
            <p className="explorer-metadata">{describeCounts(previewCounts)}<br />{previewCounts.words} words</p>
            <button className="explorer-action interactive" onClick={() => open(preview)}>Open</button>
            <h3>Contents</h3>
            {children.slice(0, 12).map(child => <div key={child.path} className="explorer-preview-child"><ItemIcon item={child} /><span>{child.name}</span></div>)}
            {children.length > 12 && <p className="explorer-metadata">and {children.length - 12} more</p>}
            {!children.length && <p className="explorer-metadata">This folder is empty.</p>}
          </> : preview.other ? <>
            <p className="explorer-metadata">
              Other file{previewInfo && <>{' · ' + formatSize(previewInfo.size)}<br />Modified {new Date(previewInfo.modified).toLocaleString()}</>}
            </p>
            {onReveal && <div className="explorer-tools"><button className="explorer-action interactive" onClick={() => onReveal(preview.path)}>Show in folder</button></div>}
          </> : <>
            <p className="explorer-metadata">{fileType(preview)}{isNote(preview.path) && ' · ' + (words.get(preview.path) ?? 0) + ' words'}</p>
            {tags.length > 0 && <p className="explorer-metadata" aria-label="Tags">{tags.map(tag => '#' + tag).join(' ')}</p>}
            <div className="explorer-tools"><button className="explorer-action interactive" onClick={() => open(preview)}>Open</button>
              {isNote(preview.path) && onOpenToSide && <button className="explorer-action interactive" onClick={() => onOpenToSide(preview.path)}>Open to the side</button>}</div>
            {isNote(preview.path) && <div className="explorer-note-preview"><MDXPreview key={preview.path} mdxContent={previewContent.split('\n').slice(0, 40).join('\n')} editable={false} showProperties={false} /></div>}
          </>}
        </aside>
      </div>
    </section>
  );
}

function previewFolderName(path: string) { return path.slice(path.lastIndexOf('/') + 1); }
