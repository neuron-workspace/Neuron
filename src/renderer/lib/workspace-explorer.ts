// The workspace explorer's data, derived rather than fetched.
//
// Everything here is a projection of the flat lists of paths the renderer
// already holds (notes, and main's listing of every other file and folder).
// There is no filesystem access here: main owns the filesystem and sends the
// lists, so the explorer inherits main's exclusions and cannot show a file
// main did not send.

/** A child folder of the folder being viewed. */
export interface FolderEntry {
  /** Repo-relative path, no trailing slash. */
  path: string;
  name: string;
  /** Files anywhere beneath it, so an empty folder can say that it is empty. */
  count: number;
}

export interface FileEntry {
  path: string;
  name: string;
  /** Lowercase, no dot. Empty for a file with no extension. */
  extension: string;
}

export interface FolderListing {
  folders: FolderEntry[];
  files: FileEntry[];
}

/** Where a recent entry points. Folders navigate; files open. */
export type RecentKind = 'file' | 'folder';

export interface RecentEntry {
  path: string;
  kind: RecentKind;
  /** Epoch millis, so ordering survives serialisation. */
  at: number;
}

export const RECENTS_LIMIT = 12;

const segments = (path: string): string[] => path.split('/').filter(Boolean);

/** The folder containing `path`, or '' for something at the workspace root. */
export function parentFolder(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * One level of the tree.
 *
 * `folder` is '' for the workspace root. Sorting is folders first, then files,
 * each alphabetically and case-insensitively — a listing that reorders itself
 * between renders is unusable, so the comparison never depends on locale
 * collation of mixed case.
 */
export function listFolder(paths: readonly string[], folder: string, knownFolders: readonly string[] = []): FolderListing {
  const prefix = folder === '' ? '' : `${folder}/`;
  const folders = new Map<string, number>();
  const files: FileEntry[] = [];
  for (const path of knownFolders) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length).split('/')[0];
    if (name) folders.set(prefix + name, 0);
  }

  for (const path of paths) {
    if (prefix && !path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest) continue;

    const cut = rest.indexOf('/');
    if (cut === -1) {
      const dot = rest.lastIndexOf('.');
      files.push({
        path,
        name: rest,
        extension: dot > 0 ? rest.slice(dot + 1).toLowerCase() : '',
      });
    } else {
      // A directory is implied by the files beneath it: there is no separate
      // folder record to read, because main sends files only.
      const name = rest.slice(0, cut);
      const child = prefix + name;
      folders.set(child, (folders.get(child) ?? 0) + 1);
    }
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name);

  return {
    folders: [...folders.entries()]
      .map(([path, count]) => ({ path, name: path.slice(prefix.length), count }))
      .sort(byName),
    files: files.sort(byName),
  };
}

/** A byte count as a person reads it: "5 bytes", "1.2 KB", "34 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' bytes';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ' + units[unit];
}

export interface FolderCounts { notes: number; folders: number; other: number }

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What a folder holds, as a person would say it: "2 notes, 1 folder", with
 * zero parts left out and "Empty" for nothing. `short` gives only the total,
 * for a grid tile with room for a few words.
 */
export function describeCounts(counts: FolderCounts, short = false): string {
  const total = counts.notes + counts.folders + counts.other;
  if (total === 0) return 'Empty';
  if (short) return plural(total, 'item', 'items');
  return [
    counts.notes && plural(counts.notes, 'note', 'notes'),
    counts.folders && plural(counts.folders, 'folder', 'folders'),
    counts.other && plural(counts.other, 'other file', 'other files'),
  ].filter(Boolean).join(', ');
}

/** The trail from the workspace root to `folder`, root first. */
export function breadcrumbs(folder: string): Array<{ path: string; name: string }> {
  const parts = segments(folder);
  return parts.map((name, index) => ({ path: parts.slice(0, index + 1).join('/'), name }));
}

/**
 * Record a visit.
 *
 * Most recent first, one entry per path, capped. Re-visiting something moves it
 * to the front rather than adding a duplicate, which is the whole reason this
 * is not just an array push.
 */
export function addRecent(
  recents: readonly RecentEntry[],
  entry: { path: string; kind: RecentKind },
  now = Date.now(),
  limit = RECENTS_LIMIT,
): RecentEntry[] {
  const without = recents.filter((r) => r.path !== entry.path);
  return [{ path: entry.path, kind: entry.kind, at: now }, ...without].slice(0, limit);
}

/**
 * Drop entries that no longer exist.
 *
 * Files must still be in the workspace listing. A folder survives while
 * anything still lives beneath it, because folders are implied by their
 * contents and emptying one is indistinguishable from deleting it.
 *
 * Called on every workspace change, so a note deleted or moved outside the app
 * leaves the Recent list quietly rather than offering a path that opens
 * nothing.
 */
export function pruneRecents(recents: readonly RecentEntry[], paths: readonly string[]): RecentEntry[] {
  const files = new Set(paths);
  return recents.filter((entry) => (
    entry.kind === 'file'
      ? files.has(entry.path)
      : paths.some((p) => p.startsWith(`${entry.path}/`))
  ));
}

/** Read a stored value back into shape, ignoring anything malformed. */
export function resolveRecents(stored: unknown, limit = RECENTS_LIMIT): RecentEntry[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const entries: RecentEntry[] = [];
  for (const item of stored) {
    if (!item || typeof item !== 'object') continue;
    const { path, kind, at } = item as Partial<RecentEntry>;
    if (typeof path !== 'string' || !path) continue;
    if (kind !== 'file' && kind !== 'folder') continue;
    if (seen.has(path)) continue;
    seen.add(path);
    entries.push({ path, kind, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 });
  }
  return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * The settings key for one workspace's recents.
 *
 * Recents are per workspace and per machine: they describe how someone has been
 * moving around on this computer, which is why they live in the settings bridge
 * beside `layout` rather than in a file inside the workspace that would sync to
 * every other machine.
 */
export const recentsKey = (repository: string): string => `explorer.recents:${repository}`;
