import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { registerTerminalWriter } from '../lib/terminal-bus';

// Fixed dark terminal palette. The app's theme tokens are oklch, which
// xterm's color parser doesn't accept — and terminals read fine dark everywhere.
const THEME = {
  background: '#161616',
  foreground: '#d4d4d4',
  cursor: '#90d792',
  selectionBackground: '#3a3a3a',
};

/**
 * Interactive PTY terminal. Spawns a shell in the active repo via the main
 * process and streams I/O over the terminal IPC bridge.
 */
export default function XtermTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !window.electronAPI) return;

    let disposed = false;
    let ptyId: number | null = null;
    let unregister: (() => void) | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;

    // A pty exists before its shell is reading stdin. Publishing the writer on
    // spawn meant a queued command could be written into that gap and vanish.
    // First output is the shell announcing itself -- every shell prints a
    // prompt -- so that is the readiness signal. The timer is a floor, not a
    // guess: a shell that somehow prints nothing must not wedge the queue.
    const publishWriter = () => {
      if (unregister || disposed || ptyId == null) return;
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      const id = ptyId;
      unregister = registerTerminalWriter((data) => {
        void window.electronAPI.terminal.write(id, data);
      });
    };

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try { fit.fit(); } catch { /* not laid out yet */ }

    let diagBytes = 0;
    let diagEvents = 0;
    const offData = window.electronAPI.terminal.onData((id, data) => {
      diagBytes += data.length;
      diagEvents += 1;
      if (id !== ptyId) return;
      term.write(data);
      publishWriter();
    });
    // TEMP: surface the counters where a failure snapshot will show them.
    const diagTimer = setInterval(() => {
      if (container) container.setAttribute('data-diag', `pty=${String(ptyId)} events=${diagEvents} bytes=${diagBytes}`);
    }, 500);
    const offExit = window.electronAPI.terminal.onExit((id) => {
      if (id === ptyId) term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
    });
    const inputDisp = term.onData((data) => {
      if (ptyId != null) void window.electronAPI.terminal.write(ptyId, data);
    });

    void window.electronAPI.terminal.spawn({ cols: term.cols, rows: term.rows }).then(async (id) => {
      if (disposed) return;
      // Fetch and replay BEFORE claiming the id. `onData` ignores anything that
      // is not for `ptyId`, so until it is set the live stream is dropped --
      // which is what we want here: main has already folded those same bytes
      // into the history we are about to write. Claiming the id first would
      // write them live and then write them a second time as part of the
      // replay.
      const history = await window.electronAPI.terminal.history(id);
      if (disposed) return;
      if (history) term.write(history);
      ptyId = id;
      // A shell with history behind it has already announced itself, so the
      // queue can drain now. Only a genuinely fresh one waits for its prompt.
      if (history) publishWriter();
      else readyTimer = setTimeout(publishWriter, 5000);
      term.focus();
      // TEMP: prove the attach happened and say what it found.
      term.write(`\x1b[90m[diag attached id=${id} hist=${history.length}]\x1b[0m\r\n`);
    }).catch((error: Error) => {
      if (disposed) return;
      term.write(`\x1b[31m${String(error?.message ?? error)}\x1b[0m\r\n`);
    });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* hidden */ }
      if (ptyId != null) void window.electronAPI.terminal.resize(ptyId, term.cols, term.rows);
    });
    ro.observe(container);

    return () => {
      disposed = true;
      if (readyTimer) clearTimeout(readyTimer);
      clearInterval(diagTimer);
      unregister?.();
      ro.disconnect();
      offData();
      offExit();
      inputDisp.dispose();
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full overflow-hidden p-1" style={{ background: THEME.background }} />;
}
