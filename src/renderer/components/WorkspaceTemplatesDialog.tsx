import type { WorkspaceTemplate } from '../electron.d';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { cn } from '../lib/utils';

interface WorkspaceTemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** From useWorkspaceTemplates, which the caller also uses to decide whether to offer this. */
  templates: WorkspaceTemplate[];
  busy: string | null;
  error: string | null;
  start: (template: WorkspaceTemplate) => Promise<void>;
}

/** Pick a bundled template; it is copied into a folder the user then chooses. The switcher and the welcome page share it. */
export default function WorkspaceTemplatesDialog({ open, onOpenChange, templates, busy, error, start }: WorkspaceTemplatesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New workspace from template</DialogTitle>
          <DialogDescription>A template is copied into a folder you pick; the originals stay untouched.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border border-[var(--divider)]">
          {templates.map((template, index) => (
            <button
              key={template.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void start(template).then(() => onOpenChange(false))}
              className={cn('interactive flex w-full flex-col items-start px-3 py-2 text-left hover:bg-[var(--surface-hover)] disabled:opacity-60', index > 0 && 'border-t border-[var(--divider)]')}
            >
              <span className="text-[13px] font-medium text-[var(--ink)]">{busy === template.id ? 'Creating…' : template.name}</span>
              <span className="text-xs text-[var(--ink-muted)]">
                {template.description || `${template.noteCount} note${template.noteCount === 1 ? '' : 's'} to start from`}
              </span>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
