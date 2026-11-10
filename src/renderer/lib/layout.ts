// Workbench layout state: which shell regions are visible and where each panel
// lives. Persisted via the settings bridge (never localStorage) under the
// 'layout' key.
export type Dock = 'left' | 'right' | 'bottom';
export const DOCKS: Dock[] = ['left', 'right', 'bottom'];
export const PANEL_MIME = 'application/x-neuron-panel';
export const SIDEBAR_MIME = 'application/x-neuron-sidebar';
/** The dockable twin of the floating graph. */
export const GRAPH_PANEL_KEY = 'graph:graph.panel';
/** Window events the floating graph sends while its grip is dragged, so the
    workbench can show where it would dock. detail: { x, y } in client pixels. */
export const FLOAT_DRAG_EVENT = 'neuron:float-drag';
export const FLOAT_DROP_EVENT = 'neuron:float-drop';

/** Which dock a pointer is over: the outer bands of the workbench. The middle is none. */
export function dockBand(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, allowBottom = true): Dock | null {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  return allowBottom && fy > 0.72 ? 'bottom' : fx < 0.22 ? 'left' : fx > 0.78 ? 'right' : null;
}

export type GroupTarget = number | 'new-before' | 'new-after' | { group: number; edge: 'before' | 'after' };

export interface WorkbenchLayout {
  activityBar: boolean;
  sidebar: boolean;
  sidebarCollapsed: boolean;
  leftPanel: boolean;
  rightPanel: boolean;
  bottomPanel: boolean;
  statusBar: boolean;
  zen: boolean;
  /** Square workspace-map overlay pinned to the top-right of the editor. */
  graphOverlay: boolean;
  sidebarSide: 'left' | 'right';
  panels: Record<string, { dock: Dock; order: number; group: number }>;
  /** Selected tab per group, keyed `dock:group`. */
  activePanels: Record<string, string>;
}

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  activityBar: true,
  sidebar: true,
  sidebarCollapsed: false,
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
  activePanels: {},
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const safeKey = (key: string) => key.includes(':') && !key.split(':').some((part) =>
  !part || ['__proto__', 'constructor', 'prototype'].includes(part));

