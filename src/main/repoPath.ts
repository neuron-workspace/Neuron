import * as path from 'node:path';
import * as fs from 'node:fs';

export function resolveInside(root: string, relativePath: string, pathApi: path.PlatformPath = path): string | null {
  if (typeof relativePath !== 'string' || relativePath.includes('\0') || pathApi.isAbsolute(relativePath)) return null;
  const full = pathApi.resolve(root, relativePath);
  const rel = pathApi.relative(pathApi.resolve(root), full);
  if (rel === '' || rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) return null;
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
    return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}
