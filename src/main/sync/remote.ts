import { z } from 'zod';
import { bytesEqual, decodeUtf8, fromHex, toHex, utf8 } from './codec';
import { BLOB_MAX_BYTES, blobId, CheckpointBody, checkpointBodySchema, commitHash, decodeBlob, decodeCheckpoint, decodeCommit, DecodedCommit, encodeCommit, encodeDeviceEnvelope, encodeRecoveryEnvelope, LIMITS, openRecoveryEnvelope, RegistryEntry, TreeVersion } from './format';
import { DeviceKeys, deriveSubkey, generateWorkspaceKey, parsePublicIdentity, serialisePublicIdentity } from './keys';
import { foldChange, Tree } from './planner';
import { ObjectStore, SyncError, validObjectName } from './types';
import { sodium } from './sodium';

export interface Credentials { workspaceId: string; keys: Map<number, Uint8Array> }
export interface VerifiedLog { name: string; bytes: Uint8Array; commit: DecodedCommit }
export interface RemoteView {
  logs: VerifiedLog[]; tree: Tree; registry: Map<string, RegistryEntry>;
  hwm: Record<string, number>; heads: string[]; epoch: number;
}
const manifestSchema = z.strictObject({ format: z.literal('neuron-sync'), version: z.literal(1), workspaceId: z.string().regex(/^[0-9a-f]{32}$/) });
export const logName = (deviceId: string, seq: number): string => `log/${deviceId}/${seq}.c`;
export const blobName = (id: string): string => `blobs/${id.slice(0, 2)}/${id}`;
const alarm = (message: string): never => { throw new SyncError('alarm', message); };

export async function readManifest(store: ObjectStore, expected?: string): Promise<string> {
  const bytes = await store.get('neuron-sync.json', 512);
  if (!bytes) throw new SyncError('workspace', 'Sync folder has no neuron-sync.json');
  let manifest;
  try { manifest = manifestSchema.parse(JSON.parse(decodeUtf8(bytes))); }
  catch { throw new SyncError('workspace', 'Invalid neuron-sync.json; sync stopped'); }
  if (expected && manifest.workspaceId !== expected) throw new SyncError('workspace', 'This folder belongs to another workspace');
  return manifest.workspaceId;
}

export async function readContent(store: ObjectStore, credentials: Credentials, version: TreeVersion): Promise<Uint8Array> {
  const content = version.content;
  const wk = credentials.keys.get(version.epoch);
  if (!content || !wk) return alarm('Missing content key');
  const idKey = deriveSubkey(wk, 'blobid');
  const bytes = new Uint8Array(content.size);
  let offset = 0;
  // Sequential transfers are bounded below the maximum of four, including 100 MiB files.
  for (const chunk of content.chunks) {
    const encoded = await store.get(blobName(chunk.blobId), BLOB_MAX_BYTES);
    if (!encoded) throw new SyncError('wait', `Missing blob ${chunk.blobId}; commit deferred`);
    const data = decodeBlob(encoded, fromHex(chunk.blobKey, 32), { blobId: chunk.blobId, blobidKey: idKey });
    if (data.length !== chunk.size) return alarm('Blob length differs from its signed reference');
    bytes.set(data, offset);
    offset += data.length;
  }
  if (blobId(bytes, idKey) !== content.sha) return alarm('File content ID does not match its signed reference');
  return bytes;
}

