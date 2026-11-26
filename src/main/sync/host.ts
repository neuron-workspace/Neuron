// The main-process side of sync for one workspace (D41). It starts the utility
// process, answers its workspace requests through WorkspaceIO (main stays the
// only writer), keeps the keys wrapped by the OS keychain under
// <userData>/sync/ (never in the workspace, never in settings.json), and decides
// when a pass runs. No electron import: main passes in the process spawner and
// the keychain codec.
import * as path from 'node:path';
import { decodeSecret, encodeSecret, noKeychainError, type EncryptedSecret, type SecretCodec } from '../secret-storage';
import type { SyncReport } from './engine';
import type { DeviceHex, FromWorker, IoOp, OpenArgs, Port, ToWorker, WorkerMethod } from './rpc';
import { readPrivate, writePrivate } from './state-store';
import { SyncError, type WorkspaceIO } from './types';

export interface WorkerProcess { port: Port; kill(): void; onExit(listener: () => void): void }

/** Saved in the main-only `sync` settings key, per workspace folder. Nothing secret. */
export interface SyncConfig { workspaceId: string; store: string; label: string }

export type SyncState = 'starting' | 'idle' | 'syncing' | 'waiting' | 'approval-required' | 'alarm' | 'paused';
export interface SyncStatus { state: SyncState; reason?: string; report?: SyncReport; lastPass?: number; warning?: string }

export interface HostDeps {
  spawn: () => WorkerProcess;
  io: WorkspaceIO;
  readIgnore: () => Promise<string>;
  userData: string;
  codec: SecretCodec;
  onStatus?: (status: SyncStatus) => void;
  /** Q19: a workspace already inside a OneDrive/Dropbox folder syncs twice. */
  warning?: string;
  now?: () => number;
  timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
}

export const SCHEDULE = { quietMs: 30_000, maxDelayMs: 5 * 60_000, rescanMs: 10 * 60_000 } as const;

