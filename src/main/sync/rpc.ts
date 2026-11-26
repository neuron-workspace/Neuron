// Messages between main and the sync utility process (D41). Bytes travel as
// Uint8Array (structured clone). The worker never touches the workspace: every
// workspace operation is an `io` request that main answers.

export type WorkerMethod = 'new-device' | 'create' | 'join' | 'open' | 'sync' | 'approve' | 'clear-alarm';
export type IoOp = 'list' | 'read' | 'write' | 'remove';

export type ToWorker =
  | { kind: 'call'; id: number; method: WorkerMethod; args: unknown }
  | { kind: 'io-result'; id: number; ok: boolean; value?: unknown; error?: string; code?: string };

export type FromWorker =
  | { kind: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
  | { kind: 'io'; id: number; op: IoOp; args: unknown[] };

/** Device keys as hex, for the trip to main, which wraps them with the OS keychain. */
export interface DeviceHex { deviceId: string; boxPub: string; boxPriv: string; signPub: string; signPriv: string }

/** What the worker needs to sync one workspace; keys only in memory. */
export interface OpenArgs {
  storePath: string; stateDir: string; workspaceId: string;
  device: DeviceHex; keys: Array<[number, string]>; label: string;
}

/** The minimal port both utilityProcess (parentPort) and a Node fork provide. */
export interface Port {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
}
