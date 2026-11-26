import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveInside, realpathInside } from '../repoPath';
import { openSafeSync } from '../safe-fs';
import { checkListPrefix, checkObjectName, ObjectStore, SyncError, validObjectName } from './types';

const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;
const noLinks = new Set(['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS']);

/** The root must already exist. No links, junctions, or write-in-place fallback. */
export class FolderStore implements ObjectStore {
  readonly root: string;
  constructor(root: string, private readonly link: typeof fs.linkSync = fs.linkSync) {
    this.root = path.resolve(root);
    this.guard(this.root);
    const temp = path.join(this.root, `.sync-${randomUUID()}.tmp`);
    const linked = `${temp}.link`;
    try {
      const fd = openSafeSync(this.root, temp, 'create');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.link(temp, linked);
    } catch (e) {
      if (noLinks.has(errno(e) ?? '')) throw new SyncError('no-hard-links', "This drive's file system can't guarantee sync safely (no hard links). Use an NTFS, APFS or ext4 drive, or a folder on another drive.");
      throw e;
    } finally {
      for (const file of [linked, temp]) {
        try { fs.unlinkSync(file); } catch (e) { if (errno(e) !== 'ENOENT') throw e; }
      }
    }
  }

  private guard(full: string): void {
    const parsed = path.parse(full);
    let ancestor = parsed.root;
    for (const part of full.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      ancestor = path.join(ancestor, part);
      try {
        if (fs.lstatSync(ancestor).isSymbolicLink()) throw new SyncError('symlink', 'Sync stores cannot contain symlinks or junctions');
      } catch (e) { if (errno(e) !== 'ENOENT') throw e; }
    }
  }

  private resolve(name: string): string {
    checkObjectName(name);
    const full = resolveInside(this.root, name);
    if (!full || !realpathInside(this.root, full)) throw new SyncError('name', 'Object escapes sync store');
    this.guard(full);
    return full;
  }

  async putOnce(name: string, bytes: Uint8Array): Promise<'created' | 'exists'> {
    const full = this.resolve(name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    this.guard(full);
    const temp = path.join(path.dirname(full), `.sync-${randomUUID()}.tmp`);
    try {
      const fd = openSafeSync(this.root, temp, 'create');
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.guard(full);
      try { this.link(temp, full); }
      catch (e) { if (errno(e) === 'EEXIST') { this.guard(full); return 'exists'; } throw e; }
      this.syncDirectory(path.dirname(full));
      return 'created';
    } finally {
      try { fs.unlinkSync(temp); } catch (e) { if (errno(e) !== 'ENOENT') throw e; }
    }
  }

  private syncDirectory(dir: string): void {
    if (process.platform === 'win32') return;
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  async get(name: string, maxBytes: number): Promise<Uint8Array | null> {
    const full = this.resolve(name);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new SyncError('size', 'Invalid read limit');
    let fd: number;
    try { fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); }
    catch (e) { if (errno(e) === 'ENOENT') return null; throw e; }
    try {
      this.guard(full);
      const stat = fs.fstatSync(fd, { bigint: true });
      const named = fs.lstatSync(full, { bigint: true });
      if (!stat.isFile() || named.isSymbolicLink() || stat.ino !== named.ino || stat.dev !== named.dev) throw new SyncError('symlink', 'Sync object changed during open');
      if (stat.size > BigInt(maxBytes)) throw new SyncError('size', 'Sync object exceeds its size limit');
      // Bounded reads even if another process grows the file after fstat.
      const bytes = Buffer.alloc(Number(stat.size));
      let offset = 0;
      while (offset < bytes.length) {
        const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!n) throw new SyncError('size', 'Sync object was truncated during read');
        offset += n;
      }
      if (fs.fstatSync(fd, { bigint: true }).size !== stat.size) throw new SyncError('size', 'Sync object changed during read');
      return bytes;
    } finally { fs.closeSync(fd); }
  }

  async list(prefix: string, startAfter?: string): Promise<string[]> {
    checkListPrefix(prefix, startAfter);
    this.guard(this.root);
    const out: string[] = [];
    const walk = (dir: string, rel: string): void => {
      this.guard(dir);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new SyncError('symlink', 'Sync stores cannot contain symlinks or junctions');
        const name = rel + entry.name;
        if (entry.isDirectory()) {
          // Only descend through directories in the protocol grammar.
          if (/^(?:devices|keys|log|checkpoints|blobs|mailbox|keys\/[1-9][0-9]{0,9}|log\/[0-9a-f]{32}|blobs\/[0-9a-f]{2})$/.test(name)) walk(path.join(dir, entry.name), `${name}/`);
        } else if (entry.isFile() && validObjectName(name) && name.startsWith(prefix) && (startAfter === undefined || name > startAfter)) out.push(name);
      }
    };
    walk(this.root, '');
    return out.sort();
  }

  async remove(name: string): Promise<void> {
    checkObjectName(name);
    if (!name.startsWith('mailbox/')) throw new SyncError('name', 'Only mailbox objects may be removed');
    const full = this.resolve(name);
    try { fs.unlinkSync(full); this.syncDirectory(path.dirname(full)); }
    catch (e) { if (errno(e) !== 'ENOENT') throw e; }
  }
}
