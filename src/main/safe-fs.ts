// ponytail: residual race, accepted by the P0-1 reviewer decision. Bytes are
// read and written only through handles whose identity (dev/ino) is matched to
// the checked path after opening, so a swapped link is never read or written
// through. What is left is path-based, in the instant between the last
// re-check and the call, because Node's rename/unlink and Electron's
// shell.trashItem take names, not handles:
//   - rename, unlink, trash: a parent or the target swapped for a link in that
//     instant is followed. After a rename the destination is verified (inside
//     the workspace, no link on the way, the same file) and a failure is thrown
//     loudly; nothing is undone through the link. unlink and trash cannot be
//     verified afterwards.
//   - create (O_EXCL) and mkdir: a parent swapped in that instant can leave an
//     empty file or folder outside the workspace. The handle is then refused,
//     so no byte is written there.
//   - Windows: Node has no O_NOFOLLOW there, so the open itself may follow a
//     link; the post-open identity check refuses the handle before any byte
//     moves.
// Ceiling: path-based rename/unlink between the last check and the call.
// Upgrade path: a native openat/renameat/unlinkat helper (POSIX), or a Windows
// handle-based rename via SetFileInformationByHandle(FileRenameInfo), under its
// own D8 decision (a native module is a new dependency).
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { hasGitSegment, hasUnsafeSegment } from './repoPath';

export type SafeFsPhase = 'before-open' | 'after-open' | 'before-path-check' | 'after-path-check' | 'after-rename';
type Hook = (phase: SafeFsPhase, file: string) => void;
let testHook: Hook | undefined;
/** Deterministic race injection for unit tests; never set by application code. */
export function setSafeFsTestHook(hook?: Hook): void { testHook = hook; }

function refusal(): never {
  throw Object.assign(new Error('Unsafe file path: changed identity or link outside the workspace.'), { code: 'EUNSAFEPATH' });
}
function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) && !hasGitSegment(rel);
}
// BigInt stats: NTFS file ids do not fit a double, and a rounded id could match another file.
const same = (a: fs.BigIntStats, b: fs.BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

interface Snapshot {
  realRoot: string;
  /** Every existing segment from the root down, pinned by identity. */
  chain: Map<string, fs.BigIntStats>;
  /** The file itself, when it exists. */
  final?: fs.BigIntStats;
}

/**
 * Where the file names the workspace root. Callers hold the root as given or
 * its real path (resolveInside is lexical, resolveInWorkspace is real), and a
 * file may also reach the root through another spelling of a folder above it:
 * macOS /var is a link to /private/var, and Windows temp folders are often
 * 8.3 names (RUNNER~1). Links and aliases above the root are legitimate; the
 * shallowest ancestor of the file whose real path is the real root is taken,
 * so every segment below the root is still checked (and a link is refused).
 */
function baseCandidates(root: string, realRoot: string, file: string): { base?: string; ancestors: string[] } {
  if (inside(root, file)) return { base: root, ancestors: [] };
  if (inside(realRoot, file)) return { base: realRoot, ancestors: [] };
  const ancestors: string[] = [];
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    ancestors.unshift(dir);
    if (path.dirname(dir) === dir) return { ancestors };
  }
}
const isRealRoot = (realRoot: string, real: string) => path.relative(realRoot, real) === '';

/** The paths to check, from the root down to the file. */
function segmentsOf(base: string, file: string): string[] {
  const rel = path.relative(base, file);
  if (hasUnsafeSegment(rel) || hasGitSegment(rel)) refusal();
  const list = [base];
  for (const part of rel.split(path.sep).filter(Boolean)) list.push(path.join(list[list.length - 1], part));
  return list;
}

function segmentsOfSync(root: string, realRoot: string, file: string): string[] {
  const { base, ancestors } = baseCandidates(root, realRoot, file);
  if (base) return segmentsOf(base, file);
  for (const dir of ancestors) {
    let real: string;
    try { real = fs.realpathSync.native(dir); } catch { continue; }
    if (isRealRoot(realRoot, real)) return segmentsOf(dir, file);
  }
  return refusal();
}

