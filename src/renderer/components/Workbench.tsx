import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { usePlugins } from '../plugins/host';
import { FLOAT_DRAG_EVENT, FLOAT_DROP_EVENT, GRAPH_PANEL_KEY, PANEL_MIME, SIDEBAR_MIME, activePanel, dockBand, movePanel, panelKey, placePanels, type Dock, type GroupTarget, type WorkbenchLayout } from '../lib/layout';
import PanelDock from './RightPanel';

export default function Workbench({ layout, onLayoutChange, onOpenMarketplace, sidebar, children }: {
  layout: WorkbenchLayout;
  onLayoutChange: (patch: Partial<WorkbenchLayout>) => void;
  onOpenMarketplace: () => void;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const { panels } = usePlugins();
  const placed = placePanels(panels, layout);
  const sizes = useRef<Record<string, number>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<'panel' | 'sidebar' | 'float' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ panels, layout, onLayoutChange });
  latest.current = { panels, layout, onLayoutChange };
  const [hover, setHover] = useState<Dock | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const clearDrag = () => { setDrag(null); setHover(null); setDragKey(null); };

  useEffect(() => {
    const clear = () => { setDrag(null); setHover(null); setDragKey(null); };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // The floating graph is not an HTML drag, so it reports its pointer here. Over
  // a dock band it shows the same slot a panel would, and dropping there docks it.
  useEffect(() => {
    const band = (event: Event): Dock | null => {
      const root = rootRef.current;
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (!root || !latest.current.panels.some((p) => panelKey(p) === GRAPH_PANEL_KEY)) return null;
      return dockBand(root.getBoundingClientRect(), x, y);
    };
    const onDrag = (event: Event) => { setDrag('float'); setHover(band(event)); };
    const onDrop = (event: Event) => {
      const target = band(event);
      setDrag(null); setHover(null);
      if (!target) return;
      const next = movePanel(latest.current.panels, latest.current.layout, GRAPH_PANEL_KEY, target);
      latest.current.onLayoutChange({ ...next, [target + 'Panel']: true, graphOverlay: false });
      setFocusId(GRAPH_PANEL_KEY);
    };
    window.addEventListener(FLOAT_DRAG_EVENT, onDrag);
    window.addEventListener(FLOAT_DROP_EVENT, onDrop);
    return () => { window.removeEventListener(FLOAT_DRAG_EVENT, onDrag); window.removeEventListener(FLOAT_DROP_EVENT, onDrop); };
  }, []);

  const move = (key: string, dock: Dock, index?: number, group?: GroupTarget) => {
    const next = movePanel(panels, layout, key, dock, index, group);
    if (next !== layout) {
      onLayoutChange(next);
      setFocusId(key);
    }
    clearDrag();
  };
  const detectDrag = (event: DragEvent) => {
    const types = event.dataTransfer.types;
    setDrag(types.includes(PANEL_MIME) ? 'panel' : types.includes(SIDEBAR_MIME) ? 'sidebar' : null);
  };
  const groupView = (dock: Dock, group: number, count: number) => {
    const members = placed[dock][group] ?? [];
    const current = activePanel(members, layout, dock, group);
    return (
      <PanelDock dock={dock} group={group} groupCount={count} dragging={drag === 'panel'} dragKey={dragKey} dropTarget={(drag === 'panel' || drag === 'float') && hover === dock} dockPanels={members}
        activeId={current ? panelKey(current) : null} focusId={focusId}
        onActivate={(key) => { onLayoutChange({ activePanels: { ...layout.activePanels, [dock + ':' + group]: key } }); setFocusId(key); }}
        onMove={move} onOpenMarketplace={onOpenMarketplace}
        onClose={() => onLayoutChange({ [`${dock}Panel`]: false })} />
    );
  };
  // Split groups stack in the side docks and sit side by side in the bottom one.
  const dockView = (dock: Dock) => {
    const count = Math.max(1, placed[dock].length);
    if (count === 1) return groupView(dock, 0, 1);
    return (
      <PanelGroup direction={dock === 'bottom' ? 'horizontal' : 'vertical'} autoSaveId={`neuron.dock.${dock}.${count}`} className="flex min-h-0 min-w-0">
        {placed[dock].map((_, group) => (
          <Fragment key={group}>
            {group > 0 && <PanelResizeHandle className={'resize-handle ' + (dock === 'bottom' ? 'resize-handle-v' : 'resize-handle-h')} />}
            <Panel id={`${dock}-group-${group}`} order={group} minSize={15} className="min-h-0 min-w-0">{groupView(dock, group, count)}</Panel>
          </Fragment>
        ))}
      </PanelGroup>
    );
  };
  const center = (
    <PanelGroup direction="vertical" autoSaveId="neuron.shell.v" className="flex min-h-0 flex-col">
      <Panel id="center-row" order={1} minSize={30} className="min-h-0">
        <PanelGroup direction="horizontal" autoSaveId="neuron.center.h" className="flex min-h-0">
          <Panel id="main" order={1} minSize={30} className="min-w-0">{children}</Panel>
          {layout.rightPanel && (
            <>
              <PanelResizeHandle className="resize-handle resize-handle-v" />
              <Panel id="right" order={2} defaultSize={26} minSize={15} maxSize={50} className="min-w-0">{dockView('right')}</Panel>
            </>
          )}
        </PanelGroup>
      </Panel>
      {layout.bottomPanel && (
        <>
          <PanelResizeHandle className="resize-handle resize-handle-h" />
          <Panel id="bottom" order={2} defaultSize={28} minSize={12} maxSize={70} className="min-h-0">{dockView('bottom')}</Panel>
        </>
      )}
    </PanelGroup>
  );
  const regions = [
    ...(layout.leftPanel ? ['left'] : []),
    ...(layout.sidebar && layout.sidebarSide === 'left' ? ['sidebar'] : []),
    'center',
    ...(layout.sidebar && layout.sidebarSide === 'right' ? ['sidebar'] : []),
  ];

  // Where a drag would land, from the pointer alone: the outer bands of the
  // workbench are the three docks, and the middle means "put it back".
  const targetAt = (event: DragEvent, kind: 'panel' | 'sidebar' | 'float' | null = drag): Dock | null => {
    const target = dockBand(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY, kind === 'panel');
    return kind === 'sidebar' && target === layout.sidebarSide ? null : target;
  };
  const dockOpen = (dock: Dock) => layout[(dock + 'Panel') as 'leftPanel' | 'rightPanel' | 'bottomPanel'];
  // A closed dock (or the far side, for the sidebar) opens an empty slot under
  // the pointer, which pushes the rest of the layout aside like a real drop.
  const slot = (dock: Dock) => (
    <div aria-label={dock[0].toUpperCase() + dock.slice(1) + ' dock'} aria-hidden={!drag}
      data-dock-zone={dock} data-visible={!!drag} data-hover={hover === dock}
      data-open={drag !== 'sidebar' && dockOpen(dock)}
      className={'dock-slot dock-slot-' + (dock === 'bottom' ? 'h' : 'v')}>
      <div className="dock-slot-fill" />
    </div>
  );

  return (
    <div ref={rootRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-dragging={drag ?? undefined}
      onDragStart={(event) => { detectDrag(event); setDragKey((event.target as HTMLElement).dataset?.panelKey ?? null); }}
      onDragEnter={detectDrag} onDropCapture={clearDrag}
      onDragOver={(event) => {
        // From the event, not state: see the note on onDragLeave below.
        const types = event.dataTransfer.types;
        const kind = types.includes(PANEL_MIME) ? 'panel' : types.includes(SIDEBAR_MIME) ? 'sidebar' : null;
        if (!kind) return;
        if (kind !== drag) setDrag(kind);
        // Accepting the drag everywhere keeps the cursor from turning into "not allowed".
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const target = targetAt(event, kind);
        if (target !== hover) setHover(target);
      }}
      onDrop={(event) => {
        // Read the kind from the drop itself: layout shifting under the pointer can
        // fire a stray dragleave that clears the drag state just before this.
        const types = event.dataTransfer.types;
        const kind = types.includes(PANEL_MIME) ? 'panel' : types.includes(SIDEBAR_MIME) ? 'sidebar' : null;
        const target = kind ? targetAt(event, kind) : null;
        if (!target) return;
        event.preventDefault();
        if (event.dataTransfer.types.includes(PANEL_MIME)) move(event.dataTransfer.getData(PANEL_MIME), target);
        else if (target !== 'bottom' && event.dataTransfer.types.includes(SIDEBAR_MIME)) onLayoutChange({ sidebarSide: target });
      }}
      onDragLeave={(event) => {
        // Chromium often reports no relatedTarget, and the layout moving under the
        // pointer fires leaves of its own, so only a pointer outside the workbench counts.
        const rect = event.currentTarget.getBoundingClientRect();
        const inside = event.clientX > rect.left && event.clientX < rect.right && event.clientY > rect.top && event.clientY < rect.bottom;
        if (!inside) clearDrag();
      }}>
      <div className="flex min-h-0 min-w-0 flex-1">
        {slot('left')}
        {/* autoSaveId identifies an arrangement; saved sizes are positional, so a reversed sidebar needs its own record. */}
        <PanelGroup direction="horizontal" autoSaveId={layout.sidebarSide === 'left' ? 'neuron.shell.h' : 'neuron.shell.h.right'} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {regions.map((region, order) => (
            <Fragment key={region}>
              {order > 0 && (layout.sidebarCollapsed && (region === 'sidebar' || regions[order - 1] === 'sidebar') ? <div className="w-2 shrink-0" /> : <PanelResizeHandle className="resize-handle resize-handle-v" />)}
              {region === 'sidebar' && layout.sidebarCollapsed ? <div className="h-full w-11 shrink-0">{sidebar}</div> : (
              <Panel key={region} id={region} order={order} defaultSize={sizes.current[region] ?? (region === 'sidebar' ? 18 : region === 'left' ? 22 : undefined)}
                onResize={(size) => { sizes.current[region] = size; }}
                minSize={region === 'center' ? 30 : 12} maxSize={region === 'center' ? undefined : 40}
                className={'min-w-0' + (region === 'sidebar' && drag === 'sidebar' ? ' drag-source' : '')}>
                {region === 'center' ? center : region === 'sidebar' ? sidebar : dockView('left')}
              </Panel>
              )}
            </Fragment>
          ))}
        </PanelGroup>
        {slot('right')}
      </div>
      {slot('bottom')}
    </div>
  );
}
