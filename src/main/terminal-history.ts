const TERMINAL_HISTORY_LIMIT = 200 * 1024;
const CLEARS_SCREEN = /\x1b\[[23]J|\x1bc/g;

/** Replay only output since the last clear, retaining the newest output at the cap. */
export function appendHistory(history: string, data: string): string {
  let next = history + data;
  CLEARS_SCREEN.lastIndex = 0;
  let cut = -1;
  for (let m = CLEARS_SCREEN.exec(next); m; m = CLEARS_SCREEN.exec(next)) cut = m.index;
  if (cut >= 0) next = next.slice(cut);
  return next.length > TERMINAL_HISTORY_LIMIT ? next.slice(-TERMINAL_HISTORY_LIMIT) : next;
}
