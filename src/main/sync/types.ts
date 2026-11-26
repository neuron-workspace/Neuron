export interface ObjectStore {
  putOnce(name: string, bytes: Uint8Array): Promise<'created' | 'exists'>;
  get(name: string, maxBytes: number): Promise<Uint8Array | null>;
  list(prefix: string, startAfter?: string): Promise<string[]>;
  /** Only mailbox objects may be removed. */
  remove(name: string): Promise<void>;
}

export interface WorkspaceFile {
  path: string;
  size: number;
  mtimeMs: number;
  /** The B2 walk must report/skip links, never follow them. */
  symlink?: boolean;
}

/** Main implements these operations inside its save queue, with guarded paths.
 * Writes require a journal pre-image; failed capture creates a conflict copy.
 * Removes require capture and OS trash. Reads refuse links and oversized files.
 */
export interface WorkspaceIO {
  list(): Promise<WorkspaceFile[]>;
  read(path: string, maxBytes: number): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array, deviceLabel: string): Promise<{ path: string; conflict: boolean }>;
  remove(path: string): Promise<{ success: boolean }>;
}

export class SyncError extends Error {
  constructor(public readonly code: 'name' | 'symlink' | 'size' | 'no-hard-links' | 'state' | 'alarm' | 'workspace' | 'wait' | 'busy', message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

// One anchored expression per object kind. Numeric bounds are checked below.
export const OBJECT_NAMES = {
  manifest: /^neuron-sync\.json$/,
  device: /^devices\/[0-9a-f]{32}\.json$/,
  key: /^keys\/[1-9][0-9]{0,9}\/(?:[0-9a-f]{32}|recovery|passphrase)\.env$/,
  commit: /^log\/[0-9a-f]{32}\/[1-9][0-9]{0,15}\.c$/,
  checkpoint: /^checkpoints\/[0-9a-f]{64}\.k$/,
  blob: /^blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/,
  mailbox: /^mailbox\/[0-9a-f]{32}\.m$/,
} as const;

export function validObjectName(name: string): boolean {
  if (!Object.values(OBJECT_NAMES).some((re) => re.test(name))) return false;
  const parts = name.split('/');
  if (parts[0] === 'keys' && Number(parts[1]) > 2 ** 31) return false;
  if (parts[0] === 'log' && !Number.isSafeInteger(Number(parts[2].slice(0, -2)))) return false;
  return parts[0] !== 'blobs' || parts[1] === parts[2].slice(0, 2);
}

export function checkObjectName(name: string): void {
  if (!validObjectName(name)) throw new SyncError('name', 'Invalid sync object name');
}

export function checkListPrefix(prefix: string, startAfter?: string): void {
  if (!/^(?:|devices\/|keys\/(?:[1-9][0-9]{0,9}\/)?|log\/(?:[0-9a-f]{32}\/)?|checkpoints\/|blobs\/(?:[0-9a-f]{2}\/)?|mailbox\/)$/.test(prefix)
    || (prefix.startsWith('keys/') && prefix !== 'keys/' && Number(prefix.split('/')[1]) > 2 ** 31)) {
    throw new SyncError('name', 'Invalid sync listing prefix');
  }
  if (startAfter !== undefined) checkObjectName(startAfter);
}
