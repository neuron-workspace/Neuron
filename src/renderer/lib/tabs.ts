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

/**
 * The editor area as data: one to four groups, each a tab strip of its own,
 * laid out in a single direction (side by side, or stacked). `focused` is the
 * group that opening a file goes to.
 */
export type SplitDirection = 'row' | 'column';
export interface GroupsState {
  groups: TabState[];
  direction: SplitDirection;
  focused: number;
}

export const MAX_GROUPS = 4;
export const EMPTY_GROUPS: GroupsState = { groups: [EMPTY_TABS], direction: 'row', focused: 0 };

/** Replace group `index` with what `change` makes of it. */
export function mapGroup(state: GroupsState, index: number, change: (group: TabState) => TabState): GroupsState {
  const group = state.groups[index];
  if (!group) return state;
  const next = change(group);
  if (next === group) return state;
  return { ...state, groups: state.groups.map((g, i) => (i === index ? next : g)) };
}

export function focusGroup(state: GroupsState, index: number): GroupsState {
  return index === state.focused || !state.groups[index] ? state : { ...state, focused: index };
}

/** Open `path` in group `index` (the focused one by default) and focus that group. */
export function openInGroup(state: GroupsState, path: string, keep: boolean, index = state.focused): GroupsState {
  if (!state.groups[index]) return state;
  return focusGroup(mapGroup(state, index, (group) => openTab(group, path, keep)), index);
}

/** Make `path` an ordinary tab in every group where it is the preview. */
export function keepEverywhere(state: GroupsState, path: string): GroupsState {
  if (!state.groups.some((group) => group.preview === path)) return state;
  return { ...state, groups: state.groups.map((group) => keepTab(group, path)) };
}

/** Close group `index` and its tabs. The neighbour before it (or after, for the first) takes focus. The last group only empties. */
export function closeGroup(state: GroupsState, index: number): GroupsState {
  if (!state.groups[index]) return state;
  if (state.groups.length === 1) return { ...state, groups: [EMPTY_TABS], focused: 0 };
  const groups = state.groups.filter((_, i) => i !== index);
  const focused = index < state.focused ? state.focused - 1 : index === state.focused ? Math.max(0, index - 1) : state.focused;
  return { ...state, groups, focused };
}

/** Close a tab in group `index`. A group left with no tabs closes, unless it is the only one. */
export function closeInGroup(state: GroupsState, index: number, path: string): GroupsState {
  const next = mapGroup(state, index, (group) => closeTab(group, path));
  return next.groups.length > 1 && next.groups[index] && !next.groups[index].tabs.length ? closeGroup(next, index) : next;
}

/**
 * Whether another group can open in `direction`. Four at most, and the split
 * stays a single direction: a row of groups cannot also gain one below.
 */
export function canSplit(state: GroupsState, direction: SplitDirection): boolean {
  return state.groups.length < MAX_GROUPS && (state.groups.length === 1 || state.direction === direction);
}

/** Why a split in `direction` is not possible, in words for a menu; null when it is. */
export function splitBlocked(state: GroupsState, direction: SplitDirection): string | null {
  if (state.groups.length >= MAX_GROUPS) return `The editor holds at most ${MAX_GROUPS} groups.`;
  if (!canSplit(state, direction)) return state.direction === 'row' ? 'Groups are side by side; the split stays in one direction.' : 'Groups are stacked; the split stays in one direction.';
  return null;
}

/**
 * A new group at the end holding `path`, focused. A copy by default: group
 * `from` keeps its tab. With `move`, the tab leaves `from`, which closes if
 * that empties it.
 */
export function splitGroup(state: GroupsState, from: number, path: string, direction: SplitDirection, move = false): GroupsState {
  if (!canSplit(state, direction) || !state.groups[from]) return state;
  const groups = [...state.groups, { tabs: [path], preview: null, selected: path }];
  const split: GroupsState = { groups, direction, focused: groups.length - 1 };
  if (!move || !state.groups[from].tabs.includes(path)) return split;
  return closeInGroup(split, from, path);
}

/**
 * Move `path` from group `from` to group `to`, before the tab `before` (at the
 * end when null). Within one group this reorders. The tab arrives kept and
 * selected, `to` takes focus, and a group the move empties closes.
 */
