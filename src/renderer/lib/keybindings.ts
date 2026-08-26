// Configurable keyboard shortcuts. A binding is a normalized chord string like
// "mod+k" (mod = Ctrl on Windows/Linux, Cmd on macOS), "mod+shift+o", "mod+`".
import { isMac } from './platform';

export interface KeyAction {
  id: string;
  label: string;
  default: string;
}

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'palette', label: 'Open command palette', default: 'mod+k' },
  { id: 'new-note', label: 'New note or section', default: 'mod+n' },
  { id: 'new-view', label: 'New HTMX view in current folder', default: 'mod+g' },
  { id: 'open-website', label: 'Open website tab', default: 'mod+shift+o' },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', default: 'mod+b' },
  { id: 'toggle-right', label: 'Toggle side panel', default: 'mod+j' },
  { id: 'toggle-bottom', label: 'Toggle bottom panel', default: 'mod+`' },
  { id: 'toggle-zen', label: 'Toggle zen mode', default: 'alt+z' },
  { id: 'toggle-graph', label: 'Toggle workspace graph', default: 'mod+shift+g' },
];

export type Bindings = Record<string, string>;

export const DEFAULT_BINDINGS: Bindings = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.default]));

// `isMac` comes from lib/platform, which asks main. It was read from
// `navigator.platform` here, which is deprecated and which browsers freeze at a
// fixed string — a shortcut label reading Ctrl on a Mac is worse than none.

/** Build a normalized chord from a keyboard event, or null for modifier-only presses. */
export function eventToChord(e: KeyboardEvent): string | null {
  const key = e.key;
  if (['Control', 'Meta', 'Alt', 'Shift', 'Dead'].includes(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key.length === 1 ? key.toLowerCase() : key.toLowerCase());
  return parts.join('+');
}

/** Human-readable chord for display, e.g. "Ctrl+K" / "⌘K". */
export function formatChord(chord: string): string {
  return chord
    .split('+')
    .map((p) => {
      if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (p === 'shift') return isMac ? '⇧' : 'Shift';
      if (p === 'alt') return isMac ? '⌥' : 'Alt';
      if (p === '`') return '`';
      return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(isMac ? '' : '+');
}

/** Merge stored overrides over the defaults, dropping unknown action ids. */
export function resolveBindings(stored: Bindings | null | undefined): Bindings {
  const merged: Bindings = { ...DEFAULT_BINDINGS };
  if (stored) for (const a of KEY_ACTIONS) if (typeof stored[a.id] === 'string') merged[a.id] = stored[a.id];
  return merged;
}
