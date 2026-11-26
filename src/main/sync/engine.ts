import { z } from 'zod';
import { chunkBoundaries } from './chunker';
import { bytesEqual, fromHex, SyncFormatError, toHex, utf8 } from './codec';
import { blobId, blobKeyFor, BLOB_MAX_BYTES, commitHash, CommitChange, decodeCommit, encodeBlob, encodeCheckpoint, encodeCommit, LIMITS, treeVersionSchema, TreeVersion } from './format';
import { DeviceKeys, deriveSubkey } from './keys';
import { conflictName, excluded, NotSynced, planSync, projectTree, splitChanges, unsafePath } from './planner';
import { blobName, Credentials, logName, readContent, readManifest, RemoteView, replay, snapshot, VerifiedLog, verifyCheckpoints, verifyRemote } from './remote';
import { StateIO } from './state-store';
import { ObjectStore, SyncError, WorkspaceIO } from './types';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const baseEntry = z.strictObject({ path: z.string(), hash, size: count, mtimeMs: z.number().finite() });
const actionSchema = z.strictObject({ path: z.string(), expected: hash.nullable(), target: treeVersionSchema.nullable(), conflict: z.boolean() });
const pendingSchema = z.strictObject({
  commits: z.array(z.string().regex(/^[0-9a-f]+$/)).max(20000),
  actions: z.array(actionSchema).max(40000), index: count,
  bases: z.array(baseEntry).max(20000), removed: z.array(z.string()).max(20000),
});
export const engineStateSchema = z.strictObject({
  version: z.literal(1), workspaceId: z.string().regex(/^[0-9a-f]{32}$/), deviceId: z.string().regex(/^[0-9a-f]{32}$/),
  alarm: z.string().nullable(), known: z.record(z.string(), hash), hwm: z.record(z.string().regex(/^[0-9a-f]{32}$/), count),
  checkpoints: z.array(z.string()), base: z.array(baseEntry).max(20000),
  pending: pendingSchema.nullable(), inFlight: z.strictObject({ seq: count, hash }).nullable(),
  proposal: z.strictObject({ fingerprint: hash, commits: z.array(z.string()) }).nullable(),
  mass: z.strictObject({ token: hash, paths: z.array(z.string()) }).nullable(), approved: hash.nullable(),
  checkpointCount: count, checkpointBytes: count,
}).superRefine((s, ctx) => {
  const hwm: Record<string, number> = Object.create(null);
  for (const name of Object.keys(s.known)) {
    const m = /^log\/([0-9a-f]{32})\/([1-9][0-9]*)\.c$/.exec(name);
    if (!m || !Number.isSafeInteger(Number(m[2]))) { ctx.addIssue({ code: 'custom', message: 'Invalid known commit name' }); continue; }
    hwm[m[1]] = Math.max(hwm[m[1]] ?? 0, Number(m[2]));
  }
  for (const d of new Set([...Object.keys(hwm), ...Object.keys(s.hwm)])) {
    if (hwm[d] !== s.hwm[d]) ctx.addIssue({ code: 'custom', message: 'HWM regression or inconsistent state' });
    // Count names rather than looping up to an attacker-controlled sequence.
    if (Object.keys(s.known).filter((n) => n.startsWith(`log/${d}/`)).length !== s.hwm[d]) ctx.addIssue({ code: 'custom', message: 'Known log has gaps' });
  }
  if (new Set(s.base.map((b) => b.path)).size !== s.base.length) ctx.addIssue({ code: 'custom', message: 'Duplicate base path' });
  if (s.pending && s.pending.index > s.pending.actions.length) ctx.addIssue({ code: 'custom', message: 'Invalid apply cursor' });
});
type EngineState = z.infer<typeof engineStateSchema>;

