import { TOO_LARGE_TO_OPEN } from '../../main/file-limits';

/**
 * Shown on a file that changed outside Neuron while an edit made here was not
 * yet on disk (see decideExternalChange). Nothing is written for the file
 * until one of the two is chosen.
 */
export function ExternalChangeBar({ path, onKeepMine, onUseDisk }: { path: string; onKeepMine: () => void; onUseDisk: () => void }) {
  const name = path.split(/[\\/]/).pop();
  return (
    <div role="alert" data-external-change={path} className="flex flex-wrap items-center gap-3 border-b border-[var(--divider)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink)]">
      <span className="min-w-0 flex-1 truncate" title={path}>{name} changed outside Neuron.</span>
      <button type="button" className="interactive shrink-0 rounded px-2 py-1 font-medium hover:bg-[var(--surface-hover)]" onClick={onKeepMine}>Keep my version</button>
      <button type="button" className="interactive shrink-0 rounded px-2 py-1 font-medium hover:bg-[var(--surface-hover)]" onClick={onUseDisk}>Use the file on disk</button>
    </div>
  );
}

/** Shown in place of a file main would not read (over 25 MB). */
export function TooLargeMessage() {
  return (
    <div role="status" data-too-large className="grid h-full place-items-center px-6 text-center text-sm text-[var(--ink-muted)]">
      {TOO_LARGE_TO_OPEN.replace(/^Error: /, '')}
    </div>
  );
}
