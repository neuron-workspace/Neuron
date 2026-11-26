// Entry point of the sync utility process (D41): crypto and the store live here.
// One process per workspace. It never touches the workspace: reads and writes go
// to main as `io` requests. Keys arrive from main in memory and are never written
// here. No electron import; the port is utilityProcess's parentPort, or a Node
// fork's IPC channel in the tests.
import { fromHex, toHex } from './codec';
import { SyncEngine, type SyncReport } from './engine';
import { FolderStore } from './folder-store';
import { parseIgnore } from './ignore';
import { formatRecoveryKey, generateDeviceKeys, generateRecoveryKey, parseRecoveryKey, type DeviceKeys } from './keys';
import { createRemote, joinWithRecoveryKey, type Credentials } from './remote';
import type { DeviceHex, FromWorker, IoOp, OpenArgs, Port, ToWorker } from './rpc';
import { initSodium } from './sodium';
import { StateStore } from './state-store';
import { SyncError, type WorkspaceIO } from './types';

const deviceToHex = (d: DeviceKeys): DeviceHex => ({
  deviceId: d.deviceId, boxPub: toHex(d.boxPublicKey), boxPriv: toHex(d.boxPrivateKey),
  signPub: toHex(d.signPublicKey), signPriv: toHex(d.signPrivateKey),
});
const deviceFromHex = (d: DeviceHex): DeviceKeys => ({
  deviceId: d.deviceId, boxPublicKey: fromHex(d.boxPub, 32), boxPrivateKey: fromHex(d.boxPriv, 32),
  signPublicKey: fromHex(d.signPub, 32), signPrivateKey: fromHex(d.signPriv, 64),
});
const credentialsOut = (c: Credentials) => ({ workspaceId: c.workspaceId, keys: [...c.keys].map(([e, k]) => [e, toHex(k)] as [number, string]) });

export function serve(port: Port): void {
  let engine: SyncEngine | null = null;
  let nextIo = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const io = (op: IoOp, ...args: unknown[]): Promise<unknown> => new Promise((resolve, reject) => {
    const id = nextIo++;
    pending.set(id, { resolve, reject });
    port.postMessage({ kind: 'io', id, op, args } satisfies FromWorker);
  });
  const workspace: WorkspaceIO = {
    list: () => io('list') as ReturnType<WorkspaceIO['list']>,
    read: (p, max) => io('read', p, max) as ReturnType<WorkspaceIO['read']>,
    write: (p, bytes, label) => io('write', p, bytes, label) as ReturnType<WorkspaceIO['write']>,
    remove: (p) => io('remove', p) as ReturnType<WorkspaceIO['remove']>,
  };

  const methods: Record<string, (args: any) => Promise<unknown>> = {
    'new-device': async () => deviceToHex(generateDeviceKeys()),
    async create({ storePath, device, label }: { storePath: string; device: DeviceHex; label: string }) {
      const recovery = generateRecoveryKey();
      const credentials = await createRemote(new FolderStore(storePath), deviceFromHex(device), recovery, label);
      // Shown once, by main, in a window that loads no plugins (S1c).
      return { ...credentialsOut(credentials), recoveryKey: formatRecoveryKey(recovery) };
    },
    async join({ storePath, device, recoveryKey, label }: { storePath: string; device: DeviceHex; recoveryKey: string; label: string }) {
      return credentialsOut(await joinWithRecoveryKey(new FolderStore(storePath), deviceFromHex(device), parseRecoveryKey(recoveryKey), label));
    },
    async open(a: OpenArgs) {
      engine = new SyncEngine({
        store: new FolderStore(a.storePath), state: new StateStore(a.stateDir), workspace,
        device: deviceFromHex(a.device), workspaceId: a.workspaceId,
        keys: new Map(a.keys.map(([e, k]) => [e, fromHex(k, 32)])),
      });
      return true;
    },
    async sync({ ignore }: { ignore: string }): Promise<SyncReport> {
      if (!engine) throw new SyncError('state', 'Sync is not open');
      engine.setIgnore(parseIgnore(ignore).match);
      return engine.syncOnce();
    },
    async approve({ token }: { token: string }) { if (!engine) throw new SyncError('state', 'Sync is not open'); await engine.approveMassChange(token); return true; },
    async 'clear-alarm'() { if (!engine) throw new SyncError('state', 'Sync is not open'); await engine.clearAlarm(); return true; },
  };

  port.onMessage(async (raw) => {
    const message = raw as ToWorker;
    if (message?.kind === 'io-result') {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.value);
      else waiter.reject(new SyncError((message.code as SyncError['code']) ?? 'wait', message.error ?? 'Workspace operation failed'));
      return;
    }
    if (message?.kind !== 'call' || !Object.hasOwn(methods, message.method)) return;
    try {
      await initSodium();
      port.postMessage({ kind: 'result', id: message.id, ok: true, value: await methods[message.method](message.args) } satisfies FromWorker);
    } catch (error) {
      port.postMessage({ kind: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies FromWorker);
    }
  });
}

// Started as a utility process (parentPort) or a Node fork (process.send).
const parent = (process as unknown as { parentPort?: { on(e: 'message', f: (m: { data: unknown }) => void): void; postMessage(m: unknown): void } }).parentPort;
if (parent) serve({ postMessage: (m) => parent.postMessage(m), onMessage: (f) => parent.on('message', (e) => f(e.data)) });
else if (process.send && process.env.NEURON_SYNC_WORKER === '1') serve({ postMessage: (m) => process.send!(m), onMessage: (f) => process.on('message', f) });