const isHex = (v: unknown, chars: number) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${chars}}$`).test(v);

const open = (secret: unknown, codec: SecretCodec): string => {
  const value = decodeSecret(secret, codec);
  if (value === null || typeof secret === 'string') throw new SyncError('state', 'A sync key could not be opened with this computer\'s keychain');
  return value;
};

export class SyncHost {
  private worker: WorkerProcess | null = null;
  private nextId = 1;
  private readonly calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private status: SyncStatus = { state: 'starting' };
  private inFlight: Promise<SyncStatus> | null = null;
  private queued: Promise<SyncStatus> | null = null;
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private rescan: ReturnType<typeof setTimeout> | null = null;
  private firstTouch: number | null = null;
  private stopped = false;

  constructor(private readonly deps: HostDeps) {
    if (deps.warning) this.status.warning = deps.warning;
  }

  private get dir(): string { return path.join(this.deps.userData, 'sync'); }
  private timers() { return this.deps.timers ?? globalThis; }
  private now() { return (this.deps.now ?? Date.now)(); }

  private spawn(): WorkerProcess {
    if (this.worker) return this.worker;
    const worker = this.deps.spawn();
    this.worker = worker;
    worker.port.onMessage((raw) => void this.receive(raw as FromWorker));
    worker.onExit(() => {
      if (this.worker === worker) this.worker = null;
      for (const call of this.calls.values()) call.reject(new SyncError('wait', 'The sync process stopped'));
      this.calls.clear();
    });
    return worker;
  }

  private async receive(message: FromWorker): Promise<void> {
    if (message?.kind === 'result') {
      const call = this.calls.get(message.id);
      if (!call) return;
      this.calls.delete(message.id);
      if (message.ok) call.resolve(message.value); else call.reject(new Error(message.error ?? 'Sync failed'));
      return;
    }
    if (message?.kind !== 'io') return;
    const reply = (m: Omit<Extract<ToWorker, { kind: 'io-result' }>, 'kind' | 'id'>) =>
      this.worker?.port.postMessage({ kind: 'io-result', id: message.id, ...m } satisfies ToWorker);
    const ops: Record<IoOp, (...a: any[]) => Promise<unknown>> = {
      list: () => this.deps.io.list(),
      read: (p, max) => this.deps.io.read(p, max),
      write: (p, bytes, label) => this.deps.io.write(p, bytes, label),
      remove: (p) => this.deps.io.remove(p),
    };
    if (!Object.hasOwn(ops, message.op) || !Array.isArray(message.args)) { reply({ ok: false, error: 'Unknown workspace operation', code: 'name' }); return; }
    try { reply({ ok: true, value: await ops[message.op](...message.args) }); }
    catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error), code: error instanceof SyncError ? error.code : 'wait' }); }
  }

  private call<T>(method: WorkerMethod, args: unknown = {}): Promise<T> {
    const worker = this.spawn();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      worker.port.postMessage({ kind: 'call', id, method, args } satisfies ToWorker);
    });
  }

  /** This installation's device keys, created once and wrapped by the OS keychain. */
  async device(): Promise<DeviceHex> {
    const file = path.join(this.dir, 'device.json');
    const saved = readPrivate(file) as { v?: number; deviceId?: string; boxPub?: string; signPub?: string; boxPriv?: EncryptedSecret; signPriv?: EncryptedSecret } | null;
    if (saved) {
      if (saved.v !== 1 || !isHex(saved.deviceId, 32) || !isHex(saved.boxPub, 64) || !isHex(saved.signPub, 64)) throw new SyncError('state', 'Sync device file is damaged');
      return { deviceId: saved.deviceId!, boxPub: saved.boxPub!, signPub: saved.signPub!, boxPriv: open(saved.boxPriv, this.deps.codec), signPriv: open(saved.signPriv, this.deps.codec) };
    }
    if (!this.deps.codec.available) throw new SyncError('state', noKeychainError(process.platform));
    const fresh = await this.call<DeviceHex>('new-device');
    writePrivate(file, { v: 1, deviceId: fresh.deviceId, boxPub: fresh.boxPub, signPub: fresh.signPub,
      boxPriv: encodeSecret(fresh.boxPriv, this.deps.codec), signPriv: encodeSecret(fresh.signPriv, this.deps.codec) });
    return fresh;
  }

  private saveKeys(workspaceId: string, keys: Array<[number, string]>): void {
    if (!isHex(workspaceId, 32)) throw new SyncError('state', 'Invalid workspace id');
    writePrivate(path.join(this.dir, workspaceId, 'keys.json'), { v: 1, workspaceId, keys: keys.map(([e, k]) => [e, encodeSecret(k, this.deps.codec)]) });
  }
  private loadKeys(workspaceId: string): Array<[number, string]> {
    const saved = readPrivate(path.join(this.dir, workspaceId, 'keys.json')) as { v?: number; workspaceId?: string; keys?: Array<[number, unknown]> } | null;
    if (!saved || saved.v !== 1 || saved.workspaceId !== workspaceId || !Array.isArray(saved.keys) || !saved.keys.length) throw new SyncError('state', 'This workspace\'s sync keys are missing on this computer');
    return saved.keys.map(([e, k]) => {
      if (!Number.isInteger(e) || e < 1) throw new SyncError('state', 'Sync key file is damaged');
      const hex = open(k, this.deps.codec);
      if (!isHex(hex, 64)) throw new SyncError('state', 'Sync key file is damaged');
      return [e, hex] as [number, string];
    });
  }

  /** Start syncing this workspace to an empty folder. The recovery key is returned once, for the caller to show. */
  async create(store: string, label: string): Promise<{ config: SyncConfig; recoveryKey: string }> {
    const device = await this.device();
    const made = await this.call<{ workspaceId: string; keys: Array<[number, string]>; recoveryKey: string }>('create', { storePath: store, device, label });
    this.saveKeys(made.workspaceId, made.keys);
    return { config: { workspaceId: made.workspaceId, store, label }, recoveryKey: made.recoveryKey };
  }

  /** Join a sync folder another device created, with its recovery key. */
  async join(store: string, recoveryKey: string, label: string): Promise<SyncConfig> {
    const device = await this.device();
    const joined = await this.call<{ workspaceId: string; keys: Array<[number, string]> }>('join', { storePath: store, device, recoveryKey, label });
    this.saveKeys(joined.workspaceId, joined.keys);
    return { workspaceId: joined.workspaceId, store, label };
  }

  /** Open the engine for a configured workspace and run the first pass. */
  async start(config: SyncConfig): Promise<void> {
    const args: OpenArgs = {
      storePath: config.store, stateDir: path.join(this.dir, config.workspaceId), workspaceId: config.workspaceId,
      device: await this.device(), keys: this.loadKeys(config.workspaceId), label: config.label,
    };
    await this.call('open', args);
    this.stopped = false;
    void this.pass();
  }

  /** The watcher saw a change: pass once things go quiet, but not later than maxDelayMs. */
  touch(): void {
    if (this.stopped) return;
    const t = this.timers();
    this.firstTouch ??= this.now();
    if (this.quiet) t.clearTimeout(this.quiet);
    const wait = Math.max(0, Math.min(SCHEDULE.quietMs, this.firstTouch + SCHEDULE.maxDelayMs - this.now()));
    this.quiet = t.setTimeout(() => { this.quiet = null; void this.pass(); }, wait);
  }

  /** One pass now. Asked for while one runs, it runs once right after, and resolves with that one. */
  pass(): Promise<SyncStatus> {
    if (this.stopped) return Promise.resolve(this.status);
    if (this.inFlight) return this.queued ??= this.inFlight.then(() => { this.queued = null; return this.pass(); });
    this.inFlight = this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async run(): Promise<SyncStatus> {
    this.firstTouch = null;
    this.setStatus({ state: 'syncing' });
    try {
      const report = await this.call<SyncReport>('sync', { ignore: await this.deps.readIgnore() });
      this.setStatus({ state: report.status === 'synced' ? 'idle' : report.status, reason: report.reason, report, lastPass: this.now() });
    } catch (error) {
      this.setStatus({ state: 'paused', reason: error instanceof Error ? error.message : String(error), lastPass: this.now() });
    } finally {
      const t = this.timers();
      if (this.rescan) t.clearTimeout(this.rescan);
      // The watcher can stop (design §3.5): a full rescan every 10 minutes anyway.
      if (!this.stopped) this.rescan = t.setTimeout(() => void this.pass(), SCHEDULE.rescanMs);
    }
    return this.status;
  }

  async approve(token: string): Promise<void> { await this.call('approve', { token }); void this.pass(); }
  async clearAlarm(): Promise<void> { await this.call('clear-alarm'); void this.pass(); }
  current(): SyncStatus { return this.status; }

  stop(): void {
    this.stopped = true;
    const t = this.timers();
    if (this.quiet) t.clearTimeout(this.quiet);
    if (this.rescan) t.clearTimeout(this.rescan);
    this.quiet = this.rescan = null;
    this.worker?.kill();
    this.worker = null;
  }

  private setStatus(next: SyncStatus): void {
    this.status = { ...next, ...(this.deps.warning ? { warning: this.deps.warning } : {}) };
    this.deps.onStatus?.(this.status);
  }
}

