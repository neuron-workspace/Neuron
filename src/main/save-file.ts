import * as fs from 'fs';

// How notes:write puts text on disk: through a temporary file renamed over the
// target, one save of a file at a time, never holding the main process.

export interface SaveFs {
  writeFile(file: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
}

const nodeSaveFs: SaveFs = {
  writeFile: (file, content) => fs.promises.writeFile(file, content, 'utf-8'),
  rename: (from, to) => fs.promises.rename(from, to),
  unlink: (file) => fs.promises.unlink(file),
};

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
 * lost. The temporary file is removed whatever happens.
 */
export async function writeAtomically(fullPath: string, content: string, tmp: string, io: SaveFs = nodeSaveFs, delay: (ms: number) => Promise<void> = wait): Promise<void> {
  try {
    await io.writeFile(tmp, content);
    for (let attempt = 1; ; attempt++) {
      try {
        await io.rename(tmp, fullPath);
        return;
      } catch (error) {
        if (!RENAME_RETRY_CODES.includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        if (attempt >= RENAME_ATTEMPTS) {
          await io.writeFile(fullPath, content);
          return;
        }
        await delay(15 * attempt);
      }
    }
  } finally {
    await io.unlink(tmp).catch(() => undefined); // renamed, or never written
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
