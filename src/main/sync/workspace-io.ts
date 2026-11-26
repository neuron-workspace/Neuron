// The main-process side of the engine's WorkspaceIO (D41: main is the only
// workspace writer). Every write and delete runs inside the same per-file save
// queue as notes:write, through the journal's required-capture paths (D42):
// a failed capture leaves the file alone and writes a conflict copy beside it;
// a delete goes to the OS trash after capture, never unlink. No electron import:
// main passes in the queue, the journal and shell.trashItem.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { realpathInside, resolveInside } from '../repoPath';
import { mkdirSafeSync, openSafe } from '../safe-fs';
import { saveKey } from '../save-file';
import { ENTRY_LIMIT, walkWorkspace } from '../workspace-walk';
import type { WriteJournal } from '../journal';
import { SyncError, type WorkspaceFile, type WorkspaceIO } from './types';

export interface WorkspaceIODeps {
  root: string;
  journal: Pick<WriteJournal, 'writeUnattended' | 'deleteUnattended'>;
  queue: <T>(key: string, task: () => Promise<T>) => Promise<T>;
  trash: (fullPath: string) => Promise<void>;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

export function createWorkspaceIO({ root, journal, queue, trash }: WorkspaceIODeps): WorkspaceIO {
  const full = (relative: string): string => {
    const resolved = resolveInside(root, relative);
    if (!resolved || !realpathInside(root, resolved)) throw new SyncError('name', 'Path escapes the workspace');
    return resolved;
  };
  return {
    async list(): Promise<WorkspaceFile[]> {
      // One past the limit, so the engine sees "too many" instead of a silent cut.
      const walk = walkWorkspace(root, { limit: ENTRY_LIMIT + 1 });
      return walk.files.map((file) => {
        let symlink = false;
        try { symlink = fs.lstatSync(path.join(root, file)).isSymbolicLink(); } catch { /* listed by the walk; read decides */ }
        const info = walk.info[file];
        return { path: toPosix(file), size: info?.size ?? 0, mtimeMs: info?.modified ?? 0, ...(symlink ? { symlink } : {}) };
      });
    },
    async read(relative: string, maxBytes: number): Promise<Uint8Array | null> {
      let handle: fs.promises.FileHandle;
      try { handle = await openSafe(root, full(relative)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      try {
        const { size } = await handle.stat();
        if (size > maxBytes) throw new SyncError('size', 'Workspace file exceeds its size limit');
        const bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        // A file that changed while it was read is re-read on the next pass.
        if (offset !== size || (await handle.stat()).size !== size) throw new SyncError('wait', 'Workspace file changed while it was read');
        return bytes;
      } finally { await handle.close(); }
    },
    async write(relative: string, bytes: Uint8Array, deviceLabel: string) {
      const target = full(relative);
      return queue(saveKey(target), async () => {
        mkdirSafeSync(root, path.dirname(target));
        const result = await journal.writeUnattended(root, target, Buffer.from(bytes), deviceLabel);
        return { path: toPosix(path.relative(root, result.path)), conflict: result.conflict };
      });
    },
    async remove(relative: string) {
      const target = full(relative);
      return queue(saveKey(target), async () => ({ success: (await journal.deleteUnattended(root, target, trash)).success }));
    },
  };
}
