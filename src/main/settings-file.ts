// Reading the settings file without ever losing it.
//
// Settings are written by read-modify-write: every change reads the whole file,
// changes one key and writes the whole file back. A file that would not parse
// used to read as "no settings", so the next write replaced it with defaults
// and saved keys, recent workspaces and view trust records were gone for good.
//
// Now a file that is there but cannot be read or parsed is moved aside first,
// to settings.corrupt-<timestamp>.json beside it, and only then does Neuron go
// on with defaults. A missing file is still the quiet first-run case.
import * as path from 'path';

/** The few fs calls this needs, so a test can hand in its own. */
export interface SettingsFs {
  existsSync(file: string): boolean;
  readFileSync(file: string, encoding: 'utf-8'): string;
  renameSync(from: string, to: string): void;
  readdirSync(dir: string): string[];
  unlinkSync(file: string): void;
}

/** How many damaged copies are kept; the oldest go first. */
export const CORRUPT_COPY_LIMIT = 3;
const CORRUPT_COPY = /^settings\.corrupt-.+\.json$/;

export type SettingsLoad =
  /** Nothing saved yet (or an empty file): defaults, and nothing to say. */
  | { status: 'missing' }
  | { status: 'ok'; settings: Record<string, unknown> }
  /** Damaged and moved aside to `copy`. Nothing of it is in the way of a write. */
  | { status: 'damaged'; file: string; copy: string }
  /**
   * Damaged, and it could not be moved aside. It is still at `file`, so the
   * caller must not write over it.
   */
  | { status: 'stuck'; file: string; error: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined;

/** A sortable timestamp that is a legal file name everywhere (no colons). */
export function corruptCopyName(now: number): string {
  return `settings.corrupt-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`;
}

/** Move a damaged file aside, then drop the oldest copies beyond the limit. */
function keepCopy(fs: SettingsFs, file: string, now: number): string {
  const dir = path.dirname(file);
  const base = corruptCopyName(now);
  let copy = path.join(dir, base);
  // Two in the same millisecond must not overwrite each other.
  for (let n = 2; fs.existsSync(copy); n++) copy = path.join(dir, base.replace(/\.json$/, `-${n}.json`));
  fs.renameSync(file, copy);
  try {
    const copies = fs.readdirSync(dir).filter((name) => CORRUPT_COPY.test(name)).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - CORRUPT_COPY_LIMIT))) {
      try { fs.unlinkSync(path.join(dir, old)); } catch { /* an old copy that stays is harmless */ }
    }
  } catch { /* the copy is kept; pruning can wait for the next one */ }
  return copy;
}

/**
 * Read the settings file, or the legacy one when there is no current file.
 * Never returns "missing" for a file that exists and holds something: such a
 * file is either read, moved aside, or reported as stuck.
 */
export function loadSettingsFile(fs: SettingsFs, file: string, legacyFile: string, now: number): SettingsLoad {
  const source = fs.existsSync(file) ? file : fs.existsSync(legacyFile) ? legacyFile : null;
  if (!source) return { status: 'missing' };

  let raw: string;
  try {
    raw = fs.readFileSync(source, 'utf-8');
  } catch (error) {
    // Gone between the two calls: that is a missing file, not a damaged one.
    if (errorCode(error) === 'ENOENT') return { status: 'missing' };
    return moveAside(fs, source, now);
  }
  // An empty file holds nothing that a reset could lose.
  if (!raw.trim()) return { status: 'missing' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(parsed)) return { status: 'ok', settings: parsed };
  } catch { /* falls through: damaged */ }
  return moveAside(fs, source, now);
}

function moveAside(fs: SettingsFs, file: string, now: number): SettingsLoad {
  try {
    return { status: 'damaged', file, copy: keepCopy(fs, file, now) };
  } catch (error) {
    return { status: 'stuck', file, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The settings file as main.ts uses it: `read` gives the saved settings (or
 * null for defaults) and tells `notify` about damage once per run; `canWrite`
 * is false while a damaged file that could not be moved aside is still there.
 */
export function createSettingsReader(options: {
  fs: SettingsFs;
  file: () => string;
  legacyFile: () => string;
  notify: (message: string) => void;
  now?: () => number;
}) {
  let told = false;
  let stuck = false;
  return {
    read(): Record<string, unknown> | null {
      const load = loadSettingsFile(options.fs, options.file(), options.legacyFile(), (options.now ?? Date.now)());
      stuck = load.status === 'stuck';
      if ((load.status === 'damaged' || load.status === 'stuck') && !told) {
        told = true;
        options.notify(damagedSettingsNotice(load));
      }
      return load.status === 'ok' ? load.settings : null;
    },
    canWrite: (): boolean => !stuck,
  };
}

/** What the user is told, once, about a damaged settings file. */
export function damagedSettingsNotice(load: Extract<SettingsLoad, { status: 'damaged' | 'stuck' }>): string {
  return load.status === 'damaged'
    ? `Neuron's settings file was damaged and has been reset. A copy was kept at ${load.copy}`
    : `Neuron's settings file is damaged and could not be moved aside, so Neuron is using default settings and will not save settings changes until it is fixed or removed. The file is at ${load.file}`;
}
