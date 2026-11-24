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

/**
 * The base a save sends with its text: SHA-256 of the version the edit was
 * based on, as UTF-8, hex -- what main's textHash gives for the same text.
 * Main refuses the save if the file on disk has become anything else (other
 * than this window's own previous save), so a change made outside Neuron while
 * the save is on its way is not written over. No known version: no base, and
 * nothing is compared.
 */
export async function contentHash(text: string | null | undefined): Promise<string | undefined> {
  if (text === null || text === undefined) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Sends each file's saves in the order they were made, each with the hash of
 * its base. Hashing is asynchronous and need not finish in order, and main
 * writes a file's saves in the order they arrive: without this, a quick second
 * save could reach main first and the older text land last. `send` must make
 * its call synchronously.
 */
export function createSaveSender(hash: (text: string | null | undefined) => Promise<string | undefined> = contentHash) {
  const issued = new Map<string, Promise<void>>();
  return function sendSave<T>(path: string, baseText: string | null | undefined, send: (base: string | undefined) => Promise<T>): Promise<T> {
    const hashed = hash(baseText);
    let result!: Promise<T>;
    const turn = (issued.get(path) ?? Promise.resolve()).then(() => hashed).then((base) => { result = send(base); });
    const tail = turn.catch(() => undefined);
    issued.set(path, tail);
    void tail.then(() => { if (issued.get(path) === tail) issued.delete(path); });
    return turn.then(() => result);
  };
}

/** The window's one sender: the editor groups and the table writers save through it alike. */
export const sendSave = createSaveSender();