/** Deterministic topological replay. Registry authority never comes from discovery. */
export function replay(logs: VerifiedLog[]): RemoteView {
  const todo = new Map(logs.map((l) => [l.commit.hash, l]));
  const byPosition = new Map(logs.map((l) => [logName(l.commit.header.deviceId, l.commit.header.seq), l]));
  if (todo.size !== logs.length || byPosition.size !== logs.length) return alarm('Duplicate or equivocated log position');
  const done = new Set<string>();
  const hwm: Record<string, number> = Object.create(null);
  const registry = new Map<string, RegistryEntry>();
  const heads = new Set<string>();
  const ordered: VerifiedLog[] = [];
  const tree: Tree = new Map();
  let epoch = 1;
  while (todo.size) {
    const ready = [...todo.values()].filter(({ commit: c }) => c.header.seq === (hwm[c.header.deviceId] ?? 0) + 1
      && c.body.parents.every((p) => done.has(p))
      && Object.entries(c.body.seenVector).every(([d, n]) => (hwm[d] ?? 0) >= n))
      .sort((a, b) => a.commit.hash < b.commit.hash ? -1 : 1);
    if (!ready.length) throw new SyncError('wait', 'Commit gap or unresolved causal dependencies; waiting');
    const log = ready[0];
    const { header: h, body: b, hash } = log.commit;
    if (h.epoch !== epoch) return alarm('Commit uses an obsolete or unannounced key epoch');
    if ((b.seenVector[h.deviceId] ?? 0) !== h.seq - 1) return alarm('Signer seenVector regressed or claims its own future');
    // Every predecessor must be causally acknowledged, including the device's own log.
    const previous = h.seq > 1 ? byPosition.get(logName(h.deviceId, h.seq - 1)) : undefined;
    if (previous && !b.parents.some((p) => p === previous.commit.hash || includesAncestor(p, previous.commit.hash, logs))) return alarm('Own predecessor is not a causal parent');
    for (const parent of b.parents) {
      const c = logs.find((l) => l.commit.hash === parent)!.commit;
      if ((b.seenVector[c.header.deviceId] ?? 0) < c.header.seq) return alarm('seenVector does not cover parent');
      for (const [d, n] of Object.entries(c.body.seenVector)) if ((b.seenVector[d] ?? 0) < n) return alarm('seenVector regressed from parent');
    }
    const self = registry.get(h.deviceId);
    const selfAdds = b.deviceOps.filter((op) => op.op === 'add' && op.deviceId === h.deviceId);
    if (!self?.active) {
      // Revocation cannot be bypassed by self-adding again, even at seq 1.
      if (self || h.seq !== 1 || selfAdds.length !== 1 || b.deviceOps.length !== 1) return alarm('Unauthorised signer (self-add is only allowed in its first commit)');
    }
    if (!ordered.length && (h.seq !== 1 || b.parents.length || Object.values(b.seenVector).some((n) => n !== 0) || selfAdds.length !== 1)) return alarm('Invalid genesis commit');
    if (ordered.length && !b.parents.length) return alarm('A second genesis is not authorised');
    for (const op of b.deviceOps) {
      if (op.op === 'add') {
        if (op.deviceId === h.deviceId && h.seq !== 1) return alarm('Self-add is only allowed at seq 1');
        const old = registry.get(op.deviceId);
        if (old && (old.boxPub !== op.boxPub || old.signPub !== op.signPub || !old.active)) return alarm('Device identity substitution or re-add of revoked device');
        registry.set(op.deviceId, { deviceId: op.deviceId, boxPub: op.boxPub, signPub: op.signPub, label: op.label, active: true });
      } else if (op.op === 'remove') {
        const old = registry.get(op.deviceId);
        if (!old?.active) return alarm('Removal names an unauthorised device');
        registry.set(op.deviceId, { ...old, active: false });
      } else {
        if (op.epoch !== epoch + 1) return alarm('Rotation must advance exactly one epoch');
        epoch = op.epoch;
      }
    }
    const author = registry.get(h.deviceId)!;
    for (const change of b.changes) foldChange(tree, change.path, change.base, {
      content: change.content, epoch: h.epoch, hash, deviceId: h.deviceId, label: author.label, time: b.time,
    });
    if (tree.size > LIMITS.changes) throw new SyncError('size', 'Remote tree exceeds 20,000 paths (including retained tombstones)');
    hwm[h.deviceId] = h.seq;
    for (const p of b.parents) heads.delete(p);
    heads.add(hash);
    done.add(hash); todo.delete(hash); ordered.push(log);
  }
  if (heads.size > LIMITS.parents) throw new SyncError('size', 'More than 64 concurrent heads; sync stopped');
  return { logs: ordered, tree, registry, hwm, heads: [...heads].sort(), epoch };
}

