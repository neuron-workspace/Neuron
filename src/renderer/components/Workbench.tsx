import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { usePlugins } from '../plugins/host';
import { PANEL_MIME, SIDEBAR_MIME, activePanel, movePanel, panelKey, placePanels, type Dock, type GroupTarget, type WorkbenchLayout } from '../lib/layout';
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
  const [drag, setDrag] = useState<'panel' | 'sidebar' | null>(null);
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
      <PanelDock dock={dock} group={group} groupCount={count} dragging={drag === 'panel'} dragKey={dragKey} dropTarget={drag === 'panel' && hover === dock} dockPanels={members}
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
  const targetAt = (event: DragEvent): Dock | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const target: Dock | null = drag === 'panel' && fy > 0.72 ? 'bottom' : fx < 0.22 ? 'left' : fx > 0.78 ? 'right' : null;
    return drag === 'sidebar' && target === layout.sidebarSide ? null : target;
  };
  const dockOpen = (dock: Dock) => layout[(dock + 'Panel') as 'leftPanel' | 'rightPanel' | 'bottomPanel'];
  // A closed dock (or the far side, for the sidebar) opens an empty slot under
  // the pointer, which pushes the rest of the layout aside like a real drop.
  const slot = (dock: Dock) => (
    <div aria-label={dock[0].toUpperCase() + dock.slice(1) + ' dock'} aria-hidden={!drag}
      data-dock-zone={dock} data-visible={!!drag} data-hover={hover === dock}
      data-open={drag === 'panel' && dockOpen(dock)}
      className={'dock-slot dock-slot-' + (dock === 'bottom' ? 'h' : 'v')}>
      <div className="dock-slot-fill" />
    </div>
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-dragging={drag ?? undefined}
      onDragStart={(event) => { detectDrag(event); setDragKey((event.target as HTMLElement).dataset?.panelKey ?? null); }}
      onDragEnter={detectDrag} onDropCapture={clearDrag}
      onDragOver={(event) => {
        if (!drag) return;
        // Accepting the drag everywhere keeps the cursor from turning into "not allowed".
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const target = targetAt(event);
        if (target !== hover) setHover(target);
      }}
      onDrop={(event) => {
        const target = drag ? targetAt(event) : null;
        if (!target) return;
        event.preventDefault();
        if (event.dataTransfer.types.includes(PANEL_MIME)) move(event.dataTransfer.getData(PANEL_MIME), target);
        else if (target !== 'bottom' && event.dataTransfer.types.includes(SIDEBAR_MIME)) onLayoutChange({ sidebarSide: target });
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDrag(); }}>
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
