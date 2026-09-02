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
  const className = 'h-4 w-4 shrink-0 text-[var(--ink-muted)]';
  switch (extension) {
    case 'db': return <Database className={className} />;
    case 'canvas': return <Frame className={className} />;
    case 'html': return <FileCode2 className={className} />;
    case 'mmd':
    case 'mermaid': return <GitBranch className={className} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp': return <ImageIcon className={className} />;
    default: return <FileText className={className} />;
  }
}

const ROW =
  'interactive group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left '
  + 'hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-[var(--accent)]';

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
      <div className="mx-auto w-full max-w-3xl px-8 pb-16 pt-8">
        <header>
          <nav className="flex flex-wrap items-center gap-1 text-xs text-[var(--ink-secondary)]" aria-label="Breadcrumb">
            <button
              type="button"
              className="interactive rounded px-1.5 py-0.5 font-medium hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
              onClick={() => onNavigate('')}
            >
              {repositoryName}
            </button>
            {trail.map((crumb, index) => (
              <React.Fragment key={crumb.path}>
                <span aria-hidden="true" className="text-[var(--ink-muted)]">/</span>
                <button
                  type="button"
                  className="interactive rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                  aria-current={index === trail.length - 1 ? 'page' : undefined}
                  onClick={() => onNavigate(crumb.path)}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </nav>

          {/* Controls sit beside the heading rather than pushed to the right
              edge. The workspace-map overlay is pinned to the top-right of the
              editor area, and anything placed under it is unclickable -- the
              button renders, stays perfectly still, and silently swallows every
              click into the graph's SVG. */}
          <div className="mt-3 flex items-baseline gap-3">
            <h1 className="min-w-0 truncate text-base font-semibold text-[var(--ink)]">
              {atRoot ? repositoryName : trail[trail.length - 1].name}
            </h1>
            {!atRoot && (
              <button
                type="button"
                className="interactive flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                onClick={() => onNavigate(parentFolder(folder))}
              >
                <ArrowUp className="h-3.5 w-3.5" /> Up
              </button>
            )}
          </div>
        </header>

        {showRecents && (
          <section className="mt-7" aria-labelledby="explorer-recent">
            {/* Left-aligned for the same reason as the Up button above: the
                right edge of the editor area is under the graph overlay. */}
            <div className="flex items-center gap-3">
              <h2 id="explorer-recent" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                <Clock className="h-3.5 w-3.5" /> Recent
              </h2>
              <button
                type="button"
                className="interactive flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                onClick={onClearRecents}
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
            <ul className="mt-2 grid gap-0.5 sm:grid-cols-2">
              {recents.map((entry) => {
                const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
                const where = parentFolder(entry.path);
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className={ROW}
                      data-recent={entry.path}
                      onClick={() => (entry.kind === 'folder' ? onNavigate(entry.path) : onOpenFile(entry.path))}
                    >
                      {entry.kind === 'folder'
                        ? <Folder className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                        : <FileIcon extension={name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''} />}
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{name}</span>
                      {where && <span className="shrink-0 truncate text-xs text-[var(--ink-muted)]">{where}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="mt-7" aria-labelledby="explorer-contents">
          <h2 id="explorer-contents" className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            {atRoot ? 'Workspace' : 'Contents'}
          </h2>

          {folders.length === 0 && files.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-secondary)]">
              {paths.length === 0
                ? 'This workspace has no notes yet. Create one from the sidebar to begin.'
                : 'This folder is empty.'}
            </p>
          ) : (
            <ul className="mt-2 grid gap-0.5">
              {folders.map((entry) => (
                <li key={entry.path}>
                  <button type="button" className={ROW} data-folder={entry.path} onClick={() => openFolder(entry)}>
                    <Folder className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{entry.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--ink-muted)]">
                      {entry.count} {entry.count === 1 ? 'file' : 'files'}
                    </span>
                  </button>
                </li>
              ))}
              {files.map((entry) => (
                <li key={entry.path}>
                  <button type="button" className={ROW} data-file={entry.path} onClick={() => openFile(entry)}>
                    <FileIcon extension={entry.extension} />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{entry.name}</span>
                    {entry.extension && (
                      <span className="shrink-0 text-xs uppercase text-[var(--ink-muted)]">{entry.extension}</span>
                    )}
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