async function segmentsOfAsync(root: string, realRoot: string, file: string): Promise<string[]> {
  const { base, ancestors } = baseCandidates(root, realRoot, file);
  if (base) return segmentsOf(base, file);
  for (const dir of ancestors) {
    let real: string;
    try { real = await fs.promises.realpath(dir); } catch { continue; }
    if (isRealRoot(realRoot, real)) return segmentsOf(dir, file);
  }
  return refusal();
}

/**
 * Accept one segment. The root itself was chosen by the user and may be a link
 * (it is pinned by its real path instead); below it, nothing may be a link and
 * every parent must be a folder.
 */
function accept(index: number, count: number, stat: fs.BigIntStats): void {
  if (index === 0 ? !stat.isDirectory() : stat.isSymbolicLink() || (index < count - 1 && !stat.isDirectory())) refusal();
}

function snapshotSync(root: string, file: string, missing: boolean): Snapshot {
  root = path.resolve(root);
  file = path.resolve(file);
  const realRoot = fs.realpathSync.native(root);
  const list = segmentsOfSync(root, realRoot, file);
  const chain = new Map<string, fs.BigIntStats>();
  for (let i = 0; i < list.length; i++) {
    let stat: fs.BigIntStats;
    try { stat = i === 0 ? fs.statSync(list[i], { bigint: true }) : fs.lstatSync(list[i], { bigint: true }); } catch (error) {
      if (missing && i > 0 && errorCode(error) === 'ENOENT') break;
      throw error;
    }
    accept(i, list.length, stat);
    chain.set(list[i], stat);
  }
  // One realpath of the deepest existing segment covers any redirect above it
  // that lstat does not call a link (other reparse points, 8.3 names to .git).
  if (!inside(realRoot, fs.realpathSync.native([...chain.keys()].pop()!))) refusal();
  return { realRoot, chain, final: chain.get(list[list.length - 1]) };
}

async function snapshot(root: string, file: string, missing: boolean): Promise<Snapshot> {
  root = path.resolve(root);
  file = path.resolve(file);
  const realRoot = await fs.promises.realpath(root);
  const list = await segmentsOfAsync(root, realRoot, file);
  const chain = new Map<string, fs.BigIntStats>();
  for (let i = 0; i < list.length; i++) {
    let stat: fs.BigIntStats;
    try { stat = i === 0 ? await fs.promises.stat(list[i], { bigint: true }) : await fs.promises.lstat(list[i], { bigint: true }); } catch (error) {
      if (missing && i > 0 && errorCode(error) === 'ENOENT') break;
      throw error;
    }
    accept(i, list.length, stat);
    chain.set(list[i], stat);
  }
  if (!inside(realRoot, await fs.promises.realpath([...chain.keys()].pop()!))) refusal();
  return { realRoot, chain, final: chain.get(list[list.length - 1]) };
}

/** Nothing pinned in `before` moved, and the root still resolves to the same place. */
function compare(before: Snapshot, after: Snapshot): Snapshot {
  if (path.relative(before.realRoot, after.realRoot) !== '') refusal();
  for (const [segment, stat] of before.chain) {
    const current = after.chain.get(segment);
    if (!current || !same(stat, current)) refusal();
  }
  return after;
}
const recheckSync = (root: string, file: string, before: Snapshot, missing = false) => compare(before, snapshotSync(root, file, missing));
const recheck = async (root: string, file: string, before: Snapshot, missing = false) => compare(before, await snapshot(root, file, missing));

/** Throws unless `file` (which may be missing) is inside `root` with no link on the way. */
export function checkSafePath(root: string, file: string, missing = false): void { snapshotSync(root, file, missing); }

const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
export type OpenMode = 'read' | 'write' | 'create';
const flags = (mode: OpenMode) => noFollow | (fs.constants.O_NONBLOCK ?? 0) | (mode === 'read' ? fs.constants.O_RDONLY :
  mode === 'create' ? fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL : fs.constants.O_RDWR);

/** The handle is a plain file, and the checked name still names exactly it. */
function verifyHandle(before: Snapshot, after: Snapshot, handleStat: fs.BigIntStats): void {
  compare(before, after);
  if (!handleStat.isFile() || !after.final || !same(handleStat, after.final)) refusal();
}

