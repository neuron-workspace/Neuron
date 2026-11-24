import { useEffect, useMemo, useState } from 'react';
import { Folder } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

/** Rename or "Move to…", for a file or a folder, asked for from the sidebar or the explorer. */
export interface FileAction { kind: 'rename' | 'move'; path: string; folder: boolean }

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const leafOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** Notes are renamed without their extension, which stays; other files show theirs. */
const keptExtension = (path: string, folder: boolean) => (!folder && /\.(md|mdx)$/i.test(path) ? /\.(md|mdx)$/i.exec(path)![0] : '');

/** Why a typed name cannot be used, or ''. The main process checks again. */
export function nameProblem(name: string): string {
  if (!name.trim()) return 'Enter a name.';
  if (/[/\\:*?"<>|]/.test(name)) return 'Names cannot contain / \\ : * ? " < > |.';
  if (name.trim().startsWith('.')) return 'Names cannot start with a dot.';
  if (name.length > 120) return 'Use 120 characters or fewer.';
  return '';
}

export default function FileActionDialog({ action, folders, onClose, onMove }: {
  action: FileAction | null;
  /** Every folder in the workspace, for Move to…. */
  folders: string[];
  onClose: () => void;
  /** Rename or move; resolves to an error to show, or null when it is done. */
  onMove: (from: string, to: string) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const extension = action ? keptExtension(action.path, action.folder) : '';
  useEffect(() => {
    setError(''); setFilter(''); setBusy(false);
    if (action) setName(leafOf(action.path).slice(0, leafOf(action.path).length - extension.length));
  }, [action, extension.length]);

  const targets = useMemo(() => {
    if (!action) return [];
    const from = action.path;
    const here = parentOf(from);
    // Not the folder it is in already, and a folder never into itself.
    return ['', ...[...new Set(folders)].sort((a, b) => a.localeCompare(b))]
      .filter((folder) => folder !== here && !(action.folder && (folder === from || folder.startsWith(from + '/'))))
      .filter((folder) => !folder.startsWith('.neuron') && (folder || '/').toLowerCase().includes(filter.trim().toLowerCase()));
  }, [action, folders, filter]);

  const run = async (to: string) => {
    if (!action) return;
    setBusy(true);
    setError('');
    const problem = await onMove(action.path, to).catch(() => 'Could not rename. Try again.');
    setBusy(false);
    if (problem) setError(problem); else onClose();
  };
  const rename = () => {
    if (!action) return;
    const problem = nameProblem(name);
    if (problem) { setError(problem); return; }
    const parent = parentOf(action.path);
    const to = (parent ? parent + '/' : '') + name.trim() + extension;
    if (to === action.path) { onClose(); return; }
    void run(to);
  };

  const label = action ? leafOf(action.path) : '';
  return (
    <Dialog open={!!action} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-file-action={action?.kind}>
        <DialogHeader>
          <DialogTitle>{action?.kind === 'move' ? `Move “${label}”` : `Rename “${label}”`}</DialogTitle>
          <DialogDescription>
            {action?.kind === 'move' ? 'Choose the folder to move it to. Links to it are updated.' : 'Links to it are updated to the new name.'}
          </DialogDescription>
        </DialogHeader>
        {action?.kind === 'rename' ? (
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); rename(); }}>
            <label htmlFor="file-action-name" className="text-sm font-medium">{action.folder ? 'Folder name' : 'File name'}</label>
            <div className="flex items-center gap-1.5">
              <Input id="file-action-name" autoFocus value={name} disabled={busy} autoComplete="off" spellCheck={false}
                aria-invalid={!!error} aria-describedby={error ? 'file-action-error' : undefined}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => { setName(event.target.value); setError(''); }} />
              {extension && <span aria-hidden="true" className="text-sm text-[var(--ink-muted)]">{extension}</span>}
            </div>
            {error && <p id="file-action-error" role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Renaming…' : 'Rename'}</Button>
            </div>
          </form>
        ) : action ? (
          <div className="space-y-3">
            <label htmlFor="file-action-filter" className="sr-only">Find a folder</label>
            <Input id="file-action-filter" autoFocus placeholder="Find a folder" value={filter} disabled={busy} autoComplete="off" spellCheck={false}
              onChange={(event) => setFilter(event.target.value)} />
            <div role="listbox" aria-label="Folders" className="max-h-64 overflow-y-auto rounded border border-[var(--divider)] p-1">
              {targets.map((folder) => (
                <button key={folder || '/'} type="button" role="option" aria-selected={false} disabled={busy}
                  className="interactive flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--surface-hover)]"
                  onClick={() => void run((folder ? folder + '/' : '') + label)}>
                  <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" aria-hidden />
                  <span className="truncate">{folder || 'Workspace root'}</span>
                </button>
              ))}
              {!targets.length && <p className="px-2 py-3 text-center text-xs text-[var(--ink-muted)]">No folder matches.</p>}
            </div>
            {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
            <div className="flex justify-end"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button></div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
