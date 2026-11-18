import type { PluginConfigField, PluginManifest } from './types';

/**
 * Connectors are the services a person sets up once, in Settings, for every
 * workspace: an API key, an endpoint, a model name. Plugins are switched on per
 * workspace, and a workspace reaches a connector only through a plugin that is
 * on there. Kept free of React and Electron so these rules are unit-tested.
 */
export interface Connector {
  id: string;
  name: string;
  description: string;
  fields: PluginConfigField[];
  /** Ids of the plugins that use it. */
  usedBy: string[];
}

export type ConnectorValues = Record<string, Record<string, string>>;
/** Which secret fields are saved, per connector. Never the values. */
export type ConnectorSecrets = Record<string, Record<string, boolean>>;

/** The connectors, read off the plugins that declare one. Their config fields are the connector's. */
export function connectorsOf(manifests: PluginManifest[]): Connector[] {
  const byId = new Map<string, Connector>();
  for (const manifest of manifests) {
    const info = manifest.connector;
    if (!info) continue;
    const known = byId.get(info.id);
    if (!known) {
      byId.set(info.id, { ...info, fields: [...(manifest.configSchema ?? [])], usedBy: [manifest.id] });
      continue;
    }
    known.usedBy.push(manifest.id);
    for (const field of manifest.configSchema ?? []) {
      if (!known.fields.some((f) => f.key === field.key)) known.fields.push(field);
    }
  }
  return [...byId.values()];
}

export const secretFields = (fields: PluginConfigField[]) => fields.filter((f) => f.type === 'password');

/**
 * Connected once what the service cannot work without is saved: every secret
 * field, or for a connector with no secret (a local model), its endpoint.
 */
export function connectorStatus(fields: PluginConfigField[], values: Record<string, string> | undefined, secrets: Record<string, boolean> | undefined): 'connected' | 'not-set-up' {
  const secret = secretFields(fields);
  if (secret.length > 0) return secret.every((f) => secrets?.[f.key]) ? 'connected' : 'not-set-up';
  const endpoints = fields.filter((f) => f.type === 'url');
  if (endpoints.length > 0) return endpoints.some((f) => (values?.[f.key] ?? '').trim()) ? 'connected' : 'not-set-up';
  return 'connected';
}

/**
 * One identity per workspace folder, for the per-workspace plugin key.
 *
 * The same normalisation as main's folderKey (separators, trailing slash, case
 * on Windows and macOS), less resolving links: the renderer has no file system.
 */
export function workspaceKey(dir: string, platform: string): string {
  const windows = platform === 'win32';
  const sep = windows ? '\\' : '/';
  const spelled = windows ? dir.replace(/\//g, '\\') : dir;
  const unc = windows && spelled.startsWith('\\\\');
  const absolute = spelled.startsWith(sep);
  const parts: string[] = [];
  for (const part of spelled.split(sep)) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(part);
  }
  const normalised = (unc ? '\\\\' : absolute ? sep : '') + parts.join(sep) || dir;
  return windows || platform === 'darwin' ? normalised.toLowerCase() : normalised;
}

export const workspacePluginsKey = (dir: string, platform: string) => `plugins:${workspaceKey(dir, platform)}`;

/** What one workspace has switched on, and its own plugin options. */
export interface WorkspacePlugins {
  enabled: Record<string, boolean>;
  config: Record<string, Record<string, string>>;
}

/** The single global record from before plugins were per workspace (settings key `plugins`). */
export interface LegacyPlugins {
  enabled?: Record<string, boolean>;
  config?: Record<string, Record<string, string>>;
}

/** The workspaces this machine knew when the per-workspace keys first appeared. */
export function knownWorkspaceKeys(repositories: { current?: string | null; recent?: string[] } | null, platform: string): string[] {
  const dirs = [repositories?.current, ...(repositories?.recent ?? [])].filter((d): d is string => typeof d === 'string' && d.length > 0);
  return [...new Set(dirs.map((d) => workspaceKey(d, platform)))];
}

/**
 * A workspace's plugins: what it saved, or for its first open, what to start
 * with. A workspace that existed before the change starts with the plugins that
 * were on globally, so nothing disappears; any other starts with the defaults.
 * Defaults also fill in plugins the saved record has never mentioned.
 */
export function resolveWorkspacePlugins(
  saved: WorkspacePlugins | null,
  legacy: LegacyPlugins | null,
  legacyWorkspaces: string[] | null,
  key: string,
  defaults: Iterable<string>,
): WorkspacePlugins {
  const enabled: Record<string, boolean> = {};
  const config: Record<string, Record<string, string>> = {};
  const from = saved ? saved.enabled : legacy?.enabled && legacyWorkspaces?.includes(key) ? legacy.enabled : {};
  for (const [id, on] of Object.entries(from ?? {})) if (typeof on === 'boolean') enabled[id] = on;
  for (const id of defaults) if (enabled[id] === undefined) enabled[id] = true;
  for (const [id, values] of Object.entries(saved?.config ?? {})) if (values && typeof values === 'object') config[id] = { ...values };
  return { enabled, config };
}

/**
 * Connector settings copied from the old per-plugin config. Values already set
 * on a connector win; nothing in the old record is touched here. A secret found
 * in the old readable record is returned separately, for the secret store.
 */
export function migrateConnectorValues(legacyConfig: LegacyPlugins['config'] | null | undefined, manifests: PluginManifest[]): { values: ConnectorValues; secrets: { connector: string; field: string; value: string }[] } {
  const values: ConnectorValues = {};
  const secrets: { connector: string; field: string; value: string }[] = [];
  for (const manifest of manifests) {
    const id = manifest.connector?.id;
    const old = legacyConfig?.[manifest.id];
    if (!id || !old || typeof old !== 'object') continue;
    for (const field of manifest.configSchema ?? []) {
      const value = old[field.key];
      if (typeof value !== 'string' || !value) continue;
      if (field.type === 'password') {
        if (!secrets.some((s) => s.connector === id && s.field === field.key)) secrets.push({ connector: id, field: field.key, value });
      } else {
        values[id] = values[id] ?? {};
        if (values[id][field.key] === undefined) values[id][field.key] = value;
      }
    }
  }
  return { values, secrets };
}
