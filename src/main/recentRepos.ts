import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * One identity per folder. The same workspace reached through a different
 * case, separator, trailing slash or junction is still one entry -- each used to
 * show up as its own row in the workspace switcher.
 */
export function folderKey(dir: string, platform: NodeJS.Platform = process.platform, realpath: (p: string) => string = fs.realpathSync.native): string {
  let resolved = dir;
  try { resolved = realpath(dir); } catch { /* missing folders keep their spelling */ }
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalised = pathApi.normalize(resolved).replace(/[\\/]+$/, '') || resolved;
  // Windows and macOS file systems are case-insensitive by default.
  return platform === 'win32' || platform === 'darwin' ? normalised.toLowerCase() : normalised;
}

/** Recent workspaces without duplicates, keeping the first spelling seen, and without `current`. */
export function uniqueRecents(recent: string[], current: string | null, key: (dir: string) => string = folderKey): string[] {
  const seen = new Set<string>();
  if (current) seen.add(key(current));
  return recent.filter((dir) => {
    const k = key(dir);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The recent list to keep at startup.
 *
 * A folder that is not there is kept: it may be on a USB or network drive that
 * is not connected yet, and dropping it here used to forget it for good. Only
 * folders inside Neuron's installation go (updates replace them), and two
 * spellings of one folder become one entry.
 */
export function startupRecents(recent: unknown, isInstall: (dir: string) => boolean, key: (dir: string) => string = folderKey): string[] {
  const dirs = Array.isArray(recent) ? recent.filter((dir): dir is string => typeof dir === 'string' && dir.length > 0) : [];
  return uniqueRecents(dirs.filter((dir) => !isInstall(dir)), null, key);
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Custom workspace names keyed by folder identity rather than by spelling.
 *
 * Run once at startup over names saved under whatever spelling the folder had
 * when it was renamed. When two spellings of one folder both have a name, the
 * one saved later wins: names were only ever added at the end, so that is the
 * later key in the stored object.
 */
export function keyNames(names: unknown, key: (dir: string) => string = folderKey): Record<string, string> {
  const keyed: Record<string, string> = {};
  if (!names || typeof names !== 'object' || Array.isArray(names)) return keyed;
  for (const [dir, name] of Object.entries(names as Record<string, unknown>)) {
    if (typeof name !== 'string' || !name.trim() || UNSAFE_KEYS.has(dir)) continue;
    const k = key(dir);
    if (UNSAFE_KEYS.has(k)) continue;
    delete keyed[k]; // re-inserted, so the later one also takes the later place
    keyed[k] = name;
  }
  return keyed;
}

/** The custom name for a folder, however it is spelled, or undefined. */
export function nameOf(names: Record<string, string> | undefined, dir: string, key: (dir: string) => string = folderKey): string | undefined {
  if (!names) return undefined;
  const k = key(dir);
  return Object.hasOwn(names, k) && typeof names[k] === 'string' ? names[k] : undefined;
}

/** Names after renaming one folder: every spelling of it is replaced; an empty name clears it. */
export function withName(names: Record<string, string> | undefined, dir: string, name: string, key: (dir: string) => string = folderKey): Record<string, string> {
  const k = key(dir);
  const next: Record<string, string> = {};
  for (const [stored, value] of Object.entries(names ?? {})) {
    if (!UNSAFE_KEYS.has(stored) && key(stored) !== k) next[stored] = value;
  }
  const trimmed = name.trim();
  if (trimmed && !UNSAFE_KEYS.has(k)) next[k] = trimmed;
  return next;
}

export interface ListedWorkspace {
  dir: string;
  /** The workspace of the window that opened Settings, while a window still shows it. */
  isOpener: boolean;
}

/**
 * The workspaces one window lists, once each.
 *
 * A workspace window leaves out the folder it shows (`current`): its switcher
 * already names it. The Settings window lists every folder and marks the one
 * whose window opened it (`opener`), adding it first if it is not in Recent.
 */
export function listedWorkspaces(recent: string[], current: string | null, opener: string | null, key: (dir: string) => string = folderKey): ListedWorkspace[] {
  const dirs = uniqueRecents(recent, current, key);
  const openerKey = opener ? key(opener) : null;
  const listed = dirs.map((dir) => ({ dir, isOpener: openerKey !== null && key(dir) === openerKey }));
  if (opener && openerKey !== (current ? key(current) : null) && !listed.some((entry) => entry.isOpener)) {
    listed.unshift({ dir: opener, isOpener: true });
  }
  return listed;
}
