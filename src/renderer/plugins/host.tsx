import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { HostRuntime, PanelView, PluginCommand, PluginHost, PluginManifest, PluginModule } from './types';
import {
  connectorsOf, connectorStatus as statusOf, knownWorkspaceKeys, migrateConnectorValues, resolveWorkspacePlugins, secretFields,
  workspaceKey, workspacePluginsKey,
  type Connector, type ConnectorSecrets, type ConnectorValues, type LegacyPlugins, type WorkspacePlugins,
} from './connectors';
import { platform } from '../lib/platform';

interface RegisteredPanel { pluginId: string; view: PanelView }
interface RegisteredCommand { pluginId: string; command: PluginCommand }

// Plugins are opt-in, with one exception. Version history is a recovery
// surface: a user who must discover and enable it first will do so *after*
// losing the file, the one moment it cannot help. It stays switchable off like
// any other plugin, and the journal keeps recording either way.
const DEFAULT_ENABLED = new Set(['version-history', 'graph', 'terminal']);

/** The global record from before plugins were per workspace. Read for migration, never deleted. */
const LEGACY_KEY = 'plugins';
/** The workspaces known when per-workspace plugins arrived: they start with the old global set. */
const LEGACY_WORKSPACES_KEY = 'pluginsLegacyWorkspaces';
/** Non-secret connector settings, by connector id. Secrets are in main's write-only store. */
const CONNECTORS_KEY = 'connectors';

interface AppBridge {
  activeNote: string | null;
  noteContent: string;
  notes: string[];
  notesData: { path: string; content: string }[];
  openNote: (path: string) => void;
  createNote: (relativePath: string, content?: string) => Promise<boolean>;
  refreshNotes: () => Promise<void>;
}

interface PluginContextValue {
  plugins: PluginManifest[];
  panels: RegisteredPanel[];
  commands: RegisteredCommand[];
  mdxComponents: Record<string, ComponentType<Record<string, unknown>>>;
  /** The folder whose plugins these are, or null in a window with no workspace. */
  workspace: string | null;
  isEnabled: (id: string) => boolean;
  setEnabled: (id: string, on: boolean) => void;
  /** This workspace's own options for a plugin with no connector. */
  getConfig: (id: string) => Record<string, string>;
  setConfig: (id: string, config: Record<string, string>) => void;
  connectors: Connector[];
  connectorOf: (pluginId: string) => Connector | null;
  connectorValues: (id: string) => Record<string, string>;
  /** Which secret fields are saved. The values never come back. */
  savedSecrets: (id: string) => Record<string, boolean>;
  connectorStatus: (id: string) => 'connected' | 'not-set-up';
  saveConnector: (id: string, values: Record<string, string>) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  runtimeFor: (pluginId: string) => HostRuntime;
  ready: boolean;
  /** The enabled plugins have registered their panels at least once. */
  panelsReady: boolean;
}

const PluginContext = createContext<PluginContextValue | null>(null);

