import * as React from 'react';
import {
  ArrowUp, Clock, Database, FileCode2, FileText, Folder, Frame,
  GitBranch, Image as ImageIcon, Trash2,
} from 'lucide-react';
import {
  breadcrumbs, listFolder, parentFolder,
  type FileEntry, type FolderEntry, type RecentEntry,
} from '../lib/workspace-explorer';

interface WorkspaceExplorerProps {
  repositoryName: string;
  /** Every note path in the workspace, as the renderer already holds them. */
  paths: string[];
  /** '' is the workspace root. */
  folder: string;
  onNavigate: (folder: string) => void;
  onOpenFile: (path: string) => void;
  recents: RecentEntry[];
  onClearRecents: () => void;
}

/**
 * An icon that says what kind of thing this is before the name is read.
 *
 * Keyed off the same extensions the surface registry uses, so a `.canvas` looks
 * like a canvas here and opens as one when clicked -- an explorer that labelled
 * files differently from how they open would be worse than no icons.
 */
function FileIcon({ extension }: { extension: string }) {
  const className = 'h-9 w-9 text-[var(--ink-muted)]';
  const stroke = 1.25;
  switch (extension) {
    case 'db': return <Database className={className} strokeWidth={stroke} />;
    case 'canvas': return <Frame className={className} strokeWidth={stroke} />;
    case 'html': return <FileCode2 className={className} strokeWidth={stroke} />;
    case 'mmd':
    case 'mermaid': return <GitBranch className={className} strokeWidth={stroke} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp': return <ImageIcon className={className} strokeWidth={stroke} />;
    default: return <FileText className={className} strokeWidth={stroke} />;
  }
}

/**
 * A folder, drawn as one.
 *
 * Solid rather than outlined, and at the same size as the file glyphs it sits
 * beside: the fill is what separates a container from a document at a glance,
 * so the eye sorts the grid into folders and files before reading a single
 * name. Accent is not spent here -- it means selection and focus.
 */
function FolderIcon() {
  return <Folder className="h-9 w-9 text-[var(--ink-secondary)]" fill="currentColor" strokeWidth={1.25} />;
}

/**
 * One item in the grid: a big glyph with its name beneath.
 *
 * `h-full` so every tile in a row is the height of the tallest, which keeps the
 * icons on a line and the names top-aligned under them however many lines a
 * name takes. Two lines is the ceiling; the full name is always in the tooltip.
 */
const TILE =
  'interactive flex h-full w-full flex-col items-center gap-2 rounded-lg px-2 py-3 '
  + 'text-center hover:bg-[var(--surface-hover)] focus-visible:outline '
  + 'focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

const TILE_NAME = 'line-clamp-2 w-full break-words text-xs leading-4 text-[var(--ink)]';

/** Auto-fitting columns, so the grid reflows with the pane instead of at breakpoints. */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1';

