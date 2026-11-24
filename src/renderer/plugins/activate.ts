import type { ComponentType } from 'react';
import type { PanelView, PluginCommand, PluginHost, PluginModule } from './types';

export interface RegisteredPanel { pluginId: string; view: PanelView }
export interface RegisteredCommand { pluginId: string; command: PluginCommand }

export interface Activated {
  panels: RegisteredPanel[];
  commands: RegisteredCommand[];
  mdxComponents: Record<string, ComponentType<Record<string, unknown>>>;
  cleanups: Array<() => void>;
}

/**
 * Start the plugins switched on in this workspace and collect what they
 * register. A plugin that is off is never activated, so its panels and
 * commands (the palette's "Plugin commands") do not exist here, whatever
 * another workspace has on. A plugin that throws is skipped, not fatal.
 */
export function activatePlugins(catalog: readonly PluginModule[], enabled: Readonly<Record<string, boolean>>): Activated {
  const result: Activated = { panels: [], commands: [], mdxComponents: {}, cleanups: [] };
  for (const plugin of catalog) {
    if (!enabled[plugin.manifest.id]) continue;
    const host: PluginHost = {
      manifest: plugin.manifest,
      registerPanel: (view) => result.panels.push({ pluginId: plugin.manifest.id, view }),
      registerCommand: (command) => result.commands.push({ pluginId: plugin.manifest.id, command }),
      registerMdxComponent: (name, component) => { result.mdxComponents[name] = component; },
    };
    try {
      const cleanup = plugin.activate(host);
      if (typeof cleanup === 'function') result.cleanups.push(cleanup);
    } catch (err) {
      console.error(`Plugin "${plugin.manifest.id}" failed to activate:`, err);
    }
  }
  return result;
}