export function PluginProvider({ catalog, bridge, workspace, children }: { catalog: PluginModule[]; bridge: AppBridge; workspace: string | null; children: React.ReactNode }) {
  const [state, setState] = useState<WorkspacePlugins>({ enabled: {}, config: {} });
  // Which workspace's record `state` holds, and which one the registered panels
  // were built from. The window starts with no workspace and gets one a moment
  // later (or switches to another): until both match the current workspace,
  // the panels belong to some other set, and anything that waits for them --
  // .neuron/layout.json asking for the terminal, say -- must keep waiting.
  const [loadedKey, setLoadedKey] = useState<string | null | undefined>(undefined);
  const [panelsKey, setPanelsKey] = useState<string | null | undefined>(undefined);
  const [panels, setPanels] = useState<RegisteredPanel[]>([]);
  const [commands, setCommands] = useState<RegisteredCommand[]>([]);
  const [mdxComponents, setMdxComponents] = useState<Record<string, ComponentType<Record<string, unknown>>>>({});
  const [values, setValues] = useState<ConnectorValues>({});
  const [secrets, setSecrets] = useState<ConnectorSecrets>({});

  const manifests = useMemo(() => catalog.map((p) => p.manifest), [catalog]);
  const connectors = useMemo(() => connectorsOf(manifests), [manifests]);
  const storageKey = workspace ? workspacePluginsKey(workspace, platform) : null;
  const ready = loadedKey === storageKey;
  const panelsReady = ready && panelsKey === storageKey;

  // Keep the latest app bridge in a ref so plugin runtimes always read live state.
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const stateRef = useRef(state);
  stateRef.current = state;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // This workspace's plugins, loaded on open and again whenever another window
  // on the same workspace saves them. Another workspace's key is not ours: a
  // plugin switched on over there stays off here.
  useEffect(() => {
    let cancelled = false;
    let latest = 0;
    if (!workspace || !storageKey) {
      setState({ enabled: {}, config: {} });
      setLoadedKey(null);
      return;
    }
    const api = window.electronAPI;
    const load = async (remote: boolean) => {
      const run = ++latest;
      const saved = (await api?.settings.get<WorkspacePlugins>(storageKey)) ?? null;
      let legacy: LegacyPlugins | null = null;
      let legacyWorkspaces: string[] | null = null;
      if (!saved) {
        legacy = (await api?.settings.get<LegacyPlugins>(LEGACY_KEY)) ?? null;
        if (legacy) {
          const known = await api?.settings.get<unknown>(LEGACY_WORKSPACES_KEY);
          if (Array.isArray(known)) legacyWorkspaces = known.filter((k): k is string => typeof k === 'string');
          else {
            // Taken once, the first time any workspace opens after the change.
            // A workspace created later is new, and starts with the defaults.
            legacyWorkspaces = knownWorkspaceKeys(await api?.settings.get<{ current?: string | null; recent?: string[] }>('repositories') ?? null, platform);
            await api?.settings.set(LEGACY_WORKSPACES_KEY, legacyWorkspaces);
          }
        }
      }
      if (cancelled || run !== latest) return;
      // Defaults are applied here, not in isEnabled(): activation and the
      // reactivation key both read state.enabled directly, so a default that
      // lives only in the accessor is invisible to them and the plugin never
      // starts. One source of truth, seeded once.
      const next = resolveWorkspacePlugins(saved, legacy, legacyWorkspaces, workspaceKey(workspace, platform), DEFAULT_ENABLED);
      // A value another window just saved is not saved back from here: that
      // echo could overwrite a newer change made over there.
      if (!saved && !remote) void api?.settings.set(storageKey, next);
      setState(next);
      setLoadedKey(storageKey);
    };
    void load(false);
    const unsubscribe = api?.settings.onChanged?.((key) => { if (key === storageKey) void load(true); });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [workspace, storageKey]);

  const loadSecretFlags = useCallback(async () => {
    const api = window.electronAPI;
    const flags: ConnectorSecrets = {};
    for (const connector of connectors) {
      flags[connector.id] = {};
      for (const field of secretFields(connector.fields)) {
        flags[connector.id][field.key] = Boolean(await api?.settings.hasSecret(connector.id, field.key));
      }
    }
    return flags;
  }, [connectors]);

  // Connector settings are global. The first load after the change copies them
  // from the old per-plugin config; any later save broadcasts the key, which is
  // also how a secret saved in Settings shows up as connected in every window.
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;
    if (!api) return;
    const load = async (remote: boolean) => {
      let stored = await api.settings.get<ConnectorValues>(CONNECTORS_KEY);
      if (stored == null && !remote) {
        const legacy = await api.settings.get<LegacyPlugins>(LEGACY_KEY);
        const migrated = migrateConnectorValues(legacy?.config, manifests);
        for (const secret of migrated.secrets) await api.settings.setSecret(secret.connector, secret.field, secret.value);
        // A key still sitting in that readable record is readable by any
        // renderer code. It is in the secret store now, so it leaves here.
        if (migrated.secrets.length > 0 && legacy?.config) {
          const config: Record<string, Record<string, string>> = {};
          for (const [id, old] of Object.entries(legacy.config)) {
            const secretKeys = (manifests.find((m) => m.id === id)?.configSchema ?? []).filter((f) => f.type === 'password').map((f) => f.key);
            config[id] = Object.fromEntries(Object.entries(old ?? {}).filter(([key]) => !secretKeys.includes(key)));
          }
          await api.settings.set(LEGACY_KEY, { ...legacy, config });
        }
        stored = migrated.values;
        await api.settings.set(CONNECTORS_KEY, stored);
      }
      const flags = await loadSecretFlags();
      if (cancelled) return;
      setValues(stored && typeof stored === 'object' ? stored : {});
      setSecrets(flags);
    };
    void load(false);
    const unsubscribe = api.settings.onChanged?.((key) => { if (key === CONNECTORS_KEY) void load(true); });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [manifests, loadSecretFlags]);

  const persist = useCallback((next: WorkspacePlugins) => {
    if (!storageKey) return;
    setState(next);
    void window.electronAPI?.settings.set(storageKey, next);
  }, [storageKey]);

  const setEnabled = useCallback(
    (id: string, on: boolean) => persist({ ...stateRef.current, enabled: { ...stateRef.current.enabled, [id]: on } }),
    [persist],
  );
  // Per-workspace options are plain settings. A password field never belongs
  // here: secrets are connector settings and go to main's write-only store.
  const setConfig = useCallback(
    (id: string, config: Record<string, string>) => {
      const secretKeys = (manifests.find((m) => m.id === id)?.configSchema ?? []).filter((f) => f.type === 'password').map((f) => f.key);
      const safe = Object.fromEntries(Object.entries(config).filter(([key]) => !secretKeys.includes(key)));
      persist({ ...stateRef.current, config: { ...stateRef.current.config, [id]: safe } });
    },
    [persist, manifests],
  );
  const getConfig = useCallback((id: string) => state.config[id] ?? {}, [state.config]);
  const isEnabled = useCallback((id: string) => state.enabled[id] ?? false, [state.enabled]);

  const connectorOf = useCallback(
    (pluginId: string) => {
      const id = manifests.find((m) => m.id === pluginId)?.connector?.id;
      return connectors.find((c) => c.id === id) ?? null;
    },
    [manifests, connectors],
  );
  const connectorValues = useCallback((id: string) => values[id] ?? {}, [values]);
  const savedSecrets = useCallback((id: string) => secrets[id] ?? {}, [secrets]);
  const connectorStatus = useCallback(
    (id: string) => statusOf(connectors.find((c) => c.id === id)?.fields ?? [], values[id], secrets[id]),
    [connectors, values, secrets],
  );

  const saveConnector = useCallback(async (id: string, input: Record<string, string>) => {
    const connector = connectors.find((c) => c.id === id);
    const api = window.electronAPI;
    if (!connector || !api) return;
    const plain: Record<string, string> = {};
    for (const field of connector.fields) {
      const value = input[field.key] ?? '';
      // An empty secret field means "keep what is saved": it is never shown,
      // so leaving it empty cannot be a request to clear it.
      if (field.type === 'password') { if (value) await api.settings.setSecret(id, field.key, value); }
      else if (value.trim()) plain[field.key] = value.trim();
    }
    const next = { ...valuesRef.current, [id]: plain };
    setValues(next);
    await api.settings.set(CONNECTORS_KEY, next);
    setSecrets(await loadSecretFlags());
  }, [connectors, loadSecretFlags]);

  const disconnect = useCallback(async (id: string) => {
    const connector = connectors.find((c) => c.id === id);
    const api = window.electronAPI;
    if (!connector || !api) return;
    for (const field of secretFields(connector.fields)) await api.settings.setSecret(id, field.key, '');
    const next = { ...valuesRef.current };
    delete next[id];
    setValues(next);
    await api.settings.set(CONNECTORS_KEY, next);
    setSecrets(await loadSecretFlags());
  }, [connectors, loadSecretFlags]);

  const runtimeFor = useCallback((pluginId: string): HostRuntime => {
    const b = bridgeRef.current;
    const manifest = manifests.find((m) => m.id === pluginId);
    const name = manifest?.name ?? pluginId;
    const connectorId = manifest?.connector?.id;
    const api = window.electronAPI;
    // Checked at call time: a panel rendered while the plugin was on keeps its
    // runtime after the plugin is switched off in this workspace.
    const refusal = () => (stateRef.current.enabled[pluginId] ? null : `${name} is not enabled in this workspace. Turn it on in Workspace settings.`);
    return {
      activeNote: b.activeNote,
      noteContent: b.noteContent,
      notes: b.notes,
      notesData: b.notesData,
      openNote: b.openNote,
      createNote: b.createNote,
      refreshNotes: b.refreshNotes,
      config: { ...(connectorId ? valuesRef.current[connectorId] : {}), ...stateRef.current.config[pluginId] },
      ai: {
        complete: async (request) => {
          const refused = refusal();
          if (refused) return { success: false, error: refused };
          // A plugin reaches only the connector it declares, never another one
          // that happens to be set up.
          if (!connectorId || request.provider !== connectorId) return { success: false, error: `${name} does not use ${request.provider}.` };
          return api.ai.complete(request);
        },
      },
      net: {
        request: async (request) => {
          const refused = refusal();
          return refused ? { success: false, error: refused } : api.net.request(request);
        },
      },
      terminal: api.terminal,
      storage: {
        get: <T,>(key: string) => api.settings.get<T>(`pluginstore:${pluginId}:${key}`),
        set: async (key: string, value: unknown) => {
          await api.settings.set(`pluginstore:${pluginId}:${key}`, value);
        },
      },
    };
  }, [manifests]);

  // (Re)activate enabled plugins when the enabled set changes. We intentionally
  // depend only on which plugins are enabled — not on note state — so panels
  // stay mounted while the user edits.
  const enabledKey = catalog
    .filter((p) => state.enabled[p.manifest.id])
    .map((p) => p.manifest.id)
    .join(',');

  useEffect(() => {
    if (!ready) return;
    const nextPanels: RegisteredPanel[] = [];
    const nextCommands: RegisteredCommand[] = [];
    const nextMdx: Record<string, ComponentType<Record<string, unknown>>> = {};
    const cleanups: Array<() => void> = [];

    for (const plugin of catalog) {
      if (!state.enabled[plugin.manifest.id]) continue;
      const host: PluginHost = {
        manifest: plugin.manifest,
        registerPanel: (view) => nextPanels.push({ pluginId: plugin.manifest.id, view }),
        registerCommand: (command) => nextCommands.push({ pluginId: plugin.manifest.id, command }),
        registerMdxComponent: (name, component) => {
          nextMdx[name] = component;
        },
      };
      try {
        const cleanup = plugin.activate(host);
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      } catch (err) {
        console.error(`Plugin "${plugin.manifest.id}" failed to activate:`, err);
      }
    }

    setPanels(nextPanels);
    setPanelsKey(loadedKey);
    setCommands(nextCommands);
    setMdxComponents(nextMdx);

    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, ready, loadedKey]);

  const value = useMemo<PluginContextValue>(
    () => ({
      plugins: manifests,
      panels,
      commands,
      mdxComponents,
      workspace,
      isEnabled,
      setEnabled,
      getConfig,
      setConfig,
      connectors,
      connectorOf,
      connectorValues,
      savedSecrets,
      connectorStatus,
      saveConnector,
      disconnect,
      runtimeFor,
      ready,
      panelsReady,
    }),
    [manifests, panels, commands, mdxComponents, workspace, isEnabled, setEnabled, getConfig, setConfig, connectors, connectorOf,
      connectorValues, savedSecrets, connectorStatus, saveConnector, disconnect, runtimeFor, ready, panelsReady],
  );

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
}

export function usePlugins(): PluginContextValue {
  const ctx = useContext(PluginContext);
  if (!ctx) throw new Error('usePlugins must be used within a PluginProvider');
  return ctx;
}
