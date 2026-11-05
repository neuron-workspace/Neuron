import { useMemo, useState } from 'react';
import { LayoutDashboard, RotateCcw, X } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { SurfaceProps } from './index';
import { parseLayout, type LayoutChild, type LayoutGroup } from './layout';
import { getPanel, type PanelContext } from './panels';

function PanelBody({ spec, surface, onClose, label }: PanelContext & { onClose: () => void; label: string }) {
  const Renderer = getPanel(spec.type);
  if (!Renderer) {
    return <div className="grid h-full place-items-center px-4 text-center text-xs text-[var(--ink-muted)]">Unknown panel type "{spec.type}".</div>;
  }
  return (
    <div className="group/panel relative h-full min-h-0">
      <Renderer spec={spec} surface={surface} />
      {/* Revealed on hover and on keyboard focus. Always-visible chrome on every
          panel would cost more than the control is worth, but focus-visible
          keeps it reachable without a mouse.

          `opacity-0` hides it without removing it from the hit test, so while
          invisible it still swallowed every click in the top-right corner of
          the panel -- including the graph overlay's own close button, which
          parks there. Invisible means untargetable until it is revealed.
          Keyboard focus is unaffected: pointer-events only governs the mouse. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${label} panel`}
        className="tool-button interactive pointer-events-none absolute right-1.5 top-1.5 z-[var(--z-panel)] border border-[var(--divider)] bg-[var(--surface)] opacity-0 transition-opacity duration-150 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/panel:pointer-events-auto group-hover/panel:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function renderGroup(
  group: LayoutGroup,
  surface: SurfaceProps,
  key: string,
  hidden: Set<string>,
  hide: (id: string) => void,
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
        // A hidden panel is dropped from the tree rather than sized to zero, so
        // its siblings actually reclaim the space instead of butting against a
        // collapsed strip.
        .filter(({ childKey }) => !hidden.has(childKey))
        .map(({ child, childKey, i }) => (
          <Panel key={childKey} id={childKey} order={i + 1} defaultSize={child.size} minSize={8} className="min-h-0 min-w-0">
            {child.group
              ? renderGroup(child.group, surface, childKey, hidden, hide)
              : child.panel
                ? <PanelBody spec={child.panel} surface={surface} onClose={() => hide(childKey)} label={child.panel.type} />
                : null}
          </Panel>
        ))
        .flatMap((node, i) => (i === 0 ? [node] : [<PanelResizeHandle key={`h-${key}-${i}`} className={handleClass} />, node]))}
    </PanelGroup>
  );
}

export function LayoutSurface(props: SurfaceProps) {
  const group = useMemo(() => parseLayout(props.content), [props.content]);
  // Session-scoped on purpose: .neuron/layout.json is the user's own file and a
  // click on a close button should not rewrite it. Reopening the workspace
  // brings the declared layout back.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const hide = (id: string) => setHidden((prev) => new Set(prev).add(id));

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
      {renderGroup(group, props, '0', hidden, hide)}
      {/* Closing must not be one-way. Without this, hiding the terminal would
          mean editing .neuron/layout.json by hand to get it back. */}
      {hidden.size > 0 && (
        <button
          type="button"
          onClick={() => setHidden(new Set())}
          className="interactive absolute bottom-3 right-3 z-[var(--z-panel)] flex items-center gap-1.5 rounded-md border divider-color bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--ink-secondary)] shadow-lg hover:text-[var(--ink)]"
        >
          <RotateCcw className="h-3 w-3" />
          Restore {hidden.size} panel{hidden.size === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

export default LayoutSurface;
