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

export function resolveInside(root: string, relativePath: string, pathApi: path.PlatformPath = path): string | null {
  if (typeof relativePath !== 'string' || relativePath.includes('\0') || pathApi.isAbsolute(relativePath) || hasGitSegment(relativePath)) return null;
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
