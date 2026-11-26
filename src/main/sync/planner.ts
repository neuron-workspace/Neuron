import { checkPortablePath, findCaseCollisions, portableFoldKey } from '../portable-path';
import { fileKind } from '../file-kinds';
import { hasGitSegment } from '../repoPath';
import { commitHash, CommitChange, LIMITS, TreeVersion } from './format';
import { utf8 } from './codec';
import { WorkspaceFile } from './types';

export interface NotSynced { path: string; reason: string }
export type Tree = Map<string, TreeVersion[]>;

export function excluded(file: WorkspaceFile): string | null {
  const p = portableFoldKey(file.path);
  const name = p.split('/').at(-1)!;
  if (file.symlink) return 'symlink';
  if (file.size > 100 * 1024 * 1024) return 'over 100 MiB';
  if (fileKind(p) === 'blocked') return 'program or script';
  if (/^(?:\.ds_store|thumbs\.db|desktop\.ini)$/.test(name)) return 'OS metadata';
  if (name.endsWith('.tmp') || name.startsWith('~$') || name.startsWith('.~') || name.endsWith('~') || name.includes('.conflict-in-progress')) return 'temporary file';
  if (p.startsWith('.neuron/')) {
    const part = p.split('/')[1];
    // Shared with HTML views and tables; everything else under .neuron (layout.json, caches) is per device.
    if (!['styles', 'fragments', 'templates', 'views', 'manifests', 'tables', 'variables.json', 'config.json'].includes(part)) return 'per-device or unclassified .neuron state';
  }
  if (p.split('/').some((part, i) => part.startsWith('.') && !(i === 0 && part === '.neuron'))) return 'hidden path (workspace walk rule)';
  return null;
}

export function unsafePath(p: string): string | null {
  const result = checkPortablePath(p);
  if (!result.portable || result.reasons.some((r) => r.code === 'path-too-long')) return 'non-portable path';
  if (hasGitSegment(p) || p.split('/').some((s) => /^git~[0-9]+$/i.test(s))) return 'repository internals';
  return null;
}

/** Uses the losing signed commit's UTC date, never the receiving device's clock. */
export function conflictName(p: string, v: TreeVersion): string {
  const slash = p.lastIndexOf('/');
  const file = p.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const ext = dot > 0 ? file.slice(dot).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16) : '';
  const stem = (dot > 0 ? file.slice(0, dot) : file).normalize('NFC').replace(/[^\p{L}\p{N}_ -]/gu, '_').slice(0, 48) || 'file';
  const label = v.label.normalize('NFC').replace(/[^\p{L}\p{N}_ -]/gu, '_').slice(0, 24) || 'device';
  // JS Date cannot represent every safe integer accepted by format v1.
  const date = v.time <= 253402300799999 ? new Date(v.time).toISOString().slice(0, 10) : '1970-01-01';
  const suffix = ` (conflict, ${label}, ${date} ${(v.content?.sha ?? v.hash).slice(0, 8)})${ext}`;
  let candidate = `${slash < 0 ? '' : p.slice(0, slash + 1)}${stem}${suffix}`;
  if (unsafePath(candidate) || excluded({ path: candidate, size: 0, mtimeMs: 0 })) candidate = `Recovered ${commitHash(utf8(p)).slice(0, 12)}${suffix}`;
  if (unsafePath(candidate)) candidate = `Recovered ${commitHash(utf8(p)).slice(0, 12)} (conflict, device, ${date} ${(v.content?.sha ?? v.hash).slice(0, 8)}).bin`;
  return candidate;
}

/** Three-way content table. A delete only consumes the version it observed;
 * concurrent edits survive. Replaying a canonical causal order makes ties stable.
 */
export function foldChange(tree: Tree, p: string, base: string | null, version: TreeVersion): void {
  const previous = tree.get(p) ?? [];
  const survivors = previous.filter((v) => v.content && v.content.sha !== base);
  if (version.content) {
    const equal = survivors.findIndex((v) => v.content?.sha === version.content!.sha);
    if (equal < 0) survivors.push(version);
    else if (version.hash > survivors[equal].hash) survivors[equal] = version;
  }
  tree.set(p, survivors.length ? survivors.sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0) : [version]);
}

