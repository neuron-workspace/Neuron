/**
 * Tells the shell its size only when the size changed, and only once a burst of
 * changes has settled.
 *
 * Every resize makes the shell redraw its prompt. A ResizeObserver fires on
 * every pixel of a drag, so forwarding each one had the shell redrawing while
 * output was still arriving -- the half-a-path-then-the-rest-on-the-next-line
 * glitch.
 */
export interface ResizeSync {
  /** A new terminal size. 0 or negative sizes (a hidden panel) are ignored. */
  request(cols: number, rows: number): void;
  /** The pty was just spawned at this size, so it needs no resize to it. */
  markSent(cols: number, rows: number): void;
  dispose(): void;
}

export function createResizeSync(
  send: (cols: number, rows: number) => void,
  delayMs = 60,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): ResizeSync {
  let last: string | null = null;
  let pending: [number, number] | null = null;
  let timer: unknown = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const [cols, rows] = pending;
    pending = null;
    const key = `${cols}x${rows}`;
    if (key === last) return;
    last = key;
    send(cols, rows);
  };

  return {
    request(cols, rows) {
      if (!(cols > 0 && rows > 0)) return;
      pending = [cols, rows];
      if (timer !== null) timers.clear(timer);
      timer = timers.set(flush, delayMs);
    },
    markSent(cols, rows) { last = `${cols}x${rows}`; },
    dispose() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      pending = null;
    },
  };
}