export default function WorkspaceExplorer({
  repositoryName, paths, folder, onNavigate, onOpenFile, recents, onClearRecents,
}: WorkspaceExplorerProps) {
  const { folders, files } = React.useMemo(() => listFolder(paths, folder), [paths, folder]);
  const trail = React.useMemo(() => breadcrumbs(folder), [folder]);
  const atRoot = folder === '';

  // Recents belong to the workspace, not to the folder being browsed, so they
  // are shown at the root only -- inside a folder they would compete with the
  // thing the user navigated there to find.
  const showRecents = atRoot && recents.length > 0;

  const openFolder = (entry: FolderEntry) => onNavigate(entry.path);
  const openFile = (entry: FileEntry) => onOpenFile(entry.path);

  return (
    <section className="h-full overflow-y-auto" data-workspace-explorer data-explorer-paths={paths.length}>
      {/* Not wider than this. The workspace-map overlay parks at the top-right
          of the editor area, and a column wide enough for a sixth tile puts
          that tile underneath it -- where it renders, sits perfectly still, and
          drops every click into the graph's SVG. Same reason the Up and Clear
          buttons are left-aligned below. */}
      <div className="mx-auto w-full max-w-2xl px-8 pb-16 pt-8">
        {/* At the root the breadcrumb, the heading and the section label were
            all the workspace's name, stacked: the same word three times before
            a single file. The trail only earns its place once there is
            somewhere to go back to. */}
        <header>
          {!atRoot && (
            <nav className="flex flex-wrap items-center gap-0.5 text-xs text-[var(--ink-secondary)]" aria-label="Breadcrumb">
              <button
                type="button"
                className="interactive rounded px-1.5 py-0.5 font-medium hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                onClick={() => onNavigate('')}
              >
                {repositoryName}
              </button>
              {trail.slice(0, -1).map((crumb) => (
                <React.Fragment key={crumb.path}>
                  <span aria-hidden="true" className="text-[var(--ink-muted)]">/</span>
                  <button
                    type="button"
                    className="interactive rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                    onClick={() => onNavigate(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}

          {/* Controls sit beside the heading rather than pushed to the right
              edge. The workspace-map overlay is pinned to the top-right of the
              editor area, and anything placed under it is unclickable -- the
              button renders, stays perfectly still, and silently swallows every
              click into the graph's SVG. */}
          <div className={`flex items-center gap-2 ${atRoot ? '' : 'mt-2'}`}>
            {!atRoot && (
              <button
                type="button"
                title="Go to the parent folder"
                className="interactive -ml-1 flex min-h-[var(--control-sm)] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                onClick={() => onNavigate(parentFolder(folder))}
              >
                <ArrowUp className="h-3.5 w-3.5" /> Up
              </button>
            )}
            <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-[var(--ink)]">
              {atRoot ? repositoryName : trail[trail.length - 1].name}
            </h1>
            <span className="shrink-0 text-xs tabular-nums text-[var(--ink-muted)]">
              {folders.length + files.length} {folders.length + files.length === 1 ? 'item' : 'items'}
            </span>
          </div>
        </header>

        {showRecents && (
          <section className="mt-6" aria-labelledby="explorer-recent">
            {/* Left-aligned for the same reason as the Up button above: the
                right edge of the editor area is under the graph overlay. */}
            <div className="flex items-center gap-2">
              <h2 id="explorer-recent" className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-secondary)]">
                <Clock className="h-3.5 w-3.5 text-[var(--ink-muted)]" /> Recent
              </h2>
              <button
                type="button"
                className="interactive flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                onClick={onClearRecents}
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
            <ul className={`mt-2 ${GRID}`}>
              {recents.map((entry) => {
                const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
                const where = parentFolder(entry.path);
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className={TILE}
                      data-recent={entry.path}
                      // The folder it came from moves into the tooltip. Two
                      // notes called "index" in different sections are still
                      // told apart, without a path competing with the name for
                      // room inside a 7rem tile.
                      title={where ? `${name} — in ${where}` : name}
                      onClick={() => (entry.kind === 'folder' ? onNavigate(entry.path) : onOpenFile(entry.path))}
                    >
                      {entry.kind === 'folder'
                        ? <FolderIcon />
                        : <FileIcon extension={name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''} />}
                      <span className={TILE_NAME}>{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* No section heading here. The h1 above already names the folder and
            counts what is in it; a second label under it said the same thing
            in small caps.

            Folders first, then files, both as icon tiles. A single-column list
            spent the width of the pane on one name per row and made a workspace
            of a dozen things look like a long document; a grid shows a folder
            the way a file manager does, and the whole workspace fits at once. */}
        <section className="mt-4" aria-label={atRoot ? 'Workspace contents' : `Contents of ${trail[trail.length - 1].name}`}>
          {folders.length === 0 && files.length === 0 ? (
            <p className="text-sm text-[var(--ink-secondary)]">
              {paths.length === 0
                ? 'This workspace has no notes yet. Create one from the sidebar to begin.'
                : 'This folder is empty.'}
            </p>
          ) : (
            <ul className={GRID}>
              {folders.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={TILE}
                    data-folder={entry.path}
                    title={`${entry.name} — ${entry.count} ${entry.count === 1 ? 'file' : 'files'}`}
                    onClick={() => openFolder(entry)}
                  >
                    <FolderIcon />
                    <span className={TILE_NAME}>{entry.name}</span>
                  </button>
                </li>
              ))}
              {/* Files carry no extension badge. It was spelled out on the right
                  of every row -- MD, MDX, CANVAS -- restating the icon on the
                  left and the suffix already in the name. */}
              {files.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={TILE}
                    data-file={entry.path}
                    title={entry.name}
                    onClick={() => openFile(entry)}
                  >
                    <FileIcon extension={entry.extension} />
                    <span className={TILE_NAME}>{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
