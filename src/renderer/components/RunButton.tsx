import { useState } from 'react';
import { Play, TerminalSquare, Ban } from 'lucide-react';
import { runInTerminal, isRunnableCommand } from '../lib/terminal-bus';

/**
 * A button in a note that runs one command in the workspace terminal.
 *
 * `<Run label="Open in VS Code" cmd="code ." />`
 *
 * The command is always rendered next to the label, and that is the security
 * design, not decoration. A note is untrusted content -- workspaces are cloned,
 * synced and shared -- so a button whose label said "Open in VS Code" while it
 * quietly ran something else would be a phishing surface with a nice icon. The
 * label is the author's claim; the command is what actually happens, and the
 * reader sees both before deciding to click.
 *
 * Two more properties hold that up:
 *
 *  - One line only. A command containing a newline would run as several, with
 *    only the first visible. Those are refused, visibly, rather than trimmed
 *    into something that looks fine.
 *  - It runs in the terminal panel, which is revealed by the click. Output,
 *    prompts and failures all land somewhere the user is already looking --
 *    nothing runs as a hidden child process.
 */
export function Run({ cmd, label, tone }: { cmd?: string; label?: string; tone?: string }) {
  const [ran, setRan] = useState(false);
  const command = (cmd ?? '').trim();

  if (!command) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--danger)] px-2 py-1 text-[11px] text-[var(--danger)]">
        <Ban className="h-3 w-3" /> {'<Run />'} needs a cmd, e.g. cmd="code ."
      </span>
    );
  }

  if (!isRunnableCommand(command)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--danger)] px-2 py-1 text-[11px] text-[var(--danger)]">
        <Ban className="h-3 w-3" /> A command must be a single line.
      </span>
    );
  }

  // Tone is looked up, never interpolated -- same rule as the layout
  // primitives, for the same reason.
  const accent = tone === 'accent';

  return (
    <button
      type="button"
      onClick={() => { runInTerminal(command); setRan(true); }}
      title={`Runs in the workspace terminal: ${command}`}
      className={[
        'interactive my-1 inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left align-middle text-xs',
        accent
          ? 'border-[var(--accent)] text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]'
          : 'border-[var(--divider)] text-[var(--ink)] hover:bg-[var(--surface-hover)]',
      ].join(' ')}
    >
      {ran ? <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-[var(--positive)]" /> : <Play className="h-3.5 w-3.5 shrink-0" />}
      {label && <span className="font-medium">{label}</span>}
      {/* The command itself, verbatim. Never truncated with an ellipsis: a
          half-shown command is worse than none, because it still reads as
          disclosure. */}
      <code className="min-w-0 break-all rounded bg-[var(--canvas)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-secondary)]">
        {command}
      </code>
    </button>
  );
}
