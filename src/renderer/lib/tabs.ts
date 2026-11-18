/**
 * The tab strip as data. At most one tab is the preview: a file opened by a
 * single click, which the next single click replaces instead of adding a tab.
 * The preview is still a member of `tabs`, so anything that walks the tabs
 * needs no special case; `preview` only names which one it is.
 */
export interface TabState {
  tabs: string[];
  preview: string | null;
  selected: string | null;
}

export const EMPTY_TABS: TabState = { tabs: [], preview: null, selected: null };

/** Open `path` and select it, as a preview unless `keep`. */
export function openTab(state: TabState, path: string, keep: boolean): TabState {
  if (state.tabs.includes(path)) {
    const preview = keep && state.preview === path ? null : state.preview;
    return { tabs: state.tabs, preview, selected: path };
  }
  if (keep) return { tabs: [...state.tabs, path], preview: state.preview, selected: path };
  if (state.preview !== null) {
    const tabs = state.tabs.map((tab) => (tab === state.preview ? path : tab));
    return { tabs, preview: path, selected: path };
  }
  return { tabs: [...state.tabs, path], preview: path, selected: path };
}

/** Make `path` an ordinary tab if it is the preview. */
export function keepTab(state: TabState, path: string): TabState {
  return state.preview === path ? { ...state, preview: null } : state;
}

/** Close `path`. Closing the selected tab selects the one that took its place, or the new last one. */
export function closeTab(state: TabState, path: string): TabState {
  const index = state.tabs.indexOf(path);
  const tabs = state.tabs.filter((tab) => tab !== path);
  const selected = state.selected !== path ? state.selected
    : tabs[Math.min(Math.max(index, 0), tabs.length - 1)] ?? null;
  return { tabs, preview: state.preview === path ? null : state.preview, selected };
}

/** Drop tabs whose files are gone. `existing` lists the paths still there, or tests one. */
export function removeMissing(state: TabState, existing: readonly string[] | ((path: string) => boolean)): TabState {
  const has = typeof existing === 'function' ? existing : (path: string) => existing.includes(path);
  const tabs = state.tabs.filter(has);
  const preview = state.preview !== null && has(state.preview) ? state.preview : null;
  const selected = state.selected !== null && has(state.selected) ? state.selected : null;
  if (tabs.length === state.tabs.length && preview === state.preview && selected === state.selected) return state;
  return { tabs, preview, selected };
}
