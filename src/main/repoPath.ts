import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * True when any segment of a path is a `.git` folder, in any case, split on
 * either slash.
 *
 * Nothing in Neuron reads or writes a repository's internals, and writing
 * `.git/hooks/pre-commit` or `.git/config` is code execution the next time
 * someone runs git there. Windows also opens `.git.`, `.git ` and
 * `.git::$INDEX_ALLOCATION` as `.git`, so a segment is compared with trailing
 * dots and spaces and any stream suffix removed.
 */
export function hasGitSegment(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((segment) => segment.split(':')[0].replace(/[. ]+$/, '').toLowerCase() === '.git');
}

/**
 * `..` is refused everywhere. On Windows, aliases and streams must not bypass
 * path checks, so trailing dots/spaces, `:` and device names are refused too;
 * on macOS and Linux those are legal file names (`Meeting 10:30.md`, `aux.md`).
 */
export function hasUnsafeSegment(relativePath: string, windows: boolean = process.platform === 'win32'): boolean {
  return relativePath.split(/[\\/]/).some((segment) => segment === '..'
    || (windows && ((segment !== '.' && /[. ]$/.test(segment)) || segment.includes(':')
      || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment))));
}

export function resolveInside(root: string, relativePath: string, pathApi: path.PlatformPath = path): string | null {
  if (typeof relativePath !== 'string' || relativePath.includes('\0') || /^[\\/]/.test(relativePath)
    || pathApi.isAbsolute(relativePath) || hasGitSegment(relativePath) || hasUnsafeSegment(relativePath, pathApi.sep === '\\')) return null;
  const full = pathApi.resolve(root, relativePath);
  const rel = pathApi.relative(pathApi.resolve(root), full);
  if (rel === '' || rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) return null;
  if (hasGitSegment(rel)) return null;
  return full;
}

export function realpathInside(root: string, full: string): boolean {
  try {
    let ancestor = full;
    // Only missing entries permit walking upward; unreadable or broken links deny access.
    while (true) {
      try {
        fs.lstatSync(ancestor);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) return false;
        ancestor = parent;
      }
    }
    const rel = path.relative(fs.realpathSync.native(root), fs.realpathSync.native(ancestor));
    // Checked again on the real path: a link, a junction or an 8.3 short name
    // (GIT~1) can reach `.git` without spelling it.
    return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) && !hasGitSegment(rel);
  } catch {
    return false;
  }
}
