// Workbench layout state: which shell regions are visible and where each panel
// lives. Persisted via the settings bridge (never localStorage) under the
// 'layout' key.
export type Dock = 'left' | 'right' | 'bottom';
export const DOCKS: Dock[] = ['left', 'right', 'bottom'];
export const PANEL_MIME = 'application/x-neuron-panel';
export const SIDEBAR_MIME = 'application/x-neuron-sidebar';

export interface WorkbenchLayout {
  activityBar: boolean;
  sidebar: boolean;
  leftPanel: boolean;
  rightPanel: boolean;
  bottomPanel: boolean;
  statusBar: boolean;
  zen: boolean;
  /** Square workspace-map overlay pinned to the top-right of the editor. */
  graphOverlay: boolean;
  sidebarSide: 'left' | 'right';
  panels: Record<string, { dock: Dock; order: number }>;
}

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  activityBar: true,
  sidebar: true,
  leftPanel: false,
  rightPanel: false,
  bottomPanel: false,
  statusBar: true,
  zen: false,
  // Off until asked for: floating over the top-right of the editor, it covered
  // content and controls there (a save error's Retry button, the callout Edit
  // button). The toolbar toggle and Ctrl+Shift+G bring it up.
  graphOverlay: false,
  sidebarSide: 'left',
  panels: {},
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const safeKey = (key: string) => key.includes(':') && !key.split(':').some((part) =>
  !part || ['__proto__', 'constructor', 'prototype'].includes(part));

/** Merge a stored layout over the defaults, ignoring junk. */
export function resolveLayout(stored: unknown): WorkbenchLayout {
  const merged: WorkbenchLayout = { ...DEFAULT_LAYOUT, panels: {} };
  if (isObject(stored)) {
    for (const key of ['activityBar', 'sidebar', 'leftPanel', 'rightPanel', 'bottomPanel', 'statusBar', 'graphOverlay'] as const) {
      if (typeof stored[key] === 'boolean') merged[key] = stored[key];
    }
    if (stored.sidebarSide === 'left' || stored.sidebarSide === 'right') merged.sidebarSide = stored.sidebarSide;
    if (isObject(stored.panels)) {
      for (const [key, value] of Object.entries(stored.panels)) {
        if (safeKey(key) && isObject(value) && DOCKS.includes(value.dock as Dock)
          && typeof value.order === 'number' && Number.isFinite(value.order)) {
          merged.panels[key] = { dock: value.dock as Dock, order: value.order };
        }
      }
    }
  }
  // Zen is transient: never restore a session into focus mode.
  merged.zen = false;
  return merged;
}

interface PlaceablePanel { pluginId: string; view: { id: string; location?: 'side' | 'bottom' } }
export const panelKey = (panel: PlaceablePanel) => `${panel.pluginId}:${panel.view.id}`;

export function placePanels<T extends PlaceablePanel>(panels: T[], layout: WorkbenchLayout): Record<Dock, T[]> {
  const result: Record<Dock, T[]> = { left: [], right: [], bottom: [] };
  for (const panel of panels) {
    const placement = layout.panels[panelKey(panel)];
    result[placement?.dock ?? (panel.view.location === 'bottom' ? 'bottom' : 'right')].push(panel);
  }
  for (const dock of DOCKS) {
    result[dock].sort((a, b) => (layout.panels[panelKey(a)]?.order ?? 0) - (layout.panels[panelKey(b)]?.order ?? 0));
  }
  return result;
}

/** Index is in the destination list after removing the moving panel. */
export function movePanel<T extends PlaceablePanel>(panels: T[], layout: WorkbenchLayout, key: string, dock: Dock, index?: number): WorkbenchLayout {
  const panel = panels.find((p) => panelKey(p) === key);
  if (!panel || !safeKey(key) || !DOCKS.includes(dock)) return layout;
  const placed = placePanels(panels, layout);
  for (const location of DOCKS) placed[location] = placed[location].filter((p) => panelKey(p) !== key);
  const target = placed[dock];
  target.splice(index === undefined ? target.length : Math.max(0, Math.min(target.length, index)), 0, panel);
  const next = { ...layout, panels: { ...layout.panels }, [`${dock}Panel`]: true };
  for (const location of DOCKS) placed[location].forEach((p, order) => {
    next.panels[panelKey(p)] = { dock: location, order };
  });
  return next;
}
