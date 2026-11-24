import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileWarning, Loader2, MoreHorizontal, RotateCw, ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { registerSurface, type SurfaceProps } from './index';
import type { HtmxViewOpenResult } from '../electron.d';
import { onViewTrustChanged } from '../lib/view-trust';

// The HTMX view tab. The document itself renders inside a sandboxed <webview>
// (no Node, no preload, isolated in-memory partition) pointed at the loopback
// view server — user-authored HTML never touches the privileged renderer DOM.
// The existing Preview/Source header toggle doubles as "Edit source".
//
// Every view asks first (7B): HTML can be malicious, so nothing loads in the
// webview until this exact version is trusted, and any change to the HTML, its
// manifest or the code it is served asks again.

type Prompt = Extract<HtmxViewOpenResult, { status: 'needs-approval' }>;

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; sessionId: string; url: string; partition: string; name: string }
  | ({ kind: 'needs-approval' } & Omit<Prompt, 'status'>)
  | { kind: 'declined' }
  | { kind: 'error'; message: string }
  | { kind: 'crashed' };

/** What opening a view creates when missing (htmx/index.ts ensureScaffold); templates are never served. */
const SCAFFOLD_PATHS = new Set([
  '.neuron', '.neuron/config.json', '.neuron/fragments', '.neuron/styles', '.neuron/templates',
  '.neuron/fragments/hello.html',
]);

const CAP_LABELS: Record<string, string> = {
  'workspace.files.write': 'Modify existing files in its allowed paths',
  'workspace.files.create': 'Create new files in its allowed paths',
  'workspace.files.delete': 'Delete files in its allowed paths',
  'variables.write': 'Update writable workspace variables',
  'workspace.files.read': 'Read files in its allowed paths',
  'workspace.directories.list': 'List workspace files',
  'workspace.search': 'Search notes',
  'notes.read': 'Read note content and metadata',
  'tags.read': 'Read tags',
  'variables.read': 'Read workspace variables',
};

