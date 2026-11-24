export interface PanelSpec {
  type: string;
  [key: string]: unknown;
}

export interface LayoutGroup {
  direction: 'horizontal' | 'vertical';
  children: LayoutChild[];
}

export interface LayoutChild {
  size?: number;
  group?: LayoutGroup;
  panel?: PanelSpec;
}

function isGroup(value: unknown): value is LayoutGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Record<string, unknown>;
  return (group.direction === 'horizontal' || group.direction === 'vertical') && Array.isArray(group.children);
}

/**
 * Drop terminal panels, and any group left empty by that.
 *
 * The terminal is a dock panel now. A layout file written before that still
 * asks for one under the editor, which put two terminals on screen at once.
 */
function withoutTerminals(group: LayoutGroup): LayoutGroup | null {
  const children: LayoutChild[] = [];
  for (const child of group.children) {
    if (!child || typeof child !== 'object') continue;
    if (child.panel?.type === 'terminal') continue;
    if (isGroup(child.group)) {
      const inner = withoutTerminals(child.group);
      if (inner) children.push({ ...child, group: inner });
    } else children.push(child);
  }
  return children.length ? { ...group, children } : null;
}

export function parseLayout(content: string): LayoutGroup | null {
  const text = content.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isGroup(parsed) ? withoutTerminals(parsed) : null;
  } catch {
    return null;
  }
}

/** How the workspace asks the window to start: the sidebar and the terminal. */
export interface WorkspacePanels {
  sidebar?: { open?: boolean; side?: 'left' | 'right' };
  terminal?: { open?: boolean; dock?: 'left' | 'right' | 'bottom' };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function readParsed(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch {
    return { ok: false };
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const word = value.trim().toLowerCase();
  return allowed.find((candidate) => candidate === word);
}

function readSetting<T extends string>(value: unknown, positions: readonly T[]): { open?: boolean; position?: T } | undefined {
  // Short form is the state alone: "open" or "closed".
  const raw = isPlainObject(value) ? value : { state: value };
  const state = pick(raw.state, ['open', 'closed'] as const);
  const position = pick(raw.position, positions);
  if (state === undefined && position === undefined) return undefined;
  return { ...(state !== undefined && { open: state === 'open' }), ...(position !== undefined && { position }) };
}

/**
 * The `sidebar` and `terminal` keys of .neuron/layout.json. The file comes with
 * the workspace, which may be someone else's, so anything unexpected is dropped.
 */
export function parseWorkspacePanels(content: string): WorkspacePanels {
  const parsed = readParsed(content);
  if (!parsed.ok || !isPlainObject(parsed.value)) return {};
  const result: WorkspacePanels = {};
  const sidebar = readSetting(parsed.value.sidebar, ['left', 'right'] as const);
  if (sidebar) result.sidebar = { ...(sidebar.open !== undefined && { open: sidebar.open }), ...(sidebar.position && { side: sidebar.position }) };
  const terminal = readSetting(parsed.value.terminal, ['bottom', 'left', 'right'] as const);
  if (terminal) result.terminal = { ...(terminal.open !== undefined && { open: terminal.open }), ...(terminal.position && { dock: terminal.position }) };
  return result;
}

/**
 * Whether the file asks for a layout tree in the main area. A file holding only
 * the sidebar and terminal keys does not, so the window keeps its notes view.
 * Text that is not JSON still does: the layout view explains what is wrong.
 */
export function hasLayoutTree(content: string): boolean {
  const parsed = readParsed(content);
  return !parsed.ok || !isPlainObject(parsed.value) || 'children' in parsed.value;
}

/**
 * Whether the text is a layout file Neuron can use: a JSON object, and when it
 * asks for a layout tree, a tree that parses. A file changed on disk into
 * something else is not offered in place of the layout on screen.
 */
export function readableLayout(content: string): boolean {
  const parsed = readParsed(content);
  if (!parsed.ok || !isPlainObject(parsed.value)) return false;
  return !('children' in parsed.value) || parseLayout(content) !== null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Same meaning? Whitespace and key order do not count; array order does. */
export function sameJson(a: string, b: string): boolean {
  const left = readParsed(a);
  const right = readParsed(b);
  if (!left.ok || !right.ok) return !left.ok && !right.ok && a === b;
  return stableStringify(left.value) === stableStringify(right.value);
}