/** Merge a stored layout over the defaults, ignoring junk. */
export function resolveLayout(stored: unknown): WorkbenchLayout {
  const merged: WorkbenchLayout = { ...DEFAULT_LAYOUT, panels: {}, activePanels: {} };
  if (isObject(stored)) {
    for (const key of ['activityBar', 'sidebar', 'sidebarCollapsed', 'leftPanel', 'rightPanel', 'bottomPanel', 'statusBar', 'graphOverlay'] as const) {
      if (typeof stored[key] === 'boolean') merged[key] = stored[key];
    }
    if (stored.sidebarSide === 'left' || stored.sidebarSide === 'right') merged.sidebarSide = stored.sidebarSide;
    if (isObject(stored.activePanels)) {
      for (const [group, key] of Object.entries(stored.activePanels)) {
        if (/^(left|right|bottom):[0-7]$/.test(group) && typeof key === 'string' && safeKey(key)) merged.activePanels[group] = key;
      }
    }
    if (isObject(stored.panels)) {
      for (const [key, value] of Object.entries(stored.panels)) {
        if (safeKey(key) && isObject(value) && DOCKS.includes(value.dock as Dock)
          && typeof value.order === 'number' && Number.isFinite(value.order)
          && (value.group === undefined || (Number.isInteger(value.group) && Number(value.group) >= 0 && Number(value.group) <= 7))) {
          merged.panels[key] = { dock: value.dock as Dock, order: value.order, group: Number(value.group ?? 0) };
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

export function placePanels<T extends PlaceablePanel>(panels: T[], layout: WorkbenchLayout): Record<Dock, T[][]> {
  const result: Record<Dock, T[][]> = { left: [], right: [], bottom: [] };
  for (const panel of panels) {
    const placement = layout.panels[panelKey(panel)];
    const dock = placement?.dock ?? (panel.view.location === 'bottom' ? 'bottom' : 'right');
    const group = placement?.group ?? 0;
    (result[dock][group] ??= []).push(panel);
  }
  for (const dock of DOCKS) {
    result[dock] = result[dock].filter(Boolean);
    for (const group of result[dock]) group.sort((a, b) => (layout.panels[panelKey(a)]?.order ?? 0) - (layout.panels[panelKey(b)]?.order ?? 0));
  }
  return result;
}

export function activePanel<T extends PlaceablePanel>(group: T[], layout: WorkbenchLayout, dock: Dock, index: number): T | undefined {
  return group.find((panel) => panelKey(panel) === layout.activePanels[dock + ':' + index]) ?? group[0];
}

/** Index is within the destination group after removing the moving panel.
 * Edge targets address groups before removal, so emptying a source cannot shift the target. */
export function movePanel<T extends PlaceablePanel>(panels: T[], layout: WorkbenchLayout, key: string, dock: Dock, index?: number, group: GroupTarget = 0): WorkbenchLayout {
  const panel = panels.find((p) => panelKey(p) === key);
  if (!panel || !safeKey(key) || !DOCKS.includes(dock)) return layout;
  const placed = placePanels(panels, layout);
  const sourceDock = DOCKS.find((d) => placed[d].some((g) => g.includes(panel)))!;
  const source = placed[sourceDock].find((g) => g.includes(panel))!;
  const split = typeof group !== 'number';
  if (split && sourceDock === dock && source.length === 1) return layout;
  if (split && placed[dock].length >= 8) return layout;
  if (typeof group === 'number' && (!Number.isInteger(group) || group < 0 || group > 7 || group >= Math.max(1, placed[dock].length))) return layout;
  if (typeof group === 'object' && !placed[dock][group.group]) return layout;
  const selected = new Map<T[], string>();
  for (const d of DOCKS) placed[d].forEach((g, i) => {
    const current = activePanel(g, layout, d, i);
    if (current) selected.set(g, panelKey(current));
  });
  let target: T[];
  if (typeof group === 'number') {
    target = placed[dock][group] ?? [];
    if (!placed[dock].length) placed[dock].push(target);
  } else {
    target = [];
    const at = group === 'new-before' ? 0 : group === 'new-after' ? placed[dock].length : group.group + (group.edge === 'after' ? 1 : 0);
    placed[dock].splice(at, 0, target);
  }
  source.splice(source.indexOf(panel), 1);
  target.splice(index === undefined ? target.length : Math.max(0, Math.min(target.length, index)), 0, panel);
  selected.set(target, key);
  const next: WorkbenchLayout = { ...layout, panels: { ...layout.panels }, activePanels: {}, [dock + 'Panel']: true };
  for (const location of DOCKS) {
    placed[location] = placed[location].filter((g) => g.length);
    placed[location].forEach((g, groupIndex) => {
      const active = g.find((p) => panelKey(p) === selected.get(g)) ?? g[0];
      if (active) next.activePanels[location + ':' + groupIndex] = panelKey(active);
      g.forEach((p, order) => { next.panels[panelKey(p)] = { dock: location, order, group: groupIndex }; });
    });
    if (!placed[location].length) next[(location + 'Panel') as 'leftPanel' | 'rightPanel' | 'bottomPanel'] = false;
  }
  return next;
}

/** A named arrangement of the workbench: what is visible and where panels sit. */
export interface SavedLayout { id: string; name: string; layout: WorkbenchLayout }
export const MAX_SAVED_LAYOUTS = 20;
export const MAX_LAYOUT_NAME = 40;

/** Why a name cannot be used, in words for the person typing it, or null. */
export function layoutNameError(name: string, existing: SavedLayout[], exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name.';
  if (trimmed.length > MAX_LAYOUT_NAME) return `Keep the name to ${MAX_LAYOUT_NAME} characters.`;
  if (existing.some((l) => l.id !== exceptId && l.name.toLowerCase() === trimmed.toLowerCase())) return 'That name is already used.';
  return null;
}

/** Same structure? Zen and which tab is selected are not part of an arrangement. */
export function sameLayout(a: WorkbenchLayout, b: WorkbenchLayout): boolean {
  const shape = (l: WorkbenchLayout) => {
    const { zen: _zen, activePanels: _active, panels, ...flags } = l;
    return JSON.stringify([Object.entries(flags).sort(), Object.entries(panels).sort(([x], [y]) => x.localeCompare(y))]);
  };
  return shape(a) === shape(b);
}

export function resolveSavedLayouts(stored: unknown): SavedLayout[] {
  const result: SavedLayout[] = [];
  if (!Array.isArray(stored)) return result;
  for (const item of stored) {
    if (result.length >= MAX_SAVED_LAYOUTS) break;
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string') continue;
    if (result.some((l) => l.id === item.id) || layoutNameError(item.name, result)) continue;
    result.push({ id: item.id, name: item.name.trim(), layout: resolveLayout(item.layout) });
  }
  return result;
}

/** Starting points for a profile that has never saved a layout. Ordinary layouts once seeded. */
export const SEED_LAYOUTS: SavedLayout[] = [
  { id: 'seed-writing', name: 'Writing', layout: { ...DEFAULT_LAYOUT } },
  { id: 'seed-review', name: 'Review', layout: { ...DEFAULT_LAYOUT, rightPanel: true } },
  { id: 'seed-focus', name: 'Focus', layout: { ...DEFAULT_LAYOUT, sidebar: false, statusBar: false } },
];
