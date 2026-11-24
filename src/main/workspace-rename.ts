// The rules for renaming or moving a workspace file or folder that do not need
// the file system, kept apart from the IPC handler so they can be tested alone.

/** Neuron's own folder: its files are moved along with what they describe, never by hand. */
const CONFIG = '.neuron';
const isConfig = (path: string) => path.toLowerCase() === CONFIG || path.toLowerCase().startsWith(CONFIG + '/');

/** A workspace-relative path as one spelling: `/` separators, no leading or trailing ones. */
export const normalizeRelative = (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

/** Same path when the file system ignores case (Windows, macOS). */
export const samePath = (a: string, b: string, ignoreCase: boolean) => (ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);

/** `to` is `from` itself or inside it. */
export function isInsideOrSame(from: string, to: string, ignoreCase: boolean): boolean {
  const a = ignoreCase ? from.toLowerCase() : from;
  const b = ignoreCase ? to.toLowerCase() : to;
  return a === b || b.startsWith(a + '/');
}

/**
 * Why moving `from` to `to` is refused, before anything is looked at on disk,
 * or null. Both are normalised workspace-relative paths.
 */
export function moveRefusal(from: string, to: string, folder: boolean, ignoreCase: boolean): string | null {
  if (!from || !to) return 'Choose a name.';
  if (isConfig(from) || isConfig(to)) return 'Neuron’s own settings folder (.neuron) can’t be renamed or moved into.';
  if (from === to) return null;
  // A case-only rename is the same path to the file system and is allowed.
  if (folder && !samePath(from, to, ignoreCase) && isInsideOrSame(from, to, ignoreCase)) return 'A folder can’t be moved into itself.';
  const name = to.slice(to.lastIndexOf('/') + 1);
  if (!name.trim() || name.startsWith('.')) return 'Names can’t be empty or start with a dot.';
  if (/[\\:*?"<>|]/.test(name)) return 'Names can’t contain \\ : * ? " < > |.';
  if (name.length > 255) return 'That name is too long.';
  return null;
}

/**
 * Where a managed CSV's settings (`.neuron/tables/<path>.json`) go when `from`
 * moves to `to`: the one file for a CSV, the whole mirrored folder for a
 * folder, since a CSV's settings live at its own path under `.neuron/tables/`.
 * Null when nothing moved can have any.
 */
export function tableMetaMove(from: string, to: string, folder: boolean): { from: string; to: string } | null {
  if (folder) return { from: `${CONFIG}/tables/${from}`, to: `${CONFIG}/tables/${to}` };
  return /\.csv$/i.test(from) ? { from: `${CONFIG}/tables/${from}.json`, to: `${CONFIG}/tables/${to}.json` } : null;
}

/** The settings to remove with a deleted file or folder, by the same mapping. */
export function tableMetaOf(path: string, folder: boolean): string | null {
  return folder ? `${CONFIG}/tables/${path}` : /\.csv$/i.test(path) ? `${CONFIG}/tables/${path}.json` : null;
}
