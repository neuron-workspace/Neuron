import type { ReactNode, ComponentType } from 'react';
import type { AiCompleteRequest, AiCompleteResult, NetRequestResult } from '../electron.d';

export type PluginCategory = 'ai' | 'integration' | 'editor' | 'view';

export interface PluginConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  category: PluginCategory;
  /** Fields the marketplace renders into a config form (e.g. API key, endpoint). */
  configSchema?: PluginConfigField[];
}

/** Workspace HTML app discovered under plugins/<folder>/; never activated in the built-in host. */
export interface SandboxedPluginDescriptor {
  name: string;
  version: string;
  description: string;
  entry: string;
  manifestPath: string;
  permissions: string[];
}

/** Live, per-render context handed to a plugin's panel and command callbacks. */
export interface HostRuntime {
  activeNote: string | null;
  noteContent: string;
  notes: string[];
  openNote: (path: string) => void;
  createNote: (relativePath: string, content?: string) => Promise<boolean>;
  refreshNotes: () => Promise<void>;
  config: Record<string, string>;
  ai: Window['electronAPI']['ai'];
  net: Window['electronAPI']['net'];
  terminal: Window['electronAPI']['terminal'];
  /** Namespaced persistent storage for this plugin. */
  storage: {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
  };
}

export interface PanelView {
  id: string;
  title: string;
  icon?: ComponentType<{ className?: string }>;
  /** Dock where this panel opens. Existing plugins default to the side peek. */
  location?: 'side' | 'bottom';
  render: (host: HostRuntime) => ReactNode;
}

export interface PluginCommand {
  id: string;
  title: string;
  run: (host: HostRuntime) => void;
}

/** Registration surface handed to a plugin once, at activation. */
export interface PluginHost {
  manifest: PluginManifest;
  registerPanel: (view: PanelView) => void;
  registerCommand: (command: PluginCommand) => void;
  registerMdxComponent: (name: string, component: ComponentType<Record<string, unknown>>) => void;
}

export interface PluginModule {
  manifest: PluginManifest;
  /** Called when the plugin is enabled. Optionally returns a cleanup function. */
  activate: (host: PluginHost) => void | (() => void);
}

export type { AiCompleteRequest, AiCompleteResult, NetRequestResult };
