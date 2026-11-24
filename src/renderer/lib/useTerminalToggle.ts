import { usePlugins } from '../plugins/host';
import { terminalShowPatch, terminalTogglePatch, terminalVisible, type WorkbenchLayout } from './layout';

/**
 * Show or hide the terminal dock, for the status bar button, the shortcut and
 * the palette. With the Terminal plugin off there is nothing to show, so the
 * way forward is the Plugins page instead.
 *
 * `show` only ever shows it, selecting its tab, for a Run button or an
 * automation about to write to it. False when there is no terminal to show.
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
  const show = (): boolean => {
    if (!enabled) return false;
    if (terminalVisible(panels, layout)) return true;
    const patch = terminalShowPatch(panels, layout);
    if (patch) onLayoutChange(patch);
    return !!patch;
  };
  return { enabled, visible, toggle, show };
}
