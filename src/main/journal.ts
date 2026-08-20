import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type JournalOperation = 'overwrite' | 'delete';

export interface JournalLimits {
  maxEntries: number;
  maxAgeMs: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_JOURNAL_LIMITS: Readonly<JournalLimits> = Object.freeze({
  maxEntries: 1000,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
});

export interface JournalEntry {
  id: string;
  relativePath: string;
  operation: JournalOperation;
  createdAt: number;
  originalBytes: number;
  state: 'captured' | 'skipped';
  sha256?: string;
  skipReason?: 'file-too-large';
}

export type CaptureResult =
  | { status: 'captured' | 'skipped'; entry: JournalEntry }
  | { status: 'not-needed' | 'rejected' }
  | { status: 'failed'; error: string };

export type RestoreResult =
  | { success: true; path: string; bytes: number }
  | { success: false; error: string };

interface JournalOptions {
  limits?: Partial<JournalLimits>;
  now?: () => number;
  reportError?: (message: string, error?: unknown) => void;
}

const ENTRY_ID = /^\d+-[a-f0-9]{16}$/;

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function validateLimits(limits: JournalLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  }
}

export class WriteJournal {
  private readonly limits: JournalLimits;
  private readonly now: () => number;
  private readonly reportError: (message: string, error?: unknown) => void;

  constructor(private readonly userDataDirectory: string, options: JournalOptions = {}) {
    this.limits = { ...DEFAULT_JOURNAL_LIMITS, ...options.limits };
    validateLimits(this.limits);
    this.now = options.now ?? Date.now;
    this.reportError = options.reportError ?? ((message, error) => console.error(message, error));
  }

  capturePreImage(workspaceRoot: string, filePath: string, operation: JournalOperation): CaptureResult {
    const target = this.existingWorkspaceFile(workspaceRoot, filePath);
    if (target === 'missing') return { status: 'not-needed' };
    if (!target) return { status: 'rejected' };

    try {
      const stat = fs.statSync(target.fullPath);
      const entry: JournalEntry = {
        id: `${this.now()}-${crypto.randomBytes(8).toString('hex')}`,
        relativePath: target.relativePath,
        operation,
        createdAt: this.now(),
        originalBytes: stat.size,
        state: stat.size > this.limits.maxFileBytes ? 'skipped' : 'captured',
      };
      const store = this.storeDirectory(target.workspaceRoot);
      fs.mkdirSync(store, { recursive: true });

      if (entry.state === 'skipped') {
        entry.skipReason = 'file-too-large';
      } else {
        const bytes = fs.readFileSync(target.fullPath);
        entry.originalBytes = bytes.length;
        entry.sha256 = sha256(bytes);
        fs.writeFileSync(path.join(store, `${entry.id}.bin`), bytes, { flag: 'wx' });
      }

      try {
        this.writeEntry(store, entry);
      } catch (error) {
        if (entry.state === 'captured') {
          try { fs.unlinkSync(path.join(store, `${entry.id}.bin`)); } catch { /* best effort */ }
        }
        throw error;
      }
      this.pruneStore(store);
      return { status: entry.state, entry };
    } catch (error) {
      const message = `Failed to journal ${operation} pre-image for ${target.relativePath}.`;
      try { this.reportError(message, error); } catch { /* reporting must not block the write either */ }
      return { status: 'failed', error: message };
    }
  }