export interface SyncReport {
  status: 'synced' | 'waiting' | 'approval-required' | 'alarm' | 'paused';
  reason?: string; uploaded: number; applied: string[]; conflicts: string[];
  notSynced: NotSynced[]; massChange?: { token: string; paths: string[] };
}
export interface EngineOptions extends Credentials {
  store: ObjectStore; workspace: WorkspaceIO; state: StateIO; device: DeviceKeys;
  now?: () => number;
  /** This device's own exclusions (.neuron/sync-ignore): a reason, or null. Never deletes elsewhere. */
  ignore?: (path: string) => string | null;
}

/** One instance per device/workspace. The caller must also prevent two processes
 * from sharing device keys/state concurrently (B2's single utility process).
 */
export class SyncEngine {
  private busy = false;
  private readonly idKey: Uint8Array;
  constructor(private readonly options: EngineOptions) {
    const first = options.keys.get(1);
    if (!first) throw new SyncError('state', 'First epoch key is required for stable CDC and local hashes');
    this.idKey = deriveSubkey(first, 'blobid');
  }

  private empty(): EngineState {
    return { version: 1, workspaceId: this.options.workspaceId, deviceId: this.options.device.deviceId,
      alarm: null, known: {}, hwm: {}, checkpoints: [], base: [], pending: null, inFlight: null,
      proposal: null, mass: null, approved: null, checkpointCount: 0, checkpointBytes: 0 };
  }
  private async load(): Promise<EngineState> {
    const state = await this.options.state.read(engineStateSchema) ?? this.empty();
    if (state.workspaceId !== this.options.workspaceId || state.deviceId !== this.options.device.deviceId) throw new SyncError('state', 'State belongs to another workspace or device');
    return state;
  }
  private save(state: EngineState): Promise<void> { return this.options.state.write(state, engineStateSchema); }
  private localHash(bytes: Uint8Array | null): string | null { return bytes === null ? null : blobId(bytes, this.idKey); }

  /** This device's .neuron/sync-ignore rules; main reads the file before each pass. */
  setIgnore(ignore: EngineOptions['ignore']): void { this.options.ignore = ignore; }

  async approveMassChange(token: string): Promise<void> {
    if (this.busy) throw new SyncError('busy', 'A sync pass is running');
    const state = await this.load();
    if (state.alarm) throw new SyncError('alarm', state.alarm);
    if (!state.mass || state.mass.token !== token) throw new SyncError('state', 'Mass-change approval does not match the pending plan');
    state.approved = token;
    await this.save(state);
  }

  /** Alarm clearing is deliberately an explicit caller operation, never automatic. */
  async clearAlarm(): Promise<void> {
    if (this.busy) throw new SyncError('busy', 'A sync pass is running');
    const state = await this.load();
    state.alarm = null;
    await this.save(state);
  }

