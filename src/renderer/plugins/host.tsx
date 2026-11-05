import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { HostRuntime, PanelView, PluginCommand, PluginHost, PluginManifest, PluginModule } from './types';

interface RegisteredPanel { pluginId: string; view: PanelView }
interface RegisteredCommand { pluginId: string; command: PluginCommand }

// Plugins are opt-in, with one exception. Version history is a recovery
// surface: a user who must discover and enable it first will do so *after*
// losing the file, the one moment it cannot help. It stays switchable off like
// any other plugin, and the journal keeps recording either way.
const DEFAULT_ENABLED = new Set(['version-history']);

/** Secret fields are the ones the manifest declares as passwords. */
function secretFieldsOf(catalog: PluginModule[], id: string): string[] {
  const manifest = catalog.find((p) => p.manifest.id === id)?.manifest;
  return (manifest?.configSchema ?? []).filter((f) => f.type === 'password').map((f) => f.key);
}

interface PluginState {
  enabled: Record<string, boolean>;
  config: Record<string, Record<string, string>>;
}

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
  isEnabled: (id: string) => boolean;
  setEnabled: (id: string, on: boolean) => void;
  getConfig: (id: string) => Record<string, string>;
  setConfig: (id: string, config: Record<string, string>) => void;
  runtimeFor: (pluginId: string) => HostRuntime;
  ready: boolean;
}

const PluginContext = createContext<PluginContextValue | null>(null);

const SETTINGS_KEY = 'plugins';

export function PluginProvider({ catalog, bridge, children }: { catalog: PluginModule[]; bridge: AppBridge; children: React.ReactNode }) {
  const [state, setState] = useState<PluginState>({ enabled: {}, config: {} });
  const [ready, setReady] = useState(false);
  const [panels, setPanels] = useState<RegisteredPanel[]>([]);
  const [commands, setCommands] = useState<RegisteredCommand[]>([]);
  const [mdxComponents, setMdxComponents] = useState<Record<string, ComponentType<Record<string, unknown>>>>({});

  // Keep the latest app bridge in a ref so plugin runtimes always read live state.
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const configRef = useRef(state.config);
  configRef.current = state.config;

  // Load persisted enabled-state + config once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = (await window.electronAPI?.settings.get<PluginState>(SETTINGS_KEY)) ?? null;
      if (cancelled) return;
      // Defaults are applied here, not in isEnabled(): activation and the
      // reactivation key both read state.enabled directly, so a default that
      // lives only in the accessor is invisible to them and the plugin never
      // starts. One source of truth, seeded once.
      const enabled = { ...saved?.enabled };
      for (const id of DEFAULT_ENABLED) if (enabled[id] === undefined) enabled[id] = true;

      // Migrate secrets already stored in the readable config. Blocking reads
      // without moving these would leave every existing key exactly as exposed
      // as before -- still sitting in a settings value any renderer code can
      // fetch. Move first, then strip, then persist.
      const config: Record<string, Record<string, string>> = {};
      let moved = false;
      for (const [id, values] of Object.entries(saved?.config ?? {})) {
        const secretKeys = secretFieldsOf(catalog, id);
        const safe: Record<string, string> = {};
        for (const [key, value] of Object.entries(values ?? {})) {
          if (secretKeys.includes(key) && value) {
            await window.electronAPI?.settings.setSecret(id, key, value);
            moved = true;
          } else safe[key] = value;
        }
        config[id] = safe;
      }
      if (cancelled) return;
      if (moved) void window.electronAPI?.settings.set(SETTINGS_KEY, { enabled, config });
      setState({ enabled, config });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: PluginState) => {
    setState(next);
    window.electronAPI?.settings.set(SETTINGS_KEY, next);
  }, []);

  const setEnabled = useCallback(
    (id: string, on: boolean) => persist({ ...state, enabled: { ...state.enabled, [id]: on } }),
    [persist, state],
  );
  // Secrets never enter the persisted config blob. settings.get is readable by
  // any renderer code, so a key stored there is a key every plugin can read --
  // and plugins are not sandboxed (risk R3). Password fields go to the
  // main-process store instead, which has no getter.
  const setConfig = useCallback(
    (id: string, config: Record<string, string>) => {
      const secretKeys = secretFieldsOf(catalog, id);
      const safe: Record<string, string> = {};
      for (const [key, value] of Object.entries(config)) {
        if (secretKeys.includes(key)) void window.electronAPI?.settings.setSecret(id, key, value);
        else safe[key] = value;
      }
      persist({ ...state, config: { ...state.config, [id]: safe } });
    },
    [persist, state, catalog],
  );
  const getConfig = useCallback((id: string) => state.config[id] ?? {}, [state.config]);
  const isEnabled = useCallback((id: string) => state.enabled[id] ?? false, [state.enabled]);

  const runtimeFor = useCallback((pluginId: string): HostRuntime => {
    const b = bridgeRef.current;
    return {
      activeNote: b.activeNote,
      noteContent: b.noteContent,
      notes: b.notes,
      notesData: b.notesData,
      openNote: b.openNote,
      createNote: b.createNote,
      refreshNotes: b.refreshNotes,
      config: configRef.current[pluginId] ?? {},
      ai: window.electronAPI.ai,
      net: window.electronAPI.net,
      terminal: window.electronAPI.terminal,
      storage: {
        get: <T,>(key: string) => window.electronAPI.settings.get<T>(`pluginstore:${pluginId}:${key}`),
        set: async (key: string, value: unknown) => {
          await window.electronAPI.settings.set(`pluginstore:${pluginId}:${key}`, value);
        },
      },
    };
  }, []);

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
    setCommands(nextCommands);
    setMdxComponents(nextMdx);

    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, ready]);

  const value = useMemo<PluginContextValue>(
    () => ({
      plugins: catalog.map((p) => p.manifest),
      panels,
      commands,
      mdxComponents,
      isEnabled,
      setEnabled,
      getConfig,
      setConfig,
      runtimeFor,
      ready,
    }),
    [catalog, panels, commands, mdxComponents, isEnabled, setEnabled, getConfig, setConfig, runtimeFor, ready],
  );

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
}

export function usePlugins(): PluginContextValue {
  const ctx = useContext(PluginContext);
  if (!ctx) throw new Error('usePlugins must be used within a PluginProvider');
  return ctx;
}
