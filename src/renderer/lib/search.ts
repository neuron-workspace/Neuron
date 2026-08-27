// Searching the workspace, not just its filenames.
//
// Search used to be `notes.filter((n) => n.includes(query))` over paths, so a
// word you knew you had written was unfindable unless it happened to be in the
// filename. Note bodies are already in memory — the workspace is a folder of
// text files and the app has read all of them — so this needs no index and no
// dependency, just a scoring pass.
//
// If a workspace ever grows past what a linear scan can take per keystroke, the
// replacement is an inverted index (MiniSearch) or ripgrep in the main process.
// The shape of `searchNotes` is what those would slot behind.

export interface SearchMatch {
  /** 1-based, so it can be shown to a person. */
  line: number;
  text: string;
}

export interface SearchHit {
  path: string;
  score: number;
  /** Whether the name matched, which is worth saying in the UI. */
  titleMatch: boolean;
  matches: SearchMatch[];
}

export interface SearchOptions {
  limit?: number;
  /** Snippets to keep per note. */
  snippets?: number;
}

interface Note {
  path: string;
  content: string;
}

/** Filename without its directory or extension. */
function basename(path: string): string {
  const last = path.split(/[/\\]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, '');
}

/**
 * Terms are whitespace-separated and matched with AND.
 *
 * AND rather than OR because a second word is how a person narrows a search.
 * Under OR, typing more would return more, which is the opposite of what the
 * typing was for.
 */
function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

// Deliberately coarse. The job is to put the note you meant near the top, not to
// be defensible to three decimal places.
const SCORE = {
  exactName: 40,
  nameContains: 12,
  pathContains: 4,
  heading: 3,
  bodyOccurrence: 1,
  /** Past this, more mentions of the same word stop meaning more relevance. */
  bodyCap: 5,
};

export function searchNotes(notes: readonly Note[], rawQuery: string, options: SearchOptions = {}): SearchHit[] {
  const wanted = terms(rawQuery);
  if (wanted.length === 0) return [];

  const limit = options.limit ?? 200;
  const snippetCount = options.snippets ?? 3;
  const hits: SearchHit[] = [];

  for (const note of notes) {
    const lowerPath = note.path.toLowerCase();
    const lowerName = basename(note.path).toLowerCase();
    const lowerBody = note.content.toLowerCase();

    // Every term has to appear somewhere in this note.
    if (!wanted.every((t) => lowerName.includes(t) || lowerPath.includes(t) || lowerBody.includes(t))) continue;

    let score = 0;
    let titleMatch = false;

    for (const term of wanted) {
      if (lowerName === term) { score += SCORE.exactName; titleMatch = true; }
      else if (lowerName.includes(term)) { score += SCORE.nameContains; titleMatch = true; }
      if (lowerPath.includes(term) && !lowerName.includes(term)) score += SCORE.pathContains;
      score += Math.min(countOccurrences(lowerBody, term), SCORE.bodyCap) * SCORE.bodyOccurrence;
    }

    // Headings are what a note says it is about, so a match there outranks the
    // same word buried in a paragraph.
    const lines = note.content.split(/\r?\n/);
    const matches: SearchMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      if (!wanted.some((t) => lower.includes(t))) continue;
      if (/^\s{0,3}#{1,6}\s/.test(line)) score += SCORE.heading;
      if (matches.length < snippetCount) matches.push({ line: i + 1, text: line.trim() });
    }

    hits.push({ path: note.path, score, titleMatch, matches });
  }

  // Score first; ties broken by path so the order never wobbles between renders.
  hits.sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

/** Just the paths, for callers that only need to filter something by them. */
export function searchPaths(notes: readonly Note[], rawQuery: string, options?: SearchOptions): string[] {
  return searchNotes(notes, rawQuery, options).map((hit) => hit.path);
}
