import { useState } from 'react';
import { Check, ChevronDown, LayoutPanelLeft, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { layoutNameError, MAX_SAVED_LAYOUTS, type SavedLayout } from '../lib/layout';
import { cn } from '../lib/utils';

const row = 'interactive flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:opacity-50';

/** Switch between saved arrangements of the workbench, and save the current one. */
export default function LayoutSwitcher({ layouts, activeId, modified, onApply, onSave, onUpdate, onDelete, onReset }: {
  layouts: SavedLayout[];
  activeId: string | null;
  /** The live layout no longer matches the active saved one. */
  modified: boolean;
  onApply: (id: string) => void;
  onSave: (name: string) => void;
  onUpdate: () => void;
  onDelete: (id: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = layouts.find((l) => l.id === activeId) ?? null;
  const full = layouts.length >= MAX_SAVED_LAYOUTS;

  const save = () => {
    const problem = full ? `You can keep ${MAX_SAVED_LAYOUTS} layouts. Delete one first.` : layoutNameError(name, layouts);
    if (problem) { setError(problem); return; }
    onSave(name.trim());
    setName(''); setError(null);
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); setConfirmDelete(false); setError(null); }}>
      <PopoverTrigger asChild>
        <button aria-label="Layouts" title="Layouts"
          className="interactive flex h-7 max-w-[160px] items-center gap-1.5 rounded-md px-2 text-xs text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
          <LayoutPanelLeft className="h-4 w-4 shrink-0" />
          <span className="truncate">{active ? active.name : 'Layout'}</span>
          {active && modified && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" role="img" aria-label="Changed since it was saved" />}
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <div role="group" aria-label="Saved layouts">
          {layouts.length === 0 && <p className="px-2 py-1.5 text-xs text-[var(--ink-muted)]">Save the current arrangement to switch back to it later.</p>}
          {layouts.map((layout) => (
            <button key={layout.id} className={cn(row, layout.id === activeId && 'text-[var(--ink)]')} aria-pressed={layout.id === activeId}
              onClick={() => { onApply(layout.id); setOpen(false); }}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', layout.id !== activeId && 'invisible')} />
              <span className="truncate">{layout.name}</span>
            </button>
          ))}
        </div>
        <div className="my-1.5 border-t border-[var(--divider)]" />
        <form className="px-1 pb-1" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <label className="mb-1 block text-xs text-[var(--ink-muted)]" htmlFor="layout-name">Save current layout as</label>
          <div className="flex gap-1.5">
            <input id="layout-name" value={name} placeholder="Research" autoComplete="off"
              aria-invalid={!!error} aria-describedby={error ? 'layout-name-error' : undefined}
              onChange={(event) => { setName(event.target.value); setError(null); }}
              className="field h-8 min-w-0 flex-1 rounded-md border border-[var(--divider)] bg-[var(--canvas)] px-2 text-[13px] text-[var(--ink)]" />
            <button type="submit" aria-label="Save layout" className="interactive grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--divider)] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
              <Save className="h-4 w-4" />
            </button>
          </div>
          {error && <p id="layout-name-error" role="alert" className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
        </form>
        {active && (
          <>
            <div className="my-1.5 border-t border-[var(--divider)]" />
            {modified && <button className={row} onClick={() => { onUpdate(); setOpen(false); }}><Save className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Update ?{active.name}?</span></button>}
            <button className={cn(row, confirmDelete && 'text-[var(--danger)] hover:text-[var(--danger)]')}
              onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } onDelete(active.id); setConfirmDelete(false); }}>
              <Trash2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{confirmDelete ? `Delete ?${active.name}?? Click again` : `Delete ?${active.name}?`}</span>
            </button>
          </>
        )}
        <div className="my-1.5 border-t border-[var(--divider)]" />
        <button className={row} onClick={() => { onReset(); setOpen(false); }}><RotateCcw className="h-3.5 w-3.5 shrink-0" />Reset to default layout</button>
      </PopoverContent>
    </Popover>
  );
}