  async syncOnce(): Promise<SyncReport> {
    if (this.busy) throw new SyncError('busy', 'A sync pass is already running');
    this.busy = true;
    const report: SyncReport = { status: 'synced', uploaded: 0, applied: [], conflicts: [], notSynced: [] };
    let state: EngineState | undefined;
    try {
      state = await this.load();
      if (state.alarm) { report.status = 'alarm'; report.reason = state.alarm; return report; }
      const o = this.options;
      // A workspace mismatch must not write even local state.
      await readManifest(o.store, o.workspaceId);
      let view = await verifyRemote(o.store, o, state.known);
      const checkpoints = await verifyCheckpoints(o.store, o, view, state.checkpoints);
      if (!view.registry.get(o.device.deviceId)?.active) throw new SyncError('alarm', 'This device is not authorised');
      if (state.pending) {
        // Complete the durable transaction before observing fresh local edits.
        for (const encoded of state.pending.commits) {
          const log = this.decodeOurs(encoded);
          if (!view.logs.some((l) => l.commit.hash === log.commit.hash) && log.commit.header.epoch !== view.epoch) throw new SyncError('alarm', 'Pending commit predates an observed key rotation');
        }
        await this.finish(state, report);
        view = await verifyRemote(o.store, o, state.known);
      }
      this.observe(state, view);
      state.checkpoints = checkpoints;
      await this.prepare(state, view, report);
      if (report.status === 'approval-required') return report;
      if (state.pending) {
        const published = state.pending.commits.map((c) => this.decodeOurs(c));
        await this.finish(state, report);
        view = replay([...view.logs, ...published]);
      }
      this.observe(state, view);
      const totalBytes = view.logs.reduce((n, l) => n + l.bytes.length, 0);
      if (view.logs.length - state.checkpointCount >= 200 || totalBytes - state.checkpointBytes >= 5 * 1024 * 1024) {
        const bytes = encodeCheckpoint({ workspaceId: o.workspaceId, epoch: view.epoch, seq: view.hwm[o.device.deviceId], body: snapshot(view) }, o.keys.get(view.epoch)!, o.device);
        const name = `checkpoints/${commitHash(bytes)}.k`;
        await o.store.putOnce(name, bytes);
        const stored = await o.store.get(name, LIMITS.commitMax);
        if (!stored || !bytesEqual(stored, bytes)) throw new SyncError('alarm', 'Checkpoint upload verification failed');
        state.checkpoints = [...new Set([...state.checkpoints, name])];
        state.checkpointCount = view.logs.length; state.checkpointBytes = totalBytes;
      }
      await this.save(state);
      return report;
    } catch (e) {
      const security = e instanceof SyncFormatError || e instanceof SyncError && ['alarm', 'symlink', 'size', 'name'].includes(e.code);
      report.status = security ? 'alarm' : e instanceof SyncError && e.code === 'wait' ? 'waiting' : 'paused';
      report.reason = e instanceof Error ? e.message : String(e);
      if (security && state) {
        state.alarm = report.reason;
        try { await this.save(state); } catch (saveError) { report.reason += `; alarm could not be persisted: ${String(saveError)}`; }
      }
      return report;
    } finally { this.busy = false; }
  }

  private observe(state: EngineState, view: RemoteView): void {
    state.known = Object.fromEntries(view.logs.map((l) => [l.name, l.commit.hash]));
    state.hwm = { ...view.hwm };
  }

  private decodeOurs(hex: string): VerifiedLog {
    const o = this.options, bytes = fromHex(hex);
    const commit = decodeCommit(bytes, { workspaceId: o.workspaceId, signPublicKey: o.device.signPublicKey, workspaceKeyForEpoch: (e) => o.keys.get(e) });
    if (commit.header.deviceId !== o.device.deviceId) throw new SyncError('alarm', 'In-flight commit is not ours');
    return { bytes, commit, name: logName(o.device.deviceId, commit.header.seq) };
  }