function includesAncestor(hash: string, ancestor: string, logs: VerifiedLog[]): boolean {
  const byHash = new Map(logs.map((l) => [l.commit.hash, l.commit]));
  const todo = [hash], seen = new Set<string>();
  while (todo.length) {
    const next = todo.pop()!;
    if (next === ancestor) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    todo.push(...(byHash.get(next)?.body.parents ?? []));
  }
  return false;
}

export async function verifyRemote(store: ObjectStore, credentials: Credentials, known: Record<string, string> = {}): Promise<RemoteView> {
  const names = (await store.list('log/')).filter((n) => validObjectName(n) && n.startsWith('log/'));
  for (const name of Object.keys(known)) if (!names.includes(name)) return alarm(`Rollback: previously seen commit disappeared: ${name}`);
  const identities = new Map<string, ReturnType<typeof parsePublicIdentity>>();
  const logs: VerifiedLog[] = [];
  for (const name of names) {
    const [, deviceId, seqText] = name.split('/');
    let identity = identities.get(deviceId);
    if (!identity) {
      const bytes = await store.get(`devices/${deviceId}.json`, 512);
      if (!bytes) throw new SyncError('wait', 'Missing signer discovery object');
      identity = parsePublicIdentity(decodeUtf8(bytes));
      if (identity.deviceId !== deviceId) return alarm('Discovery signing key does not derive the named deviceId');
      identities.set(deviceId, identity);
    }
    const bytes = await store.get(name, LIMITS.commitMax);
    if (!bytes) return alarm('Listed or previously seen commit is unavailable');
    const hash = commitHash(bytes);
    if (known[name] && known[name] !== hash) return alarm(`Equivocation at ${name}`);
    logs.push({ name, bytes, commit: decodeCommit(bytes, { workspaceId: credentials.workspaceId, signPublicKey: identity.signPublicKey, workspaceKeyForEpoch: (e) => credentials.keys.get(e), seq: Number(seqText.slice(0, -2)) }) });
  }
  const byName = new Map(logs.map((l) => [l.name, l]));
  const hashes = new Set(logs.map((l) => l.commit.hash));
  for (const d of identities.keys()) {
    const seqs = logs.filter((l) => l.commit.header.deviceId === d).map((l) => l.commit.header.seq).sort((a, b) => a - b);
    if (seqs.some((seq, i) => seq !== i + 1)) throw new SyncError('wait', 'Device log has a sequence gap; waiting without skipping it');
  }
  for (const { commit: c } of logs) {
    for (const [d, n] of Object.entries(c.body.seenVector)) {
      if (n && !byName.has(logName(d, n))) return alarm('seenVector names a commit the store will not serve');
    }
    for (const parent of c.body.parents) if (!hashes.has(parent)) return alarm('Parent commit is unavailable');
  }
  if (!logs.length) return alarm('Device logs are empty; genesis is missing');
  const prior = replay(logs.filter((l) => known[l.name]));
  for (const { name, commit } of logs) if (!known[name]) {
    if (commit.header.epoch < prior.epoch || prior.registry.get(commit.header.deviceId)?.active === false) return alarm('New commit violates an already observed rotation or revocation');
  }
  const view = replay(logs);
  for (const [d, entry] of view.registry) {
    const identity = identities.get(d);
    if (identity && toHex(identity.signPublicKey) !== entry.signPub) return alarm('Discovery signPub differs from verified add');
  }
  // Verify all new commits in full before allowing *any* workspace mutation.
  for (const log of view.logs) if (!known[log.name]) {
    for (const c of log.commit.body.changes) if (c.content) await readContent(store, credentials, {
      content: c.content, epoch: log.commit.header.epoch, hash: log.commit.hash,
      deviceId: log.commit.header.deviceId, label: view.registry.get(log.commit.header.deviceId)!.label, time: log.commit.body.time,
    });
  }
  return view;
}

