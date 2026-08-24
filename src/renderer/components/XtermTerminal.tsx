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

    const offData = window.electronAPI.terminal.onData((id, data) => {
      if (id !== ptyId) return;
      term.write(data);
      publishWriter();
    });
    const offExit = window.electronAPI.terminal.onExit((id) => {
      if (id === ptyId) term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
    });
    const inputDisp = term.onData((data) => {
      if (ptyId != null) void window.electronAPI.terminal.write(ptyId, data);
    });

    void window.electronAPI.terminal.spawn({ cols: term.cols, rows: term.rows }).then((id) => {
      if (disposed) { void window.electronAPI.terminal.kill(id); return; }
      ptyId = id;
      term.focus();
      readyTimer = setTimeout(publishWriter, 5000);
    });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* hidden */ }
      if (ptyId != null) void window.electronAPI.terminal.resize(ptyId, term.cols, term.rows);
    });
    ro.observe(container);

    return () => {
      disposed = true;
      if (readyTimer) clearTimeout(readyTimer);
      unregister?.();
      ro.disconnect();
      offData();
      offExit();
      inputDisp.dispose();
      if (ptyId != null) void window.electronAPI.terminal.kill(ptyId);
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full overflow-hidden p-1" style={{ background: THEME.background }} />;
}
