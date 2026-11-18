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
