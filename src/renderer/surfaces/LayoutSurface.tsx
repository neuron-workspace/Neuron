import { useMemo, type ReactNode } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { SurfaceProps } from './index';
import { parseLayout, type LayoutChild, type LayoutGroup } from './layout';
import { getPanel, type PanelContext } from './panels';

/**
 * The editor panel's two shapes. With one editor group the panel shows that
 * group: `header` is its tab strip and the panel renders the file. With more,
 * `groups` is the whole split editor, each group with its own strip.
 */
interface EditorSlot { header?: ReactNode; groups?: ReactNode }

function PanelBody({ spec, surface, label, editor }: PanelContext & { label: string; editor?: EditorSlot }) {
  const Renderer = getPanel(spec.type);
  if (!Renderer) {
    return <div className="grid h-full place-items-center px-4 text-center text-xs text-[var(--ink-muted)]">Unknown panel type "{spec.type}".</div>;
  }
  const isEditor = spec.type === 'editor';
  if (isEditor && editor?.groups) return <div className="relative h-full min-h-0">{editor.groups}</div>;
  return (
    // The single editor is the one editor group, and is marked as such.
    <div className="shell-card relative flex h-full min-h-0 flex-col" {...(isEditor ? { 'data-editor-group': 0, 'data-focused': 'true' } : {})}>
      {isEditor && editor?.header ? editor.header : <header className="flex h-7 shrink-0 items-center border-b border-[var(--divider)] bg-[var(--surface)] px-3 text-xs text-[var(--ink-secondary)]">{label[0].toUpperCase() + label.slice(1)}</header>}
      <div className="min-h-0 flex-1"><Renderer spec={spec} surface={surface} /></div>
    </div>
  );
}

function renderGroup(
  group: LayoutGroup,
  surface: SurfaceProps,
  key: string,
  editor?: EditorSlot,
) {
  const handleClass = group.direction === 'horizontal' ? 'resize-handle resize-handle-v' : 'resize-handle resize-handle-h';
  return (
    <PanelGroup
      direction={group.direction}
      autoSaveId={`neuron.config.${key}`}
      className={group.direction === 'horizontal' ? 'flex min-h-0' : 'flex min-h-0 flex-col'}
    >
      {group.children
        .map((child: LayoutChild, i) => ({ child, childKey: `${key}.${i}`, i }))
        .map(({ child, childKey, i }) => (
          <Panel key={childKey} id={childKey} order={i + 1} defaultSize={child.size} minSize={8} className="min-h-0 min-w-0">
            {child.group
              ? renderGroup(child.group, surface, childKey, editor)
              : child.panel
                ? <PanelBody editor={editor} spec={child.panel} surface={surface} label={child.panel.type} />
                : null}
          </Panel>
        ))
        .flatMap((node, i) => (i === 0 ? [node] : [<PanelResizeHandle key={`h-${key}-${i}`} className={handleClass} />, node]))}
    </PanelGroup>
  );
}

export function LayoutSurface(props: SurfaceProps & { editorHeader?: ReactNode; editorGroups?: ReactNode }) {
  const group = useMemo(() => parseLayout(props.content), [props.content]);
  if (!group) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--ink-muted)]">
        <LayoutDashboard className="h-5 w-5" />
        .neuron/layout.json is empty or invalid JSON. It should contain a layout tree.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {renderGroup(group, props, '0', { header: props.editorHeader, groups: props.editorGroups })}
    </div>
  );
}

export default LayoutSurface;
