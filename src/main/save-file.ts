import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { openSafe, renameSafe, unlinkSafeSync, checkSafePath } from './safe-fs';

// How notes:write puts text (and, for sync, bytes) on disk: through a temporary
// file fsynced and renamed over the target, one save of a file at a time, never
// holding the main process.

export interface SaveFs {
  open(file: string, exclusive: boolean): Promise<Pick<fs.promises.FileHandle, 'writeFile' | 'truncate' | 'sync' | 'close'>>;
  rename(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
  syncDirectory(directory: string): Promise<void>;
}

export interface SaveOptions {
  root?: string;
  noInPlaceFallback?: boolean;
  /**
   * Runs immediately before the file is replaced: before each rename attempt
   * and before the in-place fallback. Throwing stops the save; the temp file
   * is removed and the file is left as it was.
   */
  beforeReplace?: () => Promise<void>;
  /** Injected filesystem for unit tests. */
  io?: SaveFs;
}

/** SHA-256 of the text as UTF-8, hex. The renderer's contentHash (lib/external-change.ts) is the same. */
export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** The code of the error a save's beforeReplace throws for an outside change. */
export const SAVE_CONFLICT = 'ESAVECONFLICT';
export function saveConflict(): Error {
  return Object.assign(new Error('The file changed outside Neuron.'), { code: SAVE_CONFLICT });
}

/**
 * Whether the file changed outside Neuron while an edit was being saved.
 * `base` is the hash of the version the edit was based on, `ownLast` the hash
 * of this window's last save of the file: our own back-to-back saves are based
 * on the same version, and each finds the one before it on disk. Anything else
 * on disk is someone else's and is not written over. A file that is not there
 * (`disk` null) is written anew, as before.
 */
export function isOutsideChange(disk: string | null, base: string, ownLast: string | undefined): boolean {
  if (disk === null) return false;
  const hash = textHash(disk);
  return hash !== base && hash !== ownLast;
}

function nodeSaveFs(root: string): SaveFs {
  return {
    open: async (file, exclusive) => {
      try { return await openSafe(root, file, exclusive ? 'create' : 'write'); }
      catch (error) {
        if (exclusive || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return openSafe(root, file, 'create');
      }
    },
    rename: (from, to) => renameSafe(root, from, to),
    unlink: async (file) => unlinkSafeSync(root, file),
    syncDirectory: async (directory) => {
      if (process.platform === 'win32') return;
      checkSafePath(root, directory);
      let handle: fs.promises.FileHandle | undefined;
      try {
        handle = await fs.promises.open(directory, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        await handle.sync();
      } catch (error) {
        if (!['EINVAL', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      } finally { await handle?.close(); }
    },
  };
}

/** Rename errors that mean "held open for a moment", not "cannot". */
export const RENAME_RETRY_CODES: readonly string[] = ['EPERM', 'EBUSY', 'EACCES'];
/** Renames tried before writing in place: waits of 15, 30, 45, 60 and 75 ms between them. */
export const RENAME_ATTEMPTS = 6;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Write `content` to `fullPath` through `tmp`.
 *
 * Atomic: a crash mid-write never leaves a half-written note or database. On
 * Windows a rename over a file another process holds open (the file watcher,
 * an indexer, antivirus) fails with EPERM/EBUSY/EACCES for a few milliseconds,
 * so it is retried with an awaited timer -- the old Atomics.wait froze the
 * whole main process, which is also the browser's UI thread, for up to 225 ms.
 * Still held after that, the file is written in place rather than the edit
 * lost -- unless noInPlaceFallback is set (sync): then the save fails, the temp
 * file is removed and the old file is left as it was.
 *
 * Durable: the temp file is fsynced before the rename and, on POSIX, its folder
 * after it (best effort: EINVAL/EPERM, where a folder cannot be synced, are
 * ignored). Cleanup never follows a swapped path.
 *
 * Checked: `beforeReplace` (notes:write's outside-change check) runs after the
 * temp file is written and synced, just before each rename attempt. What it
 * cannot see is a change landing in the instant between it and the rename
 * itself, which takes names, not handles (the same residual window as
 * safe-fs.ts).
 */
export async function writeAtomically(fullPath: string, content: string | Buffer, tmp: string, options: SaveOptions | SaveFs = {}, delay: (ms: number) => Promise<void> = wait): Promise<void> {
  const config = 'open' in options ? { io: options } : options;
  const root = config.root ?? path.dirname(path.resolve(fullPath));
  const io = config.io ?? nodeSaveFs(root);
  // The temp file is created (by handle, O_EXCL) in the checked folder, and the
  // rename re-checks both ends: see safe-fs.ts.
  if (!config.io && path.dirname(path.resolve(tmp)) !== path.dirname(path.resolve(fullPath))) throw new Error('Temporary file must be beside its destination.');
  const write = async (file: string, exclusive: boolean) => {
    const handle = await io.open(file, exclusive);
    try {
      if (!exclusive) await handle.truncate(0);
      await handle.writeFile(content);
      await handle.sync();
    } finally { await handle.close(); }
  };
  let created = false;
  try {
    // Exclusive creation prevents a pre-existing temp link or file being clobbered.
    // An open failure does not confer ownership of the name for cleanup.
    const handle = await io.open(tmp, true);
    created = true;
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 1; ; attempt++) {
      // Checked again on every attempt: the file may change while a rename is held.
      await config.beforeReplace?.();
      try {
        await io.rename(tmp, fullPath);
      } catch (error) {
        if (!RENAME_RETRY_CODES.includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        if (attempt >= RENAME_ATTEMPTS) {
          if (config.noInPlaceFallback) throw error;
          await config.beforeReplace?.();
          await write(fullPath, false);
          return;
        }
        await delay(15 * attempt);
        continue;
      }
      await io.syncDirectory(path.dirname(fullPath));
      return;
    }
  } finally {
    if (created) await io.unlink(tmp).catch(() => undefined); // never follow a swapped path during cleanup
  }
}

/**
 * One save of a file at a time, in the order they were asked for.
 *
 * With the retry awaited, two quick saves of one file could otherwise overlap:
 * the first waiting out a held rename while the second lands, then the first
 * renaming its older text over the newer. Each key's saves form a chain; a
 * failed save does not stop the next one.
 */
export function createSaveQueue() {
  const tails = new Map<string, Promise<void>>();
  return function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => task());
    const tail = result.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return result;
  };
}

/** The queue key for a path: one file however its name is cased, where the file system ignores case. */
export function saveKey(fullPath: string, platform: string = process.platform): string {
  return platform === 'win32' || platform === 'darwin' ? fullPath.toLowerCase() : fullPath;
}
