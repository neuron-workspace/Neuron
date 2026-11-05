import { useEffect, useRef } from 'react';
import { Blocks, MoreHorizontal, PanelBottomClose, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { usePlugins } from '../plugins/host';
import { Button } from './ui/button';
import { DOCKS, PANEL_MIME, panelKey, type Dock } from '../lib/layout';
import type { PanelView } from '../plugins/types';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from './ui/context-menu';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { cn } from '../lib/utils';

export default function PanelDock({
  dock, dockPanels, activeId, onActivate, onMove, onOpenMarketplace, onClose,
}: {
  dock: Dock;
  dockPanels: { pluginId: string; view: PanelView }[];
  activeId: string | null;
  onActivate: (key: string) => void;
  onMove: (key: string, dock: Dock, index?: number) => void;
  onOpenMarketplace: () => void;
  onClose: () => void;
}) {
  const { runtimeFor } = usePlugins();
  const current = dockPanels.find((p) => panelKey(p) === activeId) ?? dockPanels[0] ?? null;
  const CloseIcon = dock === 'bottom' ? PanelBottomClose : dock === 'left' ? PanelLeftClose : PanelRightClose;
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!activeId) return;
    const frame = requestAnimationFrame(() => {
      headerRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId]);

  const actions = (key: string) => {
    const index = dockPanels.findIndex((p) => panelKey(p) === key);
    return [
      ...DOCKS.map((target) => ({ label: 'Move to ' + target + ' dock', disabled: target === dock, run: () => onMove(key, target) })),
      { label: 'Move earlier', disabled: index <= 0, run: () => onMove(key, dock, index - 1) },
      { label: 'Move later', disabled: index >= dockPanels.length - 1, run: () => onMove(key, dock, index + 1) },
    ];
  };
  const drop = (event: React.DragEvent, before?: string) => {
    if (!event.dataTransfer.types.includes(PANEL_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    const key = event.dataTransfer.getData(PANEL_MIME);
    if (key === before) return;
    const remaining = dockPanels.filter((p) => panelKey(p) !== key);
    onMove(key, dock, before ? remaining.findIndex((p) => panelKey(p) === before) : undefined);
  };

  return (
    <aside
      aria-label={`${dock === 'bottom' ? 'Bottom' : dock === 'left' ? 'Left' : 'Side'} plugin peek`}
      className={cn('nav-surface flex h-full w-full flex-col', dock === 'bottom' ? 'border-t' : 'border-l')}
    >
      <header ref={headerRef} className="pane-header flex items-center justify-between gap-1 border-b px-2">
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