/**
 * Open a workspace file by handle. Read and write modes check after opening
 * (the identity check refuses whatever was opened); create re-checks before
 * opening too, to keep an O_EXCL create from landing outside the workspace.
 */
export async function openSafe(root: string, file: string, mode: OpenMode = 'read'): Promise<fs.promises.FileHandle> {
  const before = await snapshot(root, file, mode === 'create');
  testHook?.('before-open', file);
  if (mode === 'create') await recheck(root, file, before, true);
  const handle = await fs.promises.open(file, flags(mode), 0o666);
  try {
    testHook?.('after-open', file);
    const stat = await handle.stat({ bigint: true });
    verifyHandle(before, await snapshot(root, file, false), stat);
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

export function openSafeSync(root: string, file: string, mode: OpenMode = 'read'): number {
  const before = snapshotSync(root, file, mode === 'create');
  testHook?.('before-open', file);
  if (mode === 'create') recheckSync(root, file, before, true);
  const fd = fs.openSync(file, flags(mode), 0o666);
  try {
    testHook?.('after-open', file);
    verifyHandle(before, snapshotSync(root, file, false), fs.fstatSync(fd, { bigint: true }));
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}

export function readSafeSync(root: string, file: string, limit = Infinity): Buffer {
  const fd = openSafeSync(root, file);
  try {
    if (fs.fstatSync(fd).size > limit) throw new Error('File exceeds the read limit.');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function mkdirSafeSync(root: string, directory: string): void {
  const before = snapshotSync(root, directory, true);
  fs.mkdirSync(directory, { recursive: true });
  recheckSync(root, directory, before);
}

export function unlinkSafeSync(root: string, file: string): void {
  const before = snapshotSync(root, file, false);
  testHook?.('before-path-check', file);
  recheckSync(root, file, before);
  testHook?.('after-path-check', file);
  fs.unlinkSync(file);
}

/** `trash` is Electron's shell.trashItem, injected so this runs without Electron. */
export async function trashSafe(root: string, file: string, trash: (file: string) => Promise<void>): Promise<void> {
  const before = await snapshot(root, file, false);
  testHook?.('before-path-check', file);
  await recheck(root, file, before);
  testHook?.('after-path-check', file);
  await trash(file);
}

function verifyRename(root: string, to: string, source: Snapshot): void {
  testHook?.('after-rename', to);
  try {
    const destination = snapshotSync(root, to, false);
    if (path.relative(source.realRoot, destination.realRoot) !== '' || !destination.final || !same(source.final!, destination.final)) refusal();
  } catch (error) {
    const failure = new Error(`Rename completed but destination verification FAILED for ${to}; inspect the workspace before continuing.`, { cause: error });
    console.error(failure.message, error instanceof Error ? error.message : error);
    throw Object.assign(failure, { code: 'EUNSAFERENAME' });
  }
}

/** Rename inside the workspace; both ends re-checked just before the call, the destination verified after it. */
export async function renameSafe(root: string, from: string, to: string): Promise<void> {
  const source = await snapshot(root, from, false);
  const target = await snapshot(root, to, true);
  testHook?.('before-path-check', to);
  compare(source, await snapshot(root, from, false));
  compare(target, await snapshot(root, to, true));
  testHook?.('after-path-check', to);
  await fs.promises.rename(from, to);
  verifyRename(root, to, source);
}

export function renameSafeSync(root: string, from: string, to: string): void {
  const source = snapshotSync(root, from, false);
  const target = snapshotSync(root, to, true);
  testHook?.('before-path-check', to);
  recheckSync(root, from, source);
  recheckSync(root, to, target, true);
  testHook?.('after-path-check', to);
  fs.renameSync(from, to);
  verifyRename(root, to, source);
}

/** Synchronous atomic write: temp file beside the target, written and fsynced by handle, then renamed. */
export function writeSafeAtomicSync(root: string, file: string, bytes: string | Buffer): void {
  checkSafePath(root, file, true);
  mkdirSafeSync(root, path.dirname(file));
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let pending = false;
  try {
    const fd = openSafeSync(root, tmp, 'create');
    pending = true;
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    renameSafeSync(root, tmp, file);
    pending = false;
  } finally {
    if (pending) try { unlinkSafeSync(root, tmp); } catch { /* never clean up through a swapped path */ }
  }
}
