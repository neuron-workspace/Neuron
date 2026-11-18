import * as fs from 'fs';
import * as path from 'path';

export interface WorkspaceEntries {
  /** Workspace-relative, `/`-separated. */
  files: string[];
  /** Every folder, including empty ones. */
  folders: string[];
  /** Size in bytes and modified time (epoch ms) per file, from the lstat the walk already made. */
  info: Record<string, { size: number; modified: number }>;
  /** Entries that could not be read and were left out. */
  skipped: number;
  /** The walk stopped at the limit. */
  truncated: boolean;
  /** Files with a name the kind table does not know whose first bytes are text. Filled by main, not the walk. */
  text?: string[];
}

export interface WalkFs {
  readdirSync(dir: string): string[];
  lstatSync(target: string): fs.Stats;
  statSync(target: string): fs.Stats;
  realpathSync(target: string): string;
}

const nodeFs: WalkFs = {
  readdirSync: (dir) => fs.readdirSync(dir),
  lstatSync: (target) => fs.lstatSync(target),
  statSync: (target) => fs.statSync(target),
  realpathSync: (target) => fs.realpathSync.native(target),
};

export const ENTRY_LIMIT = 20_000;

/**
 * Every file and folder under `root`.
 *
 * Links are never followed into folders, so a link loop or a junction to the
 * rest of the disk cannot make the walk endless or list what is not in the
 * workspace. A link to a file inside the workspace is listed as a file.
 *
 * One unreadable entry is counted and skipped instead of failing the walk: a
 * single locked folder used to make the whole workspace look empty.
 *
 * Iterative, so a deep tree cannot overflow the stack. The order matches the
 * recursive walk it replaced: a folder's contents come right after it.
 */
export function walkWorkspace(root: string, options: { fs?: WalkFs; limit?: number } = {}): WorkspaceEntries {
  const io = options.fs ?? nodeFs;
  const limit = options.limit ?? Infinity;
  const result: WorkspaceEntries = { files: [], folders: [], info: {}, skipped: 0, truncated: false };
  let realRoot = root;
  try { realRoot = io.realpathSync(root); } catch { /* compare against the root as given */ }
  const relative = (full: string) => path.relative(root, full).replace(/\\/g, '/');
  const insideRoot = (full: string) => {
    const rel = path.relative(realRoot, full);
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
  };
  const read = (dir: string): string[] | null => {
    try { return io.readdirSync(dir); } catch { result.skipped++; return null; }
  };

  const rootItems = read(root);
  if (!rootItems) return result;
  const stack: Array<{ dir: string; items: string[]; index: number }> = [{ dir: root, items: rootItems, index: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.index >= top.items.length) { stack.pop(); continue; }
    const item = top.items[top.index++];
    // Dot-entries are noise -- .git, .obsidian, editor droppings -- except the
    // workspace's own `.neuron` configuration at the root.
    if (item.startsWith('.') && !(top.dir === root && item === '.neuron')) continue;
    const full = path.join(top.dir, item);
    let stat: fs.Stats;
    try {
      stat = io.lstatSync(full);
      if (stat.isSymbolicLink()) {
        const target = io.realpathSync(full);
        if (!insideRoot(target)) continue;
        stat = io.statSync(target);
        if (!stat.isFile()) continue;
      }
    } catch {
      result.skipped++;
      continue;
    }
    if (result.files.length + result.folders.length >= limit) {
      result.truncated = true;
      break;
    }
    const rel = relative(full);
    if (stat.isDirectory()) {
      result.folders.push(rel);
      const items = read(full);
      if (items) stack.push({ dir: full, items, index: 0 });
    } else if (stat.isFile()) {
      result.files.push(rel);
      result.info[rel] = { size: stat.size, modified: stat.mtimeMs };
    }
  }
  return result;
}
