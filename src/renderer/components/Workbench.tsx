import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { usePlugins } from '../plugins/host';
import { DOCKS, PANEL_MIME, SIDEBAR_MIME, activePanel, movePanel, panelKey, placePanels, type Dock, type GroupTarget, type WorkbenchLayout } from '../lib/layout';
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
  const clearDrag = () => { setDrag(null); setHover(null); };

  useEffect(() => {
    const clear = () => { setDrag(null); setHover(null); };
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
  const accepts = (event: DragEvent, dock: Dock) => event.dataTransfer.types.includes(PANEL_MIME)
    || (dock !== 'bottom' && event.dataTransfer.types.includes(SIDEBAR_MIME));
  const groupView = (dock: Dock, group: number, count: number) => {
    const members = placed[dock][group] ?? [];
    const current = activePanel(members, layout, dock, group);
    return (
      <PanelDock dock={dock} group={group} groupCount={count} dragging={drag === 'panel'} dockPanels={members}
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

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      onDragStart={detectDrag} onDragEnter={detectDrag} onDropCapture={clearDrag}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDrag(); }}>
      {/* autoSaveId identifies an arrangement; saved sizes are positional, so a reversed sidebar needs its own record. */}
      <PanelGroup direction="horizontal" autoSaveId={layout.sidebarSide === 'left' ? 'neuron.shell.h' : 'neuron.shell.h.right'} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {regions.map((region, order) => (
          <Fragment key={region}>
            {order > 0 && (layout.sidebarCollapsed && (region === 'sidebar' || regions[order - 1] === 'sidebar') ? <div className="w-2 shrink-0" /> : <PanelResizeHandle className="resize-handle resize-handle-v" />)}
            {region === 'sidebar' && layout.sidebarCollapsed ? <div className="h-full w-11 shrink-0">{sidebar}</div> : (
            <Panel key={region} id={region} order={order} defaultSize={sizes.current[region] ?? (region === 'sidebar' ? 18 : region === 'left' ? 22 : undefined)}
              onResize={(size) => { sizes.current[region] = size; }}
              minSize={region === 'center' ? 30 : 12} maxSize={region === 'center' ? undefined : 40} className="min-w-0">
              {region === 'center' ? center : region === 'sidebar' ? sidebar : dockView('left')}
            </Panel>
            )}
          </Fragment>
        ))}
      </PanelGroup>
      {/* The sidebar cannot go to the bottom, and the side it is already on is not a
          move. That target would also appear under the pointer as the drag starts. */}
      {DOCKS.filter((dock) => drag !== 'sidebar' || (dock !== 'bottom' && dock !== layout.sidebarSide)).map((dock) => (
        <div key={dock} aria-label={dock[0].toUpperCase() + dock.slice(1) + ' dock'} aria-hidden={!drag}
          data-dock-zone={dock}
          className={'workbench-drop-zone workbench-drop-zone-' + dock}
          data-visible={!!drag} data-hover={hover === dock}
          onDragOver={(event) => {
            if (!accepts(event, dock)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setHover(dock);
          }}
          onDragLeave={() => setHover(null)}
          onDrop={(event) => {
            if (!accepts(event, dock)) return;
            event.preventDefault();
            if (event.dataTransfer.types.includes(PANEL_MIME)) move(event.dataTransfer.getData(PANEL_MIME), dock);
            else if (dock !== 'bottom') onLayoutChange({ sidebarSide: dock });
            clearDrag();
          }}>
          {dock[0].toUpperCase() + dock.slice(1) + ' dock'}
        </div>
      ))}
    </div>
  );
}