  private async prepare(state: EngineState, view: RemoteView, report: SyncReport): Promise<void> {
    const o = this.options;
    const listing = await o.workspace.list();
    if (listing.length > LIMITS.changes) throw new SyncError('size', 'Workspace exceeds 20,000 files');
    const base = new Map(state.base.map((b) => [b.path, b]));
    const localHashes = new Map<string, string>();
    const hashes = new Map<string, string>();
    const excludedPaths = new Set<string>();
    const changes: CommitChange[] = [];
    const remoteFiles = projectTree(view.tree).files;
    const key = o.keys.get(view.epoch);
    if (!key) throw new SyncError('alarm', 'Current epoch key is unavailable');
    const idKey = deriveSubkey(key, 'blobid'), blobKey = deriveSubkey(key, 'blobkey');
    const ignored = (p: string) => o.ignore?.(p) ?? null;
    for (const file of listing) {
      const reason = excluded(file) ?? ignored(file.path) ?? unsafePath(file.path);
      if (reason) { report.notSynced.push({ path: file.path, reason }); excludedPaths.add(file.path); continue; }
      const old = base.get(file.path);
      // Metadata is a candidate filter only; destructive apply re-reads every file.
      if (old && old.size === file.size && old.mtimeMs === file.mtimeMs) { hashes.set(file.path, old.hash); continue; }
      const bytes = await o.workspace.read(file.path, LIMITS.fileMax);
      if (bytes === null) continue;
      const sha = this.localHash(bytes)!;
      hashes.set(file.path, sha);
      localHashes.set(`${view.epoch}:${blobId(bytes, idKey)}`, sha);
      if (old?.hash === sha) continue;
      const remoteVersion = remoteFiles.get(file.path);
      if (remoteVersion?.content && blobId(bytes, deriveSubkey(o.keys.get(remoteVersion.epoch)!, 'blobid')) === remoteVersion.content.sha) continue;
      const content: NonNullable<CommitChange['content']> = { chunks: [], size: bytes.length, sha: blobId(bytes, idKey) };
      for (const { offset, length } of chunkBoundaries(bytes, deriveSubkey(o.keys.get(1)!, 'cdc'))) {
        const chunk = bytes.subarray(offset, offset + length), chunkKey = blobKeyFor(chunk, blobKey), id = blobId(chunk, idKey);
        content.chunks.push({ blobId: id, blobKey: toHex(chunkKey), size: length });
      }
      // The base ref must use the producing epoch's content ID, not a local hash.
      const remoteBase = remoteFiles.get(file.path);
      const oldContent = old ? await this.findBaseContent(view, file.path, old.hash) : null;
      changes.push({ path: file.path, kind: 'put', base: oldContent ?? (old ? remoteBase?.content?.sha ?? null : null), content, mode: 'file' });
    }
    for (const [p, old] of base) if (!hashes.has(p) && !excludedPaths.has(p)) {
      const reason = excluded({ path: p, size: old.size, mtimeMs: old.mtimeMs }) ?? ignored(p) ?? unsafePath(p);
      if (reason) { excludedPaths.add(p); report.notSynced.push({ path: p, reason }); continue; }
      if (!remoteFiles.has(p)) continue;
      const ref = await this.findBaseContent(view, p, old.hash);
      if (ref) changes.push({ path: p, kind: 'delete', base: ref, content: null, mode: 'file' });
    }
    const fingerprint = commitHash(utf8(JSON.stringify({ heads: view.heads, changes })));
    let staged: VerifiedLog[];
    if (state.proposal?.fingerprint === fingerprint) staged = state.proposal.commits.map((c) => this.decodeOurs(c));
    else {
      staged = [];
      let seq = view.hwm[o.device.deviceId] ?? 0;
      let parents = view.heads, seenVector = { ...view.hwm };
      for (const batch of splitChanges(changes.sort((a, b) => a.path < b.path ? -1 : 1))) {
        const bytes = encodeCommit({ workspaceId: o.workspaceId, epoch: view.epoch, seq: ++seq, body: {
          epoch: view.epoch, parents, seenVector, time: (o.now ?? Date.now)(), changes: batch, deviceOps: [],
        } }, key, o.device);
        const log = this.decodeOurs(toHex(bytes)); staged.push(log);
        parents = [log.commit.hash]; seenVector = { ...seenVector, [o.device.deviceId]: seq };
      }
      state.proposal = { fingerprint, commits: staged.map((l) => toHex(l.bytes)) };
    }
    const merged = replay([...view.logs, ...staged]);
    const projected = projectTree(merged.tree);
    report.notSynced.push(...projected.notSynced);
    const targetHashes = new Map<string, string>();
    const targets = projected.files;
    if (targets.size > LIMITS.changes) throw new SyncError('size', 'Projected workspace exceeds 20,000 files');
    // Ignored here means neither sent nor received; it still exists on other devices.
    for (const p of [...targets.keys()]) {
      const reason = excludedPaths.has(p) ? null : ignored(p);
      if (reason) { excludedPaths.add(p); report.notSynced.push({ path: p, reason }); }
    }
    for (const p of excludedPaths) targets.delete(p);
    for (const [p, v] of targets) {
      // Content hashes from epoch 1 already use the stable local hash key.
      const cached = v.epoch === 1 ? v.content!.sha : localHashes.get(`${v.epoch}:${v.content!.sha}`);
      targetHashes.set(p, cached ?? this.localHash(await readContent(o.store, o, v))!);
    }
    const plan = planSync(hashes, new Set([...new Set([...base.keys(), ...hashes.keys()])].filter((p) => !excludedPaths.has(p))), targets, targetHashes);
    if (!plan.actions.length && !staged.length) {
      const metadata = new Map(listing.map((f) => [f.path, f]));
      for (const [p, v] of targets) {
        const file = metadata.get(p);
        if (file) base.set(p, { path: p, hash: targetHashes.get(p)!, size: v.content!.size, mtimeMs: file.mtimeMs });
      }
      for (const p of base.keys()) if (!targets.has(p) && !excludedPaths.has(p) && !hashes.has(p)) base.delete(p);
      state.base = [...base.values()]; state.proposal = null; state.mass = null; state.approved = null;
      return;
    }
    if (plan.needsApproval && state.approved !== plan.token) {
      state.mass = { token: plan.token, paths: plan.destructive }; state.approved = null;
      await this.save(state);
      report.status = 'approval-required'; report.massChange = state.mass; return;
    }
    // Stage immutable ciphertext before workspace mutation. A durable pending
    // transaction can then reconstruct every version after a crash without
    // storing plaintext or multi-gigabyte file buffers in local JSON.
    const existing = new Set(await o.store.list('blobs/'));
    for (const log of staged) for (const c of log.commit.body.changes) if (c.content) {
      const source = await o.workspace.read(c.path, LIMITS.fileMax);
      if (!source || blobId(source, idKey) !== c.content.sha) throw new SyncError('wait', 'Local file changed before staging; replan required');
      let offset = 0;
      for (const ref of c.content.chunks) {
        const name = blobName(ref.blobId), chunk = source.subarray(offset, offset + ref.size);
        const bytes = encodeBlob(chunk, fromHex(ref.blobKey, 32));
        if (!existing.has(name)) { await o.store.putOnce(name, bytes); existing.add(name); }
        const back = await o.store.get(name, BLOB_MAX_BYTES);
        if (!back || back.length !== bytes.length) throw new SyncError('alarm', 'Blob upload size verification failed');
        offset += ref.size;
      }
      await readContent(o.store, o, { content: c.content, epoch: view.epoch, hash: log.commit.hash, deviceId: o.device.deviceId, label: view.registry.get(o.device.deviceId)!.label, time: log.commit.body.time });
    }
    const bases = [...targets].map(([p, v]) => ({ path: p, hash: targetHashes.get(p)!, size: v.content!.size, mtimeMs: -1 }));
    state.pending = { commits: staged.map((l) => toHex(l.bytes)), actions: plan.actions, index: 0, bases, removed: [...base.keys()].filter((p) => !targets.has(p) && !excludedPaths.has(p)) };
    state.mass = null; state.approved = null; state.proposal = null;
    await this.save(state);
  }

