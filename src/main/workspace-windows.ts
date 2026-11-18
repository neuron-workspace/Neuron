/**
 * Which window a workspace opens in.
 *
 * Kept free of Electron so the rule is testable: a window owns its workspace,
 * and opening another one must never replace what someone already has open.
 */
export type WindowKind = 'workspace' | 'settings';

/** The sections of the Settings window. */
export const SETTINGS_SECTIONS = ['workspaces', 'appearance', 'keyboard', 'editor', 'connectors', 'about'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

/**
 * Old section ids, still accepted from older callers. Plugins became
 * Connectors; a workspace's own settings moved into its window.
 */
export const SETTINGS_ALIASES: Record<string, SettingsSection> = { plugins: 'connectors', workspace: 'appearance' };

/** Shared by main, which gets this id over IPC, and the renderer, which reads it from its URL. */
export function isSettingsSection(id: unknown): id is SettingsSection {
  return typeof id === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(id);
}

/** The section an id asks for, aliases included, or null for anything else. */
export function settingsSectionOf(id: unknown): SettingsSection | null {
  if (isSettingsSection(id)) return id;
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS_ALIASES, id) ? SETTINGS_ALIASES[id] : null;
}

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