export function moveTab(state: GroupsState, from: number, to: number, path: string, before: string | null = null): GroupsState {
  const source = state.groups[from];
  const target = state.groups[to];
  if (!source || !target || before === path) return state;
  const place = (group: TabState): TabState => {
    const tabs = group.tabs.filter((tab) => tab !== path);
    const at = before === null ? tabs.length : tabs.indexOf(before);
    tabs.splice(at < 0 ? tabs.length : at, 0, path);
    return { tabs, preview: group.preview === path ? null : group.preview, selected: path };
  };
  const placed = focusGroup(mapGroup(state, to, place), to);
  return from === to ? placed : closeInGroup(placed, from, path);
}

/** Drop tabs whose files are gone, from every group. A group left empty closes, unless none would remain. */
export function removeMissingAll(state: GroupsState, existing: readonly string[] | ((path: string) => boolean)): GroupsState {
  const pruned = state.groups.map((group) => removeMissing(group, existing));
  if (pruned.every((group, i) => group === state.groups[i])) return state;
  return dropEmptyGroups({ ...state, groups: pruned });
}

/** Close the preview tab of every group, as a workspace switch does. */
export function dropPreviews(state: GroupsState): GroupsState {
  if (state.groups.every((group) => group.preview === null)) return state;
  return dropEmptyGroups({ ...state, groups: state.groups.map((group) => (group.preview === null ? group : closeTab(group, group.preview))) });
}

function dropEmptyGroups(state: GroupsState): GroupsState {
  let next = state;
  for (let i = next.groups.length - 1; i >= 0 && next.groups.length > 1; i--) {
    if (!next.groups[i].tabs.length) next = closeGroup(next, i);
  }
  return next;
}

/** What is remembered of the arrangement: kept file tabs, the direction, sizes and focus. */
export interface StoredGroups {
  groups: { tabs: string[]; selected: string | null }[];
  direction: SplitDirection;
  focused: number;
  sizes?: number[];
}

const isWebsite = (path: string) => /^https?:\/\//.test(path);

/** The arrangement to store. Previews and website tabs are not kept. */
export function serializeGroups(state: GroupsState, sizes?: readonly number[]): StoredGroups {
  return {
    groups: state.groups.map((group) => {
      const tabs = group.tabs.filter((tab) => tab !== group.preview && !isWebsite(tab));
      return { tabs, selected: group.selected !== null && tabs.includes(group.selected) ? group.selected : null };
    }),
    direction: state.direction,
    focused: state.focused,
    ...(sizes && sizes.length === state.groups.length ? { sizes: [...sizes] } : {}),
  };
}

/**
 * A stored arrangement read back, or null when nothing usable is left. Every
 * part is checked: tabs must be files that still `exist`, never websites; a
 * group with none left is dropped; sizes survive only if every group did.
 */
export function restoreGroups(stored: unknown, exists: (path: string) => boolean): { state: GroupsState; sizes: number[] | null } | null {
  if (!stored || typeof stored !== 'object') return null;
  const value = stored as Partial<Record<keyof StoredGroups, unknown>>;
  if (!Array.isArray(value.groups)) return null;
  const all = value.groups.slice(0, MAX_GROUPS);
  const groups: TabState[] = [];
  let focused = 0;
  all.forEach((raw, i) => {
    const entry = raw && typeof raw === 'object' ? raw as { tabs?: unknown; selected?: unknown } : {};
    const tabs = Array.isArray(entry.tabs)
      ? [...new Set(entry.tabs.filter((tab): tab is string => typeof tab === 'string' && !!tab && !isWebsite(tab) && exists(tab)))]
      : [];
    if (!tabs.length) return;
    if (i === value.focused) focused = groups.length;
    else if (typeof value.focused === 'number' && i < value.focused) focused = groups.length;
    const selected = typeof entry.selected === 'string' && tabs.includes(entry.selected) ? entry.selected : tabs[tabs.length - 1];
    groups.push({ tabs, preview: null, selected });
  });
  if (!groups.length) return null;
  const direction: SplitDirection = value.direction === 'column' ? 'column' : 'row';
  const rawSizes = value.sizes;
  const sizes = groups.length === all.length && Array.isArray(rawSizes) && rawSizes.length === groups.length
    && rawSizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)
    && Math.abs((rawSizes as number[]).reduce((sum, size) => sum + size, 0) - 100) < 1
    ? rawSizes as number[] : null;
  return { state: { groups, direction, focused }, sizes };
}