  private async findBaseContent(view: RemoteView, p: string, localHash: string): Promise<string | null> {
    // Keep the reference lookup unambiguous across key epochs and derived conflict paths.
    for (const log of [...view.logs].reverse()) for (const c of log.commit.body.changes) if (c.content) {
      if (log.commit.header.epoch === 1 && c.content.sha === localHash) return c.content.sha;
      if (log.commit.header.epoch !== 1 && (c.path === p || p.includes(' (conflict, '))) {
        const bytes = await readContent(this.options.store, this.options, { content: c.content, epoch: log.commit.header.epoch, hash: log.commit.hash, deviceId: log.commit.header.deviceId, label: view.registry.get(log.commit.header.deviceId)!.label, time: log.commit.body.time });
        if (this.localHash(bytes) === localHash) return c.content.sha;
      }
    }
    return null;
  }

  private async finish(state: EngineState, report: SyncReport): Promise<void> {
    const pending = state.pending!, o = this.options;
    // Preflight all planned content before the first write, including restarts.
    for (const a of pending.actions) if (a.target) await readContent(o.store, o, a.target);
    for (const encoded of pending.commits) {
      const log = this.decodeOurs(encoded);
      for (const c of log.commit.body.changes) if (c.content) await readContent(o.store, o, {
        content: c.content, epoch: log.commit.header.epoch, hash: log.commit.hash,
        deviceId: o.device.deviceId, label: 'Pending device', time: log.commit.body.time,
      });
    }
    for (; pending.index < pending.actions.length; pending.index++) {
      const a = pending.actions[pending.index];
      if (unsafePath(a.path) || excluded({ path: a.path, size: a.target?.content?.size ?? 0, mtimeMs: 0 })) throw new SyncError('alarm', 'Unsafe path in durable apply plan');
      const incoming = a.target ? await readContent(o.store, o, a.target) : null;
      const current = await o.workspace.read(a.path, LIMITS.fileMax);
      const actual = this.localHash(current), desired = this.localHash(incoming);
      if (actual !== desired) {
        // This comparison must remain immediately before I/O: the editor can
        // save after planning, including while a mass-change prompt is open.
        if (actual !== a.expected) {
          if (incoming && a.target) {
            const safe = conflictName(a.path, a.target);
            const oldConflict = await o.workspace.read(safe, LIMITS.fileMax);
            if (this.localHash(oldConflict) !== desired) {
              // Never overwrite an unrelated conflict copy on a race path.
              const destination = oldConflict ? `Recovered ${a.target.hash}.bin` : safe;
              const result = await o.workspace.write(destination, incoming, a.target.label);
              report.conflicts.push(result.path);
            }
          } else report.conflicts.push(a.path);
        } else if (incoming && a.target) {
          const result = await o.workspace.write(a.path, incoming, a.target.label);
          report.applied.push(result.path);
          if (result.conflict || a.conflict) report.conflicts.push(result.path);
        } else {
          const result = await o.workspace.remove(a.path);
          if (!result.success) { report.conflicts.push(a.path); }
          else report.applied.push(a.path);
        }
      }
      // Save the cursor after the I/O; a crash in between rechecks the bytes.
      const next = pending.index + 1;
      pending.index = next;
      await this.save(state);
      pending.index = next - 1;
    }
    for (const encoded of pending.commits) {
      const log = this.decodeOurs(encoded);
      const seq = log.commit.header.seq;
      state.inFlight = { seq, hash: log.commit.hash };
      await this.save(state);
      const existing = await o.store.get(log.name, LIMITS.commitMax);
      if (existing) {
        // ADOPT_IN_FLIGHT: never regenerate a different commit for this seq.
        const adopted = this.decodeOurs(toHex(existing));
        if (adopted.commit.header.seq !== seq || adopted.commit.hash !== log.commit.hash) throw new SyncError('alarm', 'In-flight sequence was equivocated');
      } else {
        if (await o.store.putOnce(log.name, log.bytes) !== 'created') throw new SyncError('alarm', 'In-flight sequence was concurrently occupied');
        const back = await o.store.get(log.name, LIMITS.commitMax);
        if (!back || !bytesEqual(back, log.bytes)) throw new SyncError('alarm', 'Commit read-back differs from in-flight commit');
        report.uploaded++;
      }
      state.known[log.name] = log.commit.hash;
      state.hwm[o.device.deviceId] = Math.max(state.hwm[o.device.deviceId] ?? 0, seq);
      state.inFlight = null;
      await this.save(state);
    }
    const listing = new Map((await o.workspace.list()).map((f) => [f.path, f]));
    const bases = new Map(state.base.map((b) => [b.path, b]));
    for (const p of pending.removed) {
      if (!listing.has(p)) bases.delete(p);
      // If a delete raced an edit, retain the old base to upload that edit next pass.
    }
    for (const b of pending.bases) {
      const file = listing.get(b.path);
      const actual = this.localHash(await o.workspace.read(b.path, LIMITS.fileMax));
      if (actual === b.hash && file) bases.set(b.path, { ...b, size: file.size, mtimeMs: file.mtimeMs });
      // Failed capture or concurrent edit: record the remote baseline with a
      // forced rescan. The existing local version is then uploaded, never lost.
      else bases.set(b.path, { ...b, mtimeMs: -1 });
    }
    state.base = [...bases.values()]; state.pending = null;
    await this.save(state);
  }
}
