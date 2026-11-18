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