export function snapshot(view: RemoteView): CheckpointBody {
  return checkpointBodySchema.parse({
    epoch: view.epoch, tree: [...view.tree].sort(([a], [b]) => a < b ? -1 : 1),
    registry: [...view.registry.values()].sort((a, b) => a.deviceId < b.deviceId ? -1 : 1),
    covered: Object.entries(view.hwm).sort(([a], [b]) => a < b ? -1 : 1).map(([deviceId, seq]) => ({ deviceId, seq, hash: view.logs.find((l) => l.commit.header.deviceId === deviceId && l.commit.header.seq === seq)!.commit.hash })),
    heads: view.heads,
  });
}

export async function verifyCheckpoints(store: ObjectStore, credentials: Credentials, view: RemoteView, known: string[]): Promise<string[]> {
  const names = (await store.list('checkpoints/')).filter((n) => validObjectName(n) && n.startsWith('checkpoints/'));
  for (const name of known) if (!names.includes(name)) return alarm('Rollback: a verified checkpoint disappeared');
  let newest: { count: number; body: CheckpointBody } | undefined;
  for (const name of names) {
    const bytes = await store.get(name, LIMITS.commitMax);
    if (!bytes || bytes.length < 113 || bytes.length > LIMITS.commitMax) return alarm('Checkpoint size is out of range');
    if (!bytes || commitHash(bytes) !== name.slice(12, -2)) return alarm('Checkpoint hash mismatch');
    const signer = [...view.registry.values()].find((r) => sodium().crypto_sign_verify_detached(bytes.subarray(-64), bytes.subarray(0, -64), fromHex(r.signPub, 32)));
    if (!signer) return alarm('Checkpoint has no verified authorised signer');
    const decoded = decodeCheckpoint(bytes, { workspaceId: credentials.workspaceId, signPublicKey: fromHex(signer.signPub, 32), workspaceKeyForEpoch: (e) => credentials.keys.get(e) });
    const coverage = new Map(decoded.body.covered.map((c) => [c.deviceId, c]));
    const covered = view.logs.filter((l) => l.commit.header.seq <= (coverage.get(l.commit.header.deviceId)?.seq ?? 0));
    const at = replay(covered);
    if (!at.registry.get(signer.deviceId)?.active || decoded.header.seq !== at.hwm[signer.deviceId]
      || JSON.stringify(snapshot(at)) !== JSON.stringify(decoded.body)) return alarm('Checkpoint does not match its verified covered commits');
    // A checkpoint covering a prefix of this canonical order is a valid replay
    // starting point. Concurrent checkpoints can be valid without being a prefix.
    if (view.logs.slice(0, covered.length).every((l) => covered.some((c) => c.commit.hash === l.commit.hash))
      && (!newest || covered.length > newest.count)) newest = { count: covered.length, body: decoded.body };
  }
  if (newest) {
    const tree: Tree = new Map(newest.body.tree);
    for (const log of view.logs.slice(newest.count)) for (const c of log.commit.body.changes) {
      foldChange(tree, c.path, c.base, { content: c.content, epoch: log.commit.header.epoch, hash: log.commit.hash,
        deviceId: log.commit.header.deviceId, label: view.registry.get(log.commit.header.deviceId)!.label, time: log.commit.body.time });
    }
    view.tree = tree;
  }
  return names;
}

function addSelf(device: DeviceKeys, label: string) {
  return { op: 'add' as const, deviceId: device.deviceId, boxPub: toHex(device.boxPublicKey), signPub: toHex(device.signPublicKey), label };
}

