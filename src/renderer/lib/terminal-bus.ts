/**
 * A one-way channel from anywhere in the renderer to the terminal panel.
 *
 * The terminal owns its pty id inside a `useEffect` and nothing else has a
 * handle on it, so a note that wants to run a command needs somewhere to hand
 * the string to. This is that place.
 *
 * ponytail: module-level callbacks, not a React context. One terminal panel is
 * live at a time; a provider would be three files of plumbing to move one
 * string across the tree. If a second terminal ever becomes addressable, this
 * grows an id and stops being a singleton -- until then it should not pretend.
 */

type Writer = (data: string) => void;

let openPanel: (() => void) | null = null;
let write: Writer | null = null;

// Commands queue because clicking a button in a note may be what opens the
// terminal in the first place: the panel mounts, then xterm lays out, then the
// pty spawns, and only then is there anything to write to. Without the queue
// the first click of a session would silently do nothing.
const pending: string[] = [];

function flush(): void {
  if (!write) return;
  while (pending.length) write(pending.shift()!);
}

/** The workbench registers how to reveal the terminal panel. */
export function registerTerminalOpener(fn: () => void): () => void {
  openPanel = fn;
  return () => { if (openPanel === fn) openPanel = null; };
}

/** The terminal panel registers itself once its pty is live. */
export function registerTerminalWriter(fn: Writer): () => void {
  write = fn;
  flush();
  return () => { if (write === fn) write = null; };
}

/**
 * A command is one line, always.
 *
 * Note content is untrusted -- a workspace can be cloned, synced or shared --
 * and a command carrying a newline would run as two, with only the first
 * visible on the button that claims to describe it. Everything else about this
 * is legible to the person clicking; that is the property worth keeping.
 */
export function isRunnableCommand(command: string): boolean {
  const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]');
  return command.trim().length > 0 && !CONTROL_CHARS.test(command);
}

/** Reveal the terminal and run one command in it. */
export function runInTerminal(command: string): void {
  if (!isRunnableCommand(command)) return;
  openPanel?.();
  pending.push(command.trim() + '\r');
  flush();
}
