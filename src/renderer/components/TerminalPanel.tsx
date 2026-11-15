import { useSyncExternalStore } from 'react';
import { Plus, TerminalSquare, X } from 'lucide-react';
import XtermTerminal from './XtermTerminal';
import { cn } from '../lib/utils';

/**
 * Several shells in one panel, listed down the side.
 *
 * A second terminal used to mean a second panel, which took its height out of
 * the note. Here extra shells cost a narrow list instead, and only the selected
 * one is on screen.
 *
 * ponytail: module state, not settings. A pty does not survive a restart, so a
 * persisted list would restore names for shells that no longer exist.
 */
interface Session { key: string; title: string }
let sessions: Session[] = [{ key: 'panel', title: 'Terminal 1' }];
let active = 'panel';
let counter = 1;
let snapshot = { sessions, active };
const listeners = new Set<() => void>();
const commit = () => { snapshot = { sessions, active }; listeners.forEach((fn) => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function addSession() {
  counter += 1;
  const session = { key: `panel:${counter}`, title: `Terminal ${counter}` };
  sessions = [...sessions, session];
  active = session.key;
  commit();
}

function closeSession(key: string) {
  if (sessions.length < 2) return;
  const index = sessions.findIndex((s) => s.key === key);
  sessions = sessions.filter((s) => s.key !== key);
  if (active === key) active = sessions[Math.max(0, index - 1)].key;
  commit();
  // Sessions are addressed by key; spawning an existing key returns its pty.
  void window.electronAPI?.terminal.spawn({ key }).then((id) => window.electronAPI.terminal.kill(id)).catch(() => {});
}

export default function TerminalPanel() {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  const many = state.sessions.length > 1;
  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="relative min-w-0 flex-1">
        <XtermTerminal sessionKey={state.active} />
        {!many && (
          <button aria-label="New terminal" title="New terminal" onClick={addSession}
            className="interactive absolute right-2 top-1.5 grid h-6 w-6 place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {many && (
        <nav aria-label="Terminals" className="flex w-36 shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-[var(--divider)] p-1">
          {state.sessions.map((session) => (
            <div key={session.key} className={cn('group flex h-7 items-center rounded-md text-xs', session.key === state.active ? 'bg-[var(--surface-hover)] text-[var(--ink)]' : 'text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]')}>
              <button aria-current={session.key === state.active ? 'true' : undefined} onClick={() => { active = session.key; commit(); }}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left">
                <TerminalSquare className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{session.title}</span>
              </button>
              <button aria-label={`Close ${session.title}`} onClick={() => closeSession(session.key)}
                className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded opacity-0 hover:bg-[var(--divider)] focus-visible:opacity-100 group-hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button onClick={addSession} className="interactive mt-0.5 flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
            <Plus className="h-3.5 w-3.5" />New terminal
          </button>
        </nav>
      )}
    </div>
  );
}