export async function createRemote(store: ObjectStore, device: DeviceKeys, recoveryKey: Uint8Array, label = 'Device'): Promise<Credentials> {
  if (await store.get('neuron-sync.json', 512)) throw new SyncError('workspace', 'Remote already exists');
  if ((await store.list('')).length) throw new SyncError('workspace', 'Setup requires an empty sync store');
  const workspaceId = toHex(sodium().randombytes_buf(16)), key = generateWorkspaceKey();
  const context = { workspaceId, epoch: 1 };
  const commit = encodeCommit({ ...context, seq: 1, body: { epoch: 1, time: Date.now(), parents: [], seenVector: {}, changes: [], deviceOps: [addSelf(device, label)] } }, key, device);
  // The manifest reserves the store; an interrupted setup is never mistaken for a new store.
  if (await store.putOnce('neuron-sync.json', utf8(JSON.stringify({ format: 'neuron-sync', version: 1, workspaceId }))) !== 'created') throw new SyncError('workspace', 'Remote already exists');
  await store.putOnce(`devices/${device.deviceId}.json`, utf8(serialisePublicIdentity(device)));
  await store.putOnce(`keys/1/${device.deviceId}.env`, encodeDeviceEnvelope(key, context, device));
  await store.putOnce('keys/1/recovery.env', encodeRecoveryEnvelope(key, context, recoveryKey));
  await store.putOnce(logName(device.deviceId, 1), commit);
  return { workspaceId, keys: new Map([[1, key]]) };
}

export async function joinWithRecoveryKey(store: ObjectStore, device: DeviceKeys, recoveryKey: Uint8Array, label: string): Promise<Credentials> {
  const workspaceId = await readManifest(store);
  const keys = new Map<number, Uint8Array>();
  const epochs = (await store.list('keys/')).filter((n) => /^keys\/[1-9][0-9]*\/recovery\.env$/.test(n)).map((n) => Number(n.split('/')[1])).sort((a, b) => b - a);
  if (!epochs.length) throw new SyncError('workspace', 'Recovery envelope is missing');
  // Latest first. All historic epochs remain required to verify the log and CDC key.
  for (const epoch of epochs) {
    const bytes = await store.get(`keys/${epoch}/recovery.env`, LIMITS.envelopeMax);
    if (!bytes) throw new SyncError('wait', 'Recovery envelope is unavailable');
    keys.set(epoch, openRecoveryEnvelope(bytes, { workspaceId, epoch }, recoveryKey));
  }
  const credentials = { workspaceId, keys };
  const view = await verifyRemote(store, credentials);
  await verifyCheckpoints(store, credentials, view, []);
  if (view.epoch !== epochs[0] || !keys.has(1)) return alarm('Recovery epochs do not match the verified registry');
  if (view.registry.has(device.deviceId)) throw new SyncError('workspace', 'Device already has a log; resume it instead of joining again');
  const context = { workspaceId, epoch: view.epoch };
  const key = keys.get(view.epoch)!;
  const bytes = encodeCommit({ ...context, seq: 1, body: { epoch: view.epoch, time: Date.now(), parents: view.heads, seenVector: view.hwm, changes: [], deviceOps: [addSelf(device, label)] } }, key, device);
  const identityName = `devices/${device.deviceId}.json`;
  const identity = utf8(serialisePublicIdentity(device));
  if (await store.putOnce(identityName, identity) === 'exists' && !bytesEqual((await store.get(identityName, 512))!, identity)) return alarm('Existing discovery object differs from this device');
  await store.putOnce(`keys/${view.epoch}/${device.deviceId}.env`, encodeDeviceEnvelope(key, context, device));
  if (await store.putOnce(logName(device.deviceId, 1), bytes) !== 'created') return alarm('Join sequence already occupied; refusing equivocation');
  return credentials;
}