export function HtmxViewSurface({ path, colorScheme }: SurfaceProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [stopArmed, setStopArmed] = useState(false);
  const webviewRef = useRef<any>(null);
  const sessionRef = useRef<string | null>(null);
  // "Don't run" holds until the user asks for the prompt again; a change on
  // disk does not bring it back by itself.
  const declinedRef = useRef(false);

  // Every open() call takes a ticket. Only the newest may publish its result.
  //
  // Without this, StrictMode's double mount produced a dead view on the first
  // open of every dashboard. Mount 1 starts open() and creates session A;
  // cleanup runs before that await resolves, so sessionRef is still null and it
  // closes nothing; mount 2 opens again and the main process revokes A because
  // a session already existed for this path (htmx/index.ts). Whichever promise
  // resolved last won, and if that was the first one the webview loaded A's URL
  // after A had been revoked -- "This view session is no longer valid."
  const openTicket = useRef(0);
  const openedAt = useRef(0);

  const open = useCallback(async () => {
    const ticket = ++openTicket.current;
    openedAt.current = Date.now();
    declinedRef.current = false;
    setPhase({ kind: 'loading' });
    if (sessionRef.current) { void window.electronAPI.htmxViews.close(sessionRef.current); sessionRef.current = null; }
    const result: HtmxViewOpenResult = await window.electronAPI.htmxViews.open(path, colorScheme ?? 'dark');

    if (ticket !== openTicket.current) {
      // Superseded while awaiting. Close what we opened -- nobody else holds a
      // reference to it -- and publish nothing.
      if (result.status === 'ready') void window.electronAPI.htmxViews.close(result.sessionId);
      return;
    }

    if (result.status === 'ready') {
      sessionRef.current = result.sessionId;
      setPhase({ kind: 'ready', ...result });
    } else if (result.status === 'needs-approval') {
      const { status: _status, ...prompt } = result;
      setPhase({ kind: 'needs-approval', ...prompt });
    } else {
      setPhase({ kind: 'error', message: result.message });
    }
  }, [path, colorScheme]);

  useEffect(() => {
    void open();
    return () => {
      // Invalidate any in-flight open so its result cannot land after unmount.
      openTicket.current++;
      if (sessionRef.current) { void window.electronAPI.htmxViews.close(sessionRef.current); sessionRef.current = null; }
    };
  }, [open]);

  // Reopen when this view's source, manifest or served code changes on disk.
  // Main recomputes the content hash: unchanged reloads the tab with a fresh
  // session; changed stops the view and asks again.
  useEffect(() => {
    const manifestPath = `.neuron/manifests/${path.replace(/\.html$/i, '.json')}`;
    const legacyManifest = path.replace(/\.html$/i, '.neuron.json');
    return window.electronAPI.onNotesChanged((_event, changed) => {
      if (declinedRef.current) return;
      // Opening a view scaffolds any missing .neuron files, and the watcher
      // reports them a moment later. Reloading for that would tear down the view
      // that has just started, in every workspace that lacks those files.
      // The native watcher can report a new file as 'change', so any kind counts.
      // Only the paths the scaffold writes (htmx/index.ts SCAFFOLD): an edit to
      // any other fragment or stylesheet right after opening still asks again.
      // (The scaffold runs before the content hash is taken, so its files are
      // already part of the version the prompt shows, and the view server
      // serves only trusted bytes whatever this skips.)
      const scaffolded = SCAFFOLD_PATHS.has(changed) && Date.now() - openedAt.current < 3000;
      if (scaffolded) return;
      // Not variables.json: views write variables through the API and a reload
      // on every variable change would wipe in-page form state.
      const mine = changed === path
        || changed === manifestPath
        || changed === legacyManifest
        || /^\.neuron\/(fragments|styles)(\/|$)/.test(changed)
        || changed === '.neuron'
        || changed === '.neuron/config.json';
      if (mine) void open();
    });
  }, [path, open]);

  // Trust taken back from Workspace settings: main already stopped the session.
  useEffect(() => onViewTrustChanged((changed) => {
    if (changed === path && !declinedRef.current) void open();
  }), [path, open]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || phase.kind !== 'ready') return;
    const onCrash = () => setPhase({ kind: 'crashed' });
    wv.addEventListener('render-process-gone', onCrash);
    return () => wv.removeEventListener('render-process-gone', onCrash);
  }, [phase.kind]);

  const trust = async (contentHash: string) => {
    const result = await window.electronAPI.htmxViews.approve(path, contentHash);
    // Changed while the prompt was up: show the new version's prompt instead.
    if (result.success || result.changed) void open();
    else setPhase({ kind: 'error', message: result.error ?? 'Could not trust this view.' });
  };

  const decline = () => {
    openTicket.current++;
    declinedRef.current = true;
    if (sessionRef.current) { void window.electronAPI.htmxViews.close(sessionRef.current); sessionRef.current = null; }
    setPhase({ kind: 'declined' });
  };

  const stopTrusting = async () => {
    setStopArmed(false);
    openTicket.current++;
    sessionRef.current = null; // main revokes it with the record
    await window.electronAPI.htmxViews.resetApproval(path);
    void open();
  };

  const centered = (children: React.ReactNode) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">{children}</div>
  );

  if (phase.kind === 'loading') {
    return centered(<><Loader2 className="h-5 w-5 animate-spin text-[var(--ink-muted)]" /><p className="text-xs text-[var(--ink-muted)]">Starting view…</p></>);
  }

  if (phase.kind === 'needs-approval') {
    const requestedCaps = phase.permissions.filter((p) => p in CAP_LABELS);
    return centered(
      <div data-view-approval className="w-full max-w-md rounded-lg bg-[var(--surface)] p-5 text-left">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <ShieldQuestion className="h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
          {/* The path, not the manifest's self-declared name: the name is the view's to choose. */}
          <span>{requestedCaps.length > 0 ? <>“{path}” requests workspace access</> : <>Run “{path}”?</>}</span>
        </div>
        {phase.changed ? (
          <p data-view-changed className="mt-2 text-xs font-medium text-[var(--danger)]">This view changed since you trusted it.</p>
        ) : null}
        {phase.description ? <p className="mt-1 text-xs text-[var(--ink-secondary)]">{phase.description}</p> : null}
        {requestedCaps.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {requestedCaps.map((cap) => (
              <li key={cap} className="flex items-start gap-2 text-xs text-[var(--ink-secondary)]">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
                <span>{CAP_LABELS[cap]} <code className="text-[10px] text-[var(--ink-muted)]">({cap})</code></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-[var(--ink-secondary)]">It asks for no access to your workspace: it can show its own page and nothing else.</p>
        )}
        {(phase.writePaths.length > 0 || phase.readPaths.length > 0) && (
          <dl className="mt-3 space-y-1 rounded-md bg-[var(--canvas)] p-2.5 text-[11px]">
            {/* Write before read: it is the scope a user would refuse over. */}
            {phase.writePaths.length > 0 && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-[var(--ink-muted)]">Can change</dt>
                <dd className="text-[var(--ink-secondary)]">{phase.writePaths.join(', ')}</dd>
              </div>
            )}
            {phase.readPaths.length > 0 && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-[var(--ink-muted)]">Can read:</dt>
                <dd className="text-[var(--ink-secondary)]">{phase.readPaths.includes('**') ? 'all files in this workspace' : phase.readPaths.join(', ')}</dd>
              </div>
            )}
          </dl>
        )}
        <p className="mt-3 text-[11px] text-[var(--ink-muted)]">Only trust views you wrote or got from someone you trust. Trust lasts until this file, its manifest, or the styles and fragments it can load change.</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void trust(phase.contentHash)}>Trust this version</Button>
          <Button variant="secondary" onClick={decline}>Don't run</Button>
        </div>
      </div>,
    );
  }

  if (phase.kind === 'declined') {
    return centered(
      <div data-view-declined className="flex flex-col items-center gap-3">
        <p className="text-xs text-[var(--ink-muted)]">This view isn't running.</p>
        <Button variant="secondary" size="sm" onClick={() => void open()}>Trust…</Button>
      </div>,
    );
  }

  if (phase.kind === 'error') {
    return centered(<><FileWarning className="h-5 w-5 text-[var(--danger)]" /><p className="max-w-md text-xs text-[var(--ink-secondary)]">{phase.message}</p><p className="text-[11px] text-[var(--ink-muted)]">Switch to Source mode to edit this view or its manifest.</p></>);
  }

  if (phase.kind === 'crashed') {
    return centered(
      <>
        <AlertTriangle className="h-5 w-5 text-[var(--danger)]" />
        <p className="text-xs text-[var(--ink-secondary)]">This view crashed. Neuron itself is unaffected.</p>
        <Button variant="secondary" onClick={() => void open()}><RotateCw className="h-4 w-4" /> Reload view</Button>
      </>,
    );
  }

  const iconButton = 'interactive grid h-6 w-6 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]';
  return (
    <div className="flex h-full w-full flex-col bg-[var(--canvas)]">
      <div className="flex items-center gap-2 border-b divider-color px-3 py-1.5">
        <span className="truncate text-xs font-medium text-[var(--ink)]">{phase.name}</span>
        <span className="text-[10px] text-[var(--ink-muted)]">HTML view · isolated</span>
        <button
          type="button"
          title="Reload view"
          aria-label="Reload view"
          className={`${iconButton} ml-auto`}
          onClick={() => void open()}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <DropdownMenu onOpenChange={(isOpen) => { if (!isOpen) setStopArmed(false); }}>
          <DropdownMenuTrigger asChild>
            <button type="button" title="View options" aria-label="View options" className={iconButton}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void open()}><RotateCw className="h-3.5 w-3.5" /> Reload view</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--danger)]"
              onSelect={(e) => {
                // Confirm in place: the first choice arms, the second stops it.
                if (!stopArmed) { e.preventDefault(); setStopArmed(true); return; }
                void stopTrusting();
              }}
            >
              <ShieldOff className="h-3.5 w-3.5" /> {stopArmed ? 'Click again to stop trusting' : 'Stop trusting this view'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1">
        <webview
          // Remount per session. The boot token in src is single-use, so React
          // reusing the element and re-setting src would replay a spent token
          // and be rejected exactly like a revoked session.
          key={phase.sessionId}
          ref={webviewRef}
          src={phase.url}
          partition={phase.partition}
          style={{ width: '100%', height: '100%', display: 'flex' }}
        />
      </div>
    </div>
  );
}

registerSurface('html', HtmxViewSurface);

export default HtmxViewSurface;
