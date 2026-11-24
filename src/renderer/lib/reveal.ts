import { useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';

/**
 * "Open this file at line N": a search hit asks, and whatever shows the file
 * (a source editor, the text view, the Markdown preview) answers when it has
 * the file on screen. A request rather than a prop, because the file is often
 * not loaded -- or its view not even mounted -- when the hit is clicked.
 *
 * Every view showing the path when the request arrives, or mounting within a
 * moment of it, takes it; then it is forgotten, so reopening the file later
 * does not jump.
 */
export interface RevealRequest { id: number; path: string; /** 1-based. */ line: number }

let pending: RevealRequest | null = null;
let nextId = 1;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
/** How long a request waits for its file to be shown. */
const WAIT_MS = 4000;
/** How long after the first view took it others may still take it (a split shows source and preview). */
const SHARE_MS = 400;

export function requestReveal(path: string, line: number) {
  pending = { id: nextId++, path, line: Math.max(1, Math.floor(line)) };
  clearTimeout(expiry);
  expiry = setTimeout(() => { pending = null; }, WAIT_MS);
  for (const listener of [...listeners]) listener();
}

function taken(id: number) {
  if (pending?.id !== id) return;
  clearTimeout(expiry);
  expiry = setTimeout(() => { if (pending?.id === id) pending = null; }, SHARE_MS);
}

/**
 * Call `apply(line)` when a request for `path` arrives (or is waiting) and this
 * view can take it. `apply` returns false when it cannot yet (no editor view
 * mounted); it is tried again on the next frames for a little while.
 * `enabled: false` leaves the request to another view of the same file.
 */
export function useReveal(path: string | null | undefined, apply: (line: number) => boolean, enabled = true) {
  const [tick, setTick] = useState(0);
  const done = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => {
    const request = pending;
    if (!enabled || !path || !request || request.path !== path || done.current === request.id) return;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (pending?.id !== request.id) return;
      if (applyRef.current(request.line)) { done.current = request.id; taken(request.id); return; }
      if (++tries < 30) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  });
  void tick;
}

/** The cursor at the start of `line` in a source editor, scrolled to the middle. */
export function cursorToLine(view: EditorView | undefined | null, line: number): boolean {
  if (!view) return false;
  const doc = view.state.doc;
  const at = doc.line(Math.min(Math.max(1, line), doc.lines));
  view.dispatch({ selection: { anchor: at.from }, effects: EditorView.scrollIntoView(at.from, { y: 'center' }) });
  view.focus();
  return true;
}

/**
 * The rendered block holding `line` of the file, scrolled to the middle and
 * marked for a moment. In Live the caret goes into its text; in Reading the
 * selection is put at its start, which is where the cursor would be.
 * Blocks carry their first line as `data-source-line` (0-based, in the file).
 */
export function revealInPreview(root: HTMLElement | null | undefined, line: number): boolean {
  if (!root) return false;
  const target = line - 1;
  let best: HTMLElement | null = null;
  let bestLine = -1;
  for (const element of root.querySelectorAll<HTMLElement>('[data-source-line]')) {
    const at = Number(element.dataset.sourceLine);
    // Later in document order wins a tie: a block's own text sits inside it.
    if (at <= target && at >= bestLine) { best = element; bestLine = at; }
  }
  // A line above every block (in the properties, say): the first block.
  best ??= root.querySelector<HTMLElement>('[data-source-line]');
  if (!best) return false;
  best.scrollIntoView({ block: 'center' });
  const text = best.matches('[contenteditable="true"]') ? best : best.querySelector<HTMLElement>('[contenteditable="true"]');
  if (text) text.focus();
  const range = document.createRange();
  range.selectNodeContents(text ?? best);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const marked = best;
  marked.dataset.revealed = 'true';
  setTimeout(() => { delete marked.dataset.revealed; }, 1600);
  return true;
}
