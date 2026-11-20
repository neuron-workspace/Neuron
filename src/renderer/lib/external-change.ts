/**
 * What to do when an open file changes on disk.
 *
 * - No local edit pending: the outside version replaces what is shown.
 * - A local edit pending (being saved, or not saved), and the disk holds one
 *   of our own writes: it is our echo coming back through the watcher; ignore it.
 * - A local edit pending and the disk holds something else: someone else
 *   changed the file while ours was not yet on disk. Neither version is picked
 *   silently; the user is asked.
 *
 * `ours` is every text this window has written to the file that may still be
 * echoing back: each save in flight and the last one that landed. Typing
 * quickly saves several versions in a row, and the watcher may report any of
 * them, so comparing against the newest alone would ask about our own text.
 */
export type ExternalChangeDecision = 'replace' | 'ignore' | 'ask';

export function decideExternalChange({ disk, pending, ours }: {
  disk: string;
  pending: boolean;
  ours: ReadonlyArray<string | null | undefined>;
}): ExternalChangeDecision {
  if (!pending) return 'replace';
  return ours.includes(disk) ? 'ignore' : 'ask';
}
