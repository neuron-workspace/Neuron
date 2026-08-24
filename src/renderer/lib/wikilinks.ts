/**
 * Resolving `[[Note name]]` to a note in the workspace.
 *
 * Shared because both the reading view and the live editor render wiki-links,
 * and a link that resolves in one and not the other is the same bug in a new
 * place. It was written out twice first; two copies of a matching rule drift,
 * which is how this repository once shipped a package with placeholder Store
 * identity in it.
 */

export interface WikiIndex {
  /** path-without-extension, lowercased -> the real note path */
  exact: Map<string, string>;
  /** basename, lowercased -> the note path, or null when two notes share it */
  basenames: Map<string, string | null>;
}

/**
 * `examples/demo-repo/guides/wikilinks-and-tags.mdx` documents the rule: a
 * wiki-link matches a note by its path without the extension, and a note in a
 * folder is linked by its full path. Matching is case-insensitive, because a
 * link that fails on capitalisation reads as a broken feature rather than a
 * typo.
 */
export function buildWikiIndex(notes: readonly string[]): WikiIndex {
  const exact = new Map<string, string>();
  const basenames = new Map<string, string | null>();
  for (const note of notes) {
    const withoutExtension = note.replace(/\.[^./]+$/, '').toLowerCase();
    exact.set(withoutExtension, note);
    const basename = withoutExtension.split('/').pop()!;
    // Second note with this basename makes it ambiguous, and an ambiguous
    // link is treated as missing rather than resolved to whichever note
    // happened to be indexed first.
    basenames.set(basename, basenames.has(basename) ? null : note);
  }
  return { exact, basenames };
}

/** The note this target points at, or null if there is no unambiguous one. */
export function resolveWikiLink(index: WikiIndex, target: string): string | null {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  return index.exact.get(normalized) ?? index.basenames.get(normalized) ?? null;
}
