import { usePlugins } from '../plugins/host';
import { terminalTogglePatch, terminalVisible, type WorkbenchLayout } from './layout';

/**
 * Show or hide the terminal dock, for the status bar button, the shortcut and
 * the palette. With the Terminal plugin off there is nothing to show, so the
 * way forward is the Plugins page instead.
 */
export function useTerminalToggle(layout: WorkbenchLayout, onLayoutChange: (patch: Partial<WorkbenchLayout>) => void, onOpenPlugins: () => void) {
  const { panels, isEnabled } = usePlugins();
  const enabled = isEnabled('terminal');
  const visible = enabled && terminalVisible(panels, layout);
  const toggle = () => {
    if (!enabled) { onOpenPlugins(); return; }
    const patch = terminalTogglePatch(panels, layout);
    if (patch) onLayoutChange(patch);
  };
  return { enabled, visible, toggle };
}
