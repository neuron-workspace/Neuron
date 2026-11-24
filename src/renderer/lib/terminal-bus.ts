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
 * A command is one visible line, always: what the button shows is what the
 * shell receives.
 *
 * Note content is untrusted -- a workspace can be cloned, synced or shared --
 * and a command carrying a newline would run as two, with only the first
 * visible on the button that claims to describe it. The same goes for anything
 * that displays differently from what it sends:
 *
 *   C0 controls and DEL            U+0000-U+001F, U+007F (newline, CR, tab, ESC)
 *   C1 controls                    U+0080-U+009F (includes the 8-bit CSI)
 *   bidi overrides and isolates    U+202A-U+202E, U+2066-U+2069
 *   bidi marks                     U+200E, U+200F, U+061C
 *   zero-width characters          U+200B-U+200D, U+2060, U+FEFF
 *
 * Ordinary Unicode (accents, CJK, emoji) is fine. Run buttons and automations
 * both use this one rule.
 */
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩‎‏؜​-‍⁠﻿]/;

/** Shown wherever a command is refused by isRunnableCommand. */
export const HIDDEN_CHARS_REFUSAL = "This command contains hidden characters and won't run.";

export function isRunnableCommand(command: string): boolean {
  return typeof command === 'string' && command.trim().length > 0 && !HIDDEN_CHARS.test(command);
}

/** Reveal the terminal and run one command in it. */
export function runInTerminal(command: string): void {
  if (!isRunnableCommand(command)) return;
  openPanel?.();
  pending.push(command.trim() + '\r');
  flush();
}

/** Validate the whole sequence before submitting any command. */
export function runAutomationInTerminal(commands: string[]): boolean {
  if (!commands.length || !commands.every((command) => typeof command === 'string' && isRunnableCommand(command))) return false;
  for (const command of commands) runInTerminal(command);
  return true;
}
