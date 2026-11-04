import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';

export type WatchEvent = 'add' | 'change' | 'unlink';

const ignored = /(^|[\/\\])\.(?!neuron([\/\\]|$))/;

export function watchWorkspace(
  dir: string,
  onEvent: (event: WatchEvent, relativePath: string) => void,
  options: { debounceMs?: number; useNative?: boolean } = {},
): { close(): void } {
  const debounceMs = options.debounceMs ?? 120;
  const useNative = options.useNative ?? (process.platform === 'win32' || process.platform === 'darwin');
  const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; renamed: boolean }>();
  let closed = false;
  let watcher: { close(): void } | undefined;
  // TEMP CI debug: remove before merge.
  const debug = ((globalThis as any).__neuronWatchLog ??= []) as string[];
  const note = (line: string) => { debug.push(`${Date.now() % 100000} ${line}`); if (debug.length > 80) debug.shift(); };
  note(`start ${dir} native=${useNative}`);
  const emit = (event: WatchEvent, relativePath: string) => {
    note(`emit ${event} ${relativePath} closed=${closed}`);
    if (!closed) onEvent(event, relativePath);
  };
  const close = () => {
    note(`close ${dir}`);
    if (closed) return;
    closed = true;
    for (const pending of timers.values()) clearTimeout(pending.timer);
    timers.clear();
    watcher?.close();
  };
  const onError = (error: Error) => {
    note(`error ${error?.message}`);
    if (closed) return;
    console.warn('Workspace watcher stopped:', error);
    close();
  };

  const walk = async (relativePath: string): Promise<void> => {
    if (closed) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(dir, relativePath), { withFileTypes: true });
    } catch {
      return; // The directory may have disappeared during the walk.
    }
    for (const entry of entries) {
      if (closed) return;
      const child = relativePath + '/' + entry.name;
      if (ignored.test(child)) continue;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) emit('add', child);
    }
  };

  const inspect = async (relativePath: string, event: string, renamed: boolean) => {
    if (closed) return;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(path.join(dir, relativePath));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      note(`stat ${relativePath} ${code}`);
      if (code === 'ENOENT' || code === 'ENOTDIR') emit('unlink', relativePath);
      return;
    }
    if (closed) return;
    if (stat.isFile()) emit(event === 'rename' ? 'add' : 'change', relativePath);
    else if (stat.isDirectory() && renamed) await walk(relativePath);
  };

  if (useNative) {
    try {
      watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
        note(`raw ${event} ${filename} closed=${closed}`);
        if (closed || filename == null) return;
        const relativePath = filename.toString().replace(/\\/g, '/');
        if (ignored.test(relativePath)) return;
        const pending = timers.get(relativePath);
        clearTimeout(pending?.timer);
        const renamed = event === 'rename' || (pending?.renamed ?? false);
        timers.set(relativePath, {
          renamed,
          timer: setTimeout(() => {
            timers.delete(relativePath);
            void inspect(relativePath, event, renamed);
          }, debounceMs),
        });
      }).on('error', onError);
      return { close };
    } catch (error) {
      note(`native failed ${(error as Error).message}`);
      // Recursive watching is unavailable; use chokidar.
    }
  }

  const fallback = chokidar.watch(dir, { ignored, persistent: true, ignoreInitial: true });
  watcher = fallback;
  fallback.on('all', (event, filePath) => {
    if (event === 'add' || event === 'change' || event === 'unlink' || event === 'unlinkDir') {
      emit(event === 'unlinkDir' ? 'unlink' : event, path.relative(dir, filePath).replace(/\\/g, '/'));
    }
  });
  fallback.on('error', onError);
  return { close };
}
