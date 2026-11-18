/**
 * Which window a workspace opens in.
 *
 * Kept free of Electron so the rule is testable: a window owns its workspace,
 * and opening another one must never replace what someone already has open.
 */
export type WindowKind = 'workspace' | 'settings' | 'workspaces';

export interface WindowSummary {
  id: number;
  kind: WindowKind;
  /** The folder this window shows, or null while it has none. */
  repo: string | null;
}

export type OpenDecision =
  /** The folder is already on screen: bring that window forward. */
  | { action: 'focus'; id: number }
  /** The asking window is an empty workspace window (first run): it takes the folder. */
  | { action: 'adopt'; id: number }
  /** Anything else gets a window of its own. */
  | { action: 'new' };

export function decideOpen(
  dir: string,
  windows: WindowSummary[],
  fromId: number | null,
  key: (dir: string) => string,
): OpenDecision {
  const wanted = key(dir);
  const existing = windows.find((w) => w.kind === 'workspace' && w.repo !== null && key(w.repo) === wanted);
  if (existing) return { action: 'focus', id: existing.id };
  const from = windows.find((w) => w.id === fromId);
  if (from && from.kind === 'workspace' && from.repo === null) return { action: 'adopt', id: from.id };
  return { action: 'new' };
}

/** Terminal sessions are named by the renderer; this keeps one window's names out of another's. */
export const ptyKey = (ownerId: number, key: string) => `${ownerId}:${key}`;
export const ownsPtyKey = (ownerId: number, namespaced: string) => namespaced.startsWith(`${ownerId}:`);
