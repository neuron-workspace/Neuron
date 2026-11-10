import { useEffect, useRef, useState } from 'react';
import { Blocks, MoreHorizontal, PanelBottomClose, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { usePlugins } from '../plugins/host';
import { Button } from './ui/button';
import { DOCKS, PANEL_MIME, panelKey, type Dock, type GroupTarget } from '../lib/layout';
import type { PanelView } from '../plugins/types';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from './ui/context-menu';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { cn } from '../lib/utils';

export default function PanelDock({
  dock, group = 0, groupCount = 1, dragging = false, dragKey = null, dropTarget = false, dockPanels, activeId, focusId = null, onActivate, onMove, onOpenMarketplace, onClose,
}: {
  dock: Dock;
  /** Position of this card among the dock's split groups. */
  group?: number;
  groupCount?: number;
  /** A panel tab is being dragged somewhere in the workbench. */
  dragging?: boolean;
  /** The tab being dragged, so its card can look picked up. */
  dragKey?: string | null;
  /** The pointer is over this dock: dropping lands here. */
  dropTarget?: boolean;
  /** Tab to focus after a move or activation; never set on first render. */
  focusId?: string | null;
  dockPanels: { pluginId: string; view: PanelView }[];
  activeId: string | null;
  onActivate: (key: string) => void;
  onMove: (key: string, dock: Dock, index?: number, group?: GroupTarget) => void;
  onOpenMarketplace: () => void;
  onClose: () => void;
}) {
  const { runtimeFor } = usePlugins();
  const current = dockPanels.find((p) => panelKey(p) === activeId) ?? dockPanels[0] ?? null;
  const CloseIcon = dock === 'bottom' ? PanelBottomClose : dock === 'left' ? PanelLeftClose : PanelRightClose;
  const headerRef = useRef<HTMLElement>(null);
  const [splitHover, setSplitHover] = useState<'before' | 'after' | null>(null);
  useEffect(() => { if (!dragging) setSplitHover(null); }, [dragging]);
  useEffect(() => {
    if (!focusId || !dockPanels.some((p) => panelKey(p) === focusId)) return;
    const frame = requestAnimationFrame(() => {
      headerRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId]);

  const actions = (key: string) => {
    const index = dockPanels.findIndex((p) => panelKey(p) === key);
    return [
      ...DOCKS.map((target) => ({ label: 'Move to ' + target + ' dock', disabled: target === dock, run: () => onMove(key, target) })),
      { label: 'Move earlier', disabled: index <= 0, run: () => onMove(key, dock, index - 1, group) },
      { label: 'Move later', disabled: index >= dockPanels.length - 1, run: () => onMove(key, dock, index + 1, group) },
      { label: 'Split into its own group', disabled: dockPanels.length < 2 || groupCount >= 8, run: () => onMove(key, dock, undefined, { group, edge: 'after' }) },
      { label: 'Join previous group', disabled: group <= 0, run: () => onMove(key, dock, undefined, group - 1) },
      { label: 'Join next group', disabled: group >= groupCount - 1, run: () => onMove(key, dock, undefined, group + 1) },
    ];
  };
  const drop = (event: React.DragEvent, before?: string) => {
    if (!event.dataTransfer.types.includes(PANEL_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    const key = event.dataTransfer.getData(PANEL_MIME);
    if (key === before) return;
    const remaining = dockPanels.filter((p) => panelKey(p) !== key);
    onMove(key, dock, before ? remaining.findIndex((p) => panelKey(p) === before) : undefined, group);
  };
  const splitWords = dock === 'bottom' ? { before: 'left of', after: 'right of' } : { before: 'above', after: 'below' };
  const dockName = dock === 'bottom' ? 'Bottom' : dock === 'left' ? 'Left' : 'Side';

  return (
    <aside
      aria-label={`${dockName} plugin peek` + (group > 0 ? `, group ${group + 1}` : '')}
      data-dock-group={dock + ':' + group}
      data-drop-target={dropTarget || undefined}
      className={cn('shell-card relative flex h-full w-full flex-col', !!dragKey && !!current && panelKey(current) === dragKey && 'drag-source')}
    >
      {current && (['before', 'after'] as const).map((edge) => (
        <div key={edge} aria-label={`Split ${splitWords[edge]} ${current.view.title}`} aria-hidden={!dragging}
          data-split-zone={`${dock}:${group}:${edge}`}
          className={`workbench-drop-zone dock-split-zone dock-split-zone-${dock === 'bottom' ? 'h' : 'v'}-${edge}`}
          data-visible={dragging} data-hover={splitHover === edge}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(PANEL_MIME)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setSplitHover(edge);
          }}
          onDragLeave={() => setSplitHover(null)}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes(PANEL_MIME)) return;
            event.preventDefault();
            event.stopPropagation();
            setSplitHover(null);
            onMove(event.dataTransfer.getData(PANEL_MIME), dock, undefined, { group, edge });
          }}>
          {`Split ${splitWords[edge]}`}
        </div>
      ))}
      <header ref={headerRef} className="pane-header dock-header flex items-center justify-between gap-1 border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          aria-label="Panel tabs"
          onDragOver={(event) => { if (event.dataTransfer.types.includes(PANEL_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
          onDrop={(event) => drop(event)}
        >
          {dockPanels.length === 0 && <span className="px-2 text-xs text-[var(--ink-muted)]">{dock === 'bottom' ? 'Bottom peek' : 'Side peek'}</span>}
          {dockPanels.map(({ pluginId, view }) => {
            const Icon = view.icon;
            const key = panelKey({ pluginId, view });
            const isActive = current ? panelKey(current) === key : false;
            return (
              <ContextMenu key={key}>
                <ContextMenuTrigger asChild>
                  <button
                    draggable
                    data-panel-key={key}
                    onDragStart={(event) => { event.dataTransfer.setData(PANEL_MIME, key); event.dataTransfer.effectAllowed = 'move'; }}
                    onDrop={(event) => drop(event, key)}
                    onClick={() => onActivate(key)}
                    aria-pressed={isActive}
                    className={cn(
                      'interactive flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                      isActive ? 'bg-[var(--surface-hover)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]',
                    )}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {view.title}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {actions(key).map((action) => <ContextMenuItem key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label}</ContextMenuItem>)}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Panel options" disabled={!current} className="interactive grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"><MoreHorizontal className="h-4 w-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {current && actions(panelKey(current)).map((action) => <DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <button aria-label="Hide panel" className="interactive grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={onClose}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {current ? (
          <div key={panelKey(current)} className="h-full">
            {current.view.render(runtimeFor(current.pluginId))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-[var(--divider)] bg-[var(--surface)] text-[var(--ink-muted)]">
              <Blocks className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-[var(--ink)]">No panels enabled</h3>
            <p className="mt-1.5 max-w-sm text-xs leading-5 text-[var(--ink-secondary)]">
              {dock === 'bottom'
                ? 'Enable a plugin with a bottom view, such as a terminal or diagnostics tool.'
                : 'Enable an AI assistant or integration to add a side view here.'}
            </p>
            <Button size="sm" variant="secondary" className="mt-4" onClick={onOpenMarketplace}>Browse plugins</Button>
          </div>
        )}
      </div>
    </aside>
  );
}
