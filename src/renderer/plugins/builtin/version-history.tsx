import { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, Trash2, Pencil } from 'lucide-react';
import type { HostRuntime, PluginModule } from '../types';
import type { JournalEntry } from '../../electron.d';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { cn } from '../../lib/utils';

/** "2 minutes ago" — coarse on purpose; the exact stamp is the row's title. */
function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let DIAG_MOUNTS = 0;
let DIAG_LOADS = 0;
let DIAG_CLICKS = 0;
let DIAG_PD = 0;
let DIAG_PU = 0;
let DIAG_MD = 0;
let DIAG_MU = 0;
let DIAG_TICK = 0;
let DIAG_HITS: string[] = [];
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement | null;
    const btn = document.querySelector('[data-diag-restore]') as HTMLElement | null;
    const r = btn ? btn.getBoundingClientRect() : null;
    const where = r ? `btn=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}` : 'btn=none';
    DIAG_HITS.push(`@${Math.round(e.clientX)},${Math.round(e.clientY)}->${t ? t.tagName : 'null'}.${t && typeof t.className === 'string' ? t.className.slice(0, 24) : ''} ${where}`);
    if (DIAG_HITS.length > 6) DIAG_HITS = DIAG_HITS.slice(-6);
  }, true);
}

function VersionHistoryPanel({ host }: { host: HostRuntime }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const note = host.activeNote;

  const load = useCallback(async () => {
    if (!note) { setEntries([]); return; }
    setEntries(await window.electronAPI.journal.list(note));
  }, [note]);

  useEffect(() => { DIAG_MOUNTS += 1; }, []);
  useEffect(() => { const t = setInterval(() => { DIAG_TICK += 1; setStatus((v) => (v === '' ? null : '')); }, 400); return () => clearInterval(t); }, []);
  useEffect(() => { DIAG_LOADS += 1; setConfirming(null); setStatus(null); void load(); }, [load]);

  const restore = async (entry: JournalEntry) => {
    setBusy(entry.id);
    const result = await window.electronAPI.journal.restore(entry.id);
    setBusy(null);
    setConfirming(null);
    if (!result.success) { setStatus(result.error ?? 'Restore failed.'); return; }
    setStatus(`Restored the version from ${relativeTime(entry.createdAt)}.`);
    await host.refreshNotes();
    host.openNote(entry.relativePath);
    void load();
  };

  if (!note) {
    return (
      <div className="grid h-full place-items-center p-6">
        <p className="max-w-[15rem] text-center text-xs leading-5 text-[var(--ink-secondary)]">
          Open a note to see the versions Neuron kept before each save.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--divider)] px-3 py-2.5">
        <div className="truncate text-sm font-medium text-[var(--ink)]" title={note}>
          {note.split('/').pop()}
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
          {entries === null
            ? 'Reading history…'
            : entries.length === 0
              ? 'No earlier versions'
              : `${entries.length} earlier version${entries.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {/* Result of the last restore, announced rather than flashed. */}
      {status && (
        <p role="status" className="border-b border-[var(--divider)] px-3 py-2 text-[11px] leading-4 text-[var(--ink-secondary)]">
          {status}
        </p>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {entries !== null && entries.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs leading-5 text-[var(--ink-secondary)]">
              History starts at your next edit.
            </p>
            <p className="mt-2 text-[11px] leading-5 text-[var(--ink-muted)]">
              Neuron keeps a copy of this file before every save and before any delete, so a bad
              edit is recoverable. Copies stay on this machine and are never part of your workspace.
            </p>
          </div>
        )}

        <div className="p-1.5">
          {(entries ?? []).map((entry) => {
            const skipped = entry.state === 'skipped';
            const diag = `DIAG mounts=${DIAG_MOUNTS} loads=${DIAG_LOADS} clicks=${DIAG_CLICKS} pd=${DIAG_PD} pu=${DIAG_PU} md=${DIAG_MD} mu=${DIAG_MU} tick=${DIAG_TICK} confirming=${String(confirming)} HITS[${DIAG_HITS.join(' | ')}]`;
            const isConfirming = confirming === entry.id;
            const Icon = entry.operation === 'delete' ? Trash2 : Pencil;
            return (
              <div
                key={entry.id}
                className={cn(
                  'rounded-md px-2 py-2 transition-colors duration-150',
                  isConfirming ? 'bg-[var(--surface)]' : 'hover:bg-[var(--surface-hover)]',
                )}
              >
                <p>{diag}</p>
                <div className="flex items-baseline gap-2">
                  <Icon className="h-3 w-3 shrink-0 translate-y-0.5 text-[var(--ink-muted)]" aria-hidden />
                  <span
                    className="text-xs font-medium text-[var(--ink)]"
                    title={new Date(entry.createdAt).toLocaleString()}
                  >
                    {relativeTime(entry.createdAt)}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[var(--ink-muted)]">
                    {formatBytes(entry.originalBytes)}
                  </span>
                </div>

                {/* The word carries the state, not just an icon colour. */}
                <p className="mt-0.5 pl-5 text-[11px] text-[var(--ink-muted)]">
                  {entry.operation === 'delete' ? 'Before it was deleted' : 'Before it was overwritten'}
                </p>

                {skipped ? (
                  <p className="mt-1.5 pl-5 text-[11px] leading-4 text-[var(--ink-secondary)]">
                    Not recoverable — the file was over the size limit when this version was
                    recorded, so no copy was kept.
                  </p>
                ) : isConfirming ? (
                  // Inline confirm, not a dialog: the row already shows what is
                  // about to be replaced, and a modal would hide it to ask.
                  <div className="mt-2 pl-5">
                    <p className="text-[11px] leading-4 text-[var(--ink-secondary)]">
                      Replace the file on disk with this version? The current contents are kept as a
                      new entry, so this is reversible.
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" disabled={busy === entry.id} onClick={() => void restore(entry)}>
                        {busy === entry.id ? 'Restoring…' : 'Replace file'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 pl-5">
                    <Button
                      size="sm"
                      variant="secondary"
                      data-diag-restore=""
                      onPointerDown={() => { DIAG_PD += 1; setStatus(null); }}
                      onPointerUp={() => { DIAG_PU += 1; setStatus(null); }}
                      onMouseDown={() => { DIAG_MD += 1; setStatus(null); }}
                      onMouseUp={() => { DIAG_MU += 1; setStatus(null); }}
                      onClick={() => { DIAG_CLICKS += 1; setStatus(null); setConfirming(entry.id); }}
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

const versionHistory: PluginModule = {
  manifest: {
    id: 'version-history',
    name: 'Version history',
    version: '1.0.0',
    description:
      'Restore an earlier version of the open note. Neuron records the previous contents before every save and before any delete; the copies stay on this machine, outside your workspace.',
    category: 'editor',
  },
  activate(host) {
    host.registerPanel({
      id: 'version-history',
      title: 'Version history',
      icon: History,
      location: 'side',
      render: (runtime) => <VersionHistoryPanel host={runtime} />,
    });
    host.registerCommand({
      id: 'version-history.open',
      title: 'Version history: show earlier versions of this note',
      run: () => { /* opening the side peek is handled by the panel registration */ },
    });
  },
};

export default versionHistory;
