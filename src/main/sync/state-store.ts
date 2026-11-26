import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SyncError } from './types';
import { openSafeSync } from '../safe-fs';

/** A small JSON file only this user can read (the wrapped sync keys), written atomically. */
export function writePrivate(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); } catch (error) { fs.rmSync(temp, { force: true }); throw error; }
}

/** The JSON writePrivate wrote, or null when there is none. Damage stops sync; it is never reset. */
export function readPrivate(file: string): unknown {
  try {
    // One handle for the size check and the read, so both see the same file.
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (fs.fstatSync(fd).size > 64 * 1024) throw new SyncError('state', 'Sync key file is too large');
      return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyncError) throw error;
    throw new SyncError('state', `Sync key file is unreadable: ${path.basename(file)}`);
  }
}

export interface StateIO {
  read<T>(schema: z.ZodType<T>): Promise<T | null>;
  write<T>(value: T, schema: z.ZodType<T>): Promise<void>;
}

/** Local metadata only. The caller keeps keys wrapped separately (B2). */
export class StateStore implements StateIO {
  private readonly file: string;
  static readonly maxBytes = 128 * 1024 * 1024;
  constructor(private readonly directory: string) {
    this.file = path.join(directory, 'state.json');
  }

  private guard(): void {
    let current = path.resolve(this.directory);
    while (true) {
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new SyncError('state', 'Sync state cannot use symlinks');
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    try {
      if (fs.lstatSync(this.file).isSymbolicLink()) throw new SyncError('state', 'Sync state cannot use symlinks');
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }

  async read<T>(schema: z.ZodType<T>): Promise<T | null> {
    this.guard();
    let fd: number;
    try { fd = openSafeSync(this.directory, this.file, 'read'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > StateStore.maxBytes) throw new Error('state exceeds its size limit');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!n) throw new Error('truncated state');
        offset += n;
      }
      if (fs.fstatSync(fd).size !== stat.size) throw new Error('state changed during read');
      return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch (e) {
      throw new SyncError('state', `Sync state is corrupt; restore it before syncing: ${e instanceof Error ? e.message : String(e)}`);
    } finally { fs.closeSync(fd); }
  }

  async write<T>(value: T, schema: z.ZodType<T>): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(schema.parse(value)), 'utf8');
    if (bytes.length > StateStore.maxBytes) throw new SyncError('state', 'Sync state exceeds 128 MiB; sync stopped without resetting it');
    this.guard();
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.guard();
    const temp = path.join(this.directory, `.state-${randomUUID()}.tmp`);
    try {
      const fd = openSafeSync(this.directory, temp, 'create');
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.guard();
      fs.renameSync(temp, this.file);
      if (process.platform !== 'win32') {
        const dir = fs.openSync(this.directory, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      }
    } finally {
      try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
  }
}