export function projectTree(tree: Tree): { files: Map<string, TreeVersion>; notSynced: NotSynced[] } {
  const files = new Map<string, TreeVersion>();
  const notSynced: NotSynced[] = [];
  const candidates: { path: string; version: TreeVersion; conflict: boolean }[] = [];
  for (const [p, versions] of [...tree].sort(([a], [b]) => a < b ? -1 : 1)) {
    const live = versions.filter((v) => v.content).sort((a, b) => a.hash > b.hash ? -1 : 1);
    for (const [i, version] of live.entries()) {
      const unsafe = unsafePath(p);
      const reason = excluded({ path: p, size: version.content!.size, mtimeMs: 0 });
      // Unsafe names are preserved safely; exclusions are intentionally not materialised.
      if (!unsafe && reason) { notSynced.push({ path: p, reason }); continue; }
      const conflict = i > 0 || !!unsafe;
      if (unsafe) notSynced.push({ path: p, reason: `${unsafe}; recovered under a safe name` });
      const projected = conflict ? conflictName(p, version) : p.normalize('NFC');
      // A subsequent user edit/delete of a generated conflict copy is an
      // ordinary path operation and overrides that derived projection.
      if (conflict && projected !== p && tree.has(projected)) continue;
      candidates.push({ path: projected, version, conflict });
    }
  }
  // Prefer larger signed hashes, including case/folder collisions. No locale collation.
  candidates.sort((a, b) => a.version.hash === b.version.hash ? (a.path < b.path ? -1 : 1) : a.version.hash > b.version.hash ? -1 : 1);
  for (const c of candidates) {
    let name = c.path;
    const collides = (p: string) => [...files.keys()].some((other) => portableFoldKey(other) === portableFoldKey(p)
      || portableFoldKey(other).startsWith(`${portableFoldKey(p)}/`) || portableFoldKey(p).startsWith(`${portableFoldKey(other)}/`))
      || findCaseCollisions([...files.keys(), p]).length > 0;
    if (collides(name)) {
      if (files.get(name)?.content?.sha === c.version.content?.sha) continue;
      name = conflictName(c.path, c.version);
      if (name !== c.path && tree.has(name)) continue;
      if (collides(name)) name = `Recovered ${commitHash(utf8(c.path)).slice(0, 16)}-${c.version.hash}.bin`;
      if (collides(name)) { notSynced.push({ path: c.path, reason: 'conflict-name collision; content retained in log' }); continue; }
      notSynced.push({ path: c.path, reason: `case or name collision; recovered as ${name}` });
    }
    files.set(name, c.version);
  }
  return { files, notSynced };
}

export interface PlanAction { path: string; expected: string | null; target: TreeVersion | null; conflict: boolean }
export interface Plan { actions: PlanAction[]; destructive: string[]; token: string; needsApproval: boolean }

/** Keep one file change intact; v1's 801-reference file cap fits comfortably. */
export function splitChanges(changes: CommitChange[]): CommitChange[][] {
  const batches: CommitChange[][] = [];
  let batch: CommitChange[] = [], size = 0;
  for (const change of changes) {
    const bytes = utf8(JSON.stringify(change)).length;
    if (batch.length && (batch.length >= LIMITS.changes || size + bytes > 15 * 1024 * 1024)) {
      batches.push(batch); batch = []; size = 0;
    }
    batch.push(change); size += bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** local contains keyed whole-file hashes; targetHash uses the same first-epoch key. */
export function planSync(local: Map<string, string>, base: Set<string>, targets: Map<string, TreeVersion>, targetHash: Map<string, string>): Plan {
  const actions: PlanAction[] = [];
  for (const p of [...new Set([...base, ...targets.keys()])].sort()) {
    const expected = local.get(p) ?? null;
    const target = targets.get(p) ?? null;
    if (expected === (targetHash.get(p) ?? null)) continue;
    actions.push({ path: p, expected, target, conflict: p.includes(' (conflict, ') });
  }
  // A case/NFC rename can alias the old name on NTFS/APFS. Remove the captured
  // old spelling before creating its canonical replacement, never afterwards.
  actions.sort((a, b) => Number(!!a.target) - Number(!!b.target) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const destructive = actions.filter((a) => a.expected !== null).map((a) => a.path);
  const token = commitHash(utf8(JSON.stringify(actions)));
  return { actions, destructive, token, needsApproval: destructive.length > 50 || destructive.length > local.size * 0.2 };
}