  list(workspaceRoot: string): JournalEntry[] {
    const root = this.workspaceRoot(workspaceRoot);
    if (!root) return [];
    const store = this.storeDirectory(root);
    if (!fs.existsSync(store)) return [];
    return this.readEntries(store).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  restore(workspaceRoot: string, entryId: string): RestoreResult {
    if (!ENTRY_ID.test(entryId)) return { success: false, error: 'Invalid journal entry.' };
    const root = this.workspaceRoot(workspaceRoot);
    if (!root) return { success: false, error: 'Invalid workspace root.' };

    try {
      const store = this.storeDirectory(root);
      const entry = this.readEntry(path.join(store, `${entryId}.json`));
      if (!entry || entry.id !== entryId) return { success: false, error: 'Journal entry not found.' };
      if (entry.state === 'skipped') return { success: false, error: 'The pre-image was skipped because the file exceeded the size limit.' };
      if (!entry.sha256) return { success: false, error: 'Journal entry is incomplete.' };

      const destination = this.restoreDestination(root, entry.relativePath);
      if (!destination) return { success: false, error: 'Journal entry points outside the workspace.' };
      const bytes = fs.readFileSync(path.join(store, `${entry.id}.bin`));
      if (bytes.length !== entry.originalBytes || sha256(bytes) !== entry.sha256) {
        return { success: false, error: 'Journal pre-image failed its integrity check.' };
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.journal.tmp`;
      try {
        fs.writeFileSync(temporary, bytes, { flag: 'wx' });
        fs.renameSync(temporary, destination);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch { /* best effort */ }
        throw error;
      }
      return { success: true, path: destination, bytes: bytes.length };
    } catch (error) {
      const message = 'Failed to restore journal entry.';
      try { this.reportError(message, error); } catch { /* best effort */ }
      return { success: false, error: message };
    }
  }

  private workspaceRoot(workspaceRoot: string): string | null {
    try {
      const root = fs.realpathSync.native(path.resolve(workspaceRoot));
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  }

  private existingWorkspaceFile(workspaceRoot: string, filePath: string):
    | { workspaceRoot: string; fullPath: string; relativePath: string }
    | 'missing'
    | null {
    const root = this.workspaceRoot(workspaceRoot);
    if (!root) return null;
    const lexicalTarget = path.resolve(filePath);
    if (!isInside(path.resolve(workspaceRoot), lexicalTarget) || lexicalTarget === path.resolve(workspaceRoot)) return null;
    if (!fs.existsSync(lexicalTarget)) return 'missing';
    try {
      const lstat = fs.lstatSync(lexicalTarget);
      if (!lstat.isFile() || lstat.isSymbolicLink()) return null;
      const fullPath = fs.realpathSync.native(lexicalTarget);
      if (!isInside(root, fullPath) || fullPath === root) return null;
      return {
        workspaceRoot: root,
        fullPath,
        relativePath: path.relative(root, fullPath).split(path.sep).join('/'),
      };
    } catch {
      return null;
    }
  }

  private restoreDestination(workspaceRoot: string, relativePath: string): string | null {
    if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) return null;
    const destination = path.resolve(workspaceRoot, relativePath.split('/').join(path.sep));
    if (!isInside(workspaceRoot, destination) || destination === workspaceRoot) return null;

    let existing = destination;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      existing = parent;
    }
    try {
      if (!isInside(workspaceRoot, fs.realpathSync.native(existing))) return null;
      if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) return null;
      return destination;
    } catch {
      return null;
    }
  }

  private storeDirectory(workspaceRoot: string): string {
    return path.join(path.resolve(this.userDataDirectory), 'journal', sha256(workspaceRoot));
  }

  private writeEntry(store: string, entry: JournalEntry): void {
    const destination = path.join(store, `${entry.id}.json`);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(entry), { encoding: 'utf-8', flag: 'wx' });
    try {
      fs.renameSync(temporary, destination);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* best effort */ }
      throw error;
    }
  }

  private readEntry(file: string): JournalEntry | null {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<JournalEntry>;
      if (!value || typeof value.id !== 'string' || !ENTRY_ID.test(value.id)
        || typeof value.relativePath !== 'string'
        || (value.operation !== 'overwrite' && value.operation !== 'delete')
        || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
        || typeof value.originalBytes !== 'number' || !Number.isSafeInteger(value.originalBytes) || value.originalBytes < 0
        || (value.state !== 'captured' && value.state !== 'skipped')) return null;
      return value as JournalEntry;
    } catch {
      return null;
    }
  }

  private readEntries(store: string): JournalEntry[] {
    return fs.readdirSync(store)
      .filter((name) => ENTRY_ID.test(name.slice(0, -5)) && name.endsWith('.json'))
      .map((name) => this.readEntry(path.join(store, name)))
      .filter((entry): entry is JournalEntry => entry !== null);
  }

  private pruneStore(store: string): void {
    let entries = this.readEntries(store).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const cutoff = this.now() - this.limits.maxAgeMs;
    for (const entry of entries.filter((item) => item.createdAt < cutoff)) this.removeEntry(store, entry);
    entries = entries.filter((item) => item.createdAt >= cutoff);

    while (entries.length > this.limits.maxEntries) this.removeEntry(store, entries.shift()!);
    let totalBytes = entries.reduce((sum, entry) => sum + (entry.state === 'captured' ? entry.originalBytes : 0), 0);
    while (totalBytes > this.limits.maxTotalBytes && entries.length > 1) {
      const oldest = entries.shift()!;
      this.removeEntry(store, oldest);
      if (oldest.state === 'captured') totalBytes -= oldest.originalBytes;
    }
  }

  private removeEntry(store: string, entry: JournalEntry): void {
    if (entry.state === 'captured') {
      try { fs.unlinkSync(path.join(store, `${entry.id}.bin`)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    fs.unlinkSync(path.join(store, `${entry.id}.json`));
  }
}

let activeJournal: WriteJournal | null = null;

export function configureWriteJournal(userDataDirectory: string, options: JournalOptions = {}): WriteJournal {
  activeJournal = new WriteJournal(userDataDirectory, options);
  return activeJournal;
}

export function capturePreImage(workspaceRoot: string, filePath: string, operation: JournalOperation): CaptureResult {
  if (!activeJournal) {
    const error = 'Write journal is not configured.';
    console.error(error);
    return { status: 'failed', error };
  }
  return activeJournal.capturePreImage(workspaceRoot, filePath, operation);
}

export function listJournalEntries(workspaceRoot: string): JournalEntry[] {
  return activeJournal?.list(workspaceRoot) ?? [];
}

export function restoreJournalEntry(workspaceRoot: string, entryId: string): RestoreResult {
  return activeJournal?.restore(workspaceRoot, entryId) ?? { success: false, error: 'Write journal is not configured.' };
}
