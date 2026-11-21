/**
 * Finding links in a note, and rewriting the ones a rename, a move or a new
 * duplicate name would send somewhere else, so every link still reaches the
 * file it reached before. Pure: the caller reads the notes and writes the result.
 */
import {
  linkName, parseWikiLink, relativeLinkPath, resolveMarkdownLink, resolveWikiLink, shortestTarget, type WikiIndex,
} from './wikilinks';

export interface LinkMatch {
  kind: 'wiki' | 'markdown';
  embed: boolean;
  /** Offsets into the note of what a rewrite replaces: the inside of `[[...]]`, or the href. */
  start: number;
  end: number;
  /** That text. */
  text: string;
  /** An href written in `<...>`. */
  angled?: boolean;
}

const LINK = /(!?)\[\[([^\]\n]+)\]\]|(!?)\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g;

/**
 * Every wiki-link and Markdown link in `content`, outside fenced and inline
 * code: code examples are not links.
 */
export function findLinks(content: string): LinkMatch[] {
  const result: LinkMatch[] = [];
  let fence = '';
  let offset = 0;
  for (const raw of content.split('\n')) {
    const lineStart = offset;
    offset += raw.length + 1;
    const line = raw.replace(/\r$/, '');
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && /^\s*$/.test(fenceMatch[2])) fence = '';
      continue;
    }
    if (fenceMatch && (fenceMatch[1][0] === '~' || !fenceMatch[2].includes('`'))) { fence = fenceMatch[1]; continue; }
    // Inline code blanked to the same length, so offsets still match the line.
    const prose = line.replace(/`[^`\n]*`/g, (code) => ' '.repeat(code.length));
    for (const match of prose.matchAll(LINK)) {
      const at = lineStart + match.index!;
      if (match[2] !== undefined) {
        const start = at + match[1].length + 2;
        result.push({ kind: 'wiki', embed: !!match[1], start, end: start + match[2].length, text: match[2] });
      } else {
        const href = match[4];
        const inner = match[0].lastIndexOf(href);
        const angled = href.startsWith('<') && href.endsWith('>');
        const start = at + inner + (angled ? 1 : 0);
        const text = angled ? href.slice(1, -1) : href;
        result.push({ kind: 'markdown', embed: !!match[3], start, end: start + text.length, text, angled });
      }
    }
  }
  return result;
}

/** `path` after moving `from` (a file or a folder) to `to`, or null when the move does not touch it. */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(from + '/')) return to + path.slice(from.length);
  return null;
}

/** The href from `source` to `target`, as a relative path. */
export function relativeHref(source: string, target: string): string {
  const from = source.split('/').slice(0, -1);
  const to = target.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
}

const encodeHref = (path: string) => path.split('/').map((segment) => encodeURIComponent(segment).replace(/%2B/g, '+')).join('/');

export interface LinkRewritePlan {
  /** Each note to write, at its path after the change, with its new content. */
  edits: { path: string; content: string }[];
  /** Links rewritten, over every note. */
  count: number;
  /** The files the rewritten links point to, in the order first met. */
  targets: string[];
}

/**
 * The links to rewrite when the workspace goes from `before` to `after`.
 *
 * `notes` are read at their paths before the change. `move` maps a path before
 * to its path after (null when it stays put); without one the change only adds
 * files, which is the new-duplicate case.
 *
 * A link is rewritten when it resolved before and, read the same way in its
 * note's new place, would now reach anything but where its old target went.
 * Path links and Markdown links change only when their file or their target
 * moved; a bare `[[Name]]` changes whenever a new file would take it. Links in
 * code are never touched, and `#heading`, `|label` and `![[embed]]` are kept.
 */
export function planLinkRewrites({ notes, before, after, move = () => null }: {
  notes: readonly { path: string; content: string }[];
  before: WikiIndex;
  after: WikiIndex;
  move?: (path: string) => string | null;
}): LinkRewritePlan {
  const plan: LinkRewritePlan = { edits: [], count: 0, targets: [] };
  const aimed = (path: string) => { if (!plan.targets.includes(path)) plan.targets.push(path); };
  for (const note of notes) {
    if (!/\.mdx?$/i.test(note.path)) continue;
    const oldSource = note.path;
    const newSource = move(oldSource) ?? oldSource;
    const sourceMoved = newSource !== oldSource;
    const replacements: { start: number; end: number; text: string }[] = [];
    for (const link of findLinks(note.content)) {
      if (link.kind === 'wiki') {
        const parts = parseWikiLink(link.text);
        const was = resolveWikiLink(before, parts.target, oldSource);
        if (!was) continue;
        const expected = move(was) ?? was;
        const pathLink = parts.target.includes('/') || parts.target.includes('\\');
        if (pathLink && expected === was && !sourceMoved) continue;
        if (resolveWikiLink(after, parts.target, newSource) === expected) continue;
        const { target, bare } = shortestTarget(after, expected, newSource);
        const label = parts.label ?? (bare ? null : linkName(expected));
        aimed(expected);
        replacements.push({ start: link.start, end: link.end, text: target + parts.heading + (label === null ? '' : '|' + label) });
      } else {
        const hash = link.text.indexOf('#');
        const href = hash < 0 ? link.text : link.text.slice(0, hash);
        const fragment = hash < 0 ? '' : link.text.slice(hash);
        if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
        const was = resolveMarkdownLink(before, href, oldSource);
        if (!was) continue;
        const expected = move(was) ?? was;
        if (expected === was && !sourceMoved) continue;
        if (resolveMarkdownLink(after, href, newSource) === expected) continue;
        const relative = href.startsWith('/') ? '/' + expected : relativeHref(newSource, expected);
        // Still the same file by the old spelling: nothing to write.
        if (relativeLinkPath(newSource, href) === expected) continue;
        aimed(expected);
        replacements.push({ start: link.start, end: link.end, text: (link.angled ? relative : encodeHref(relative)) + fragment });
      }
    }
    if (!replacements.length) continue;
    let content = note.content;
    for (const change of replacements.sort((a, b) => b.start - a.start)) content = content.slice(0, change.start) + change.text + content.slice(change.end);
    plan.edits.push({ path: newSource, content });
    plan.count += replacements.length;
  }
  return plan;
}

/** "Updated 3 links so they still point to Folder/Name." */
export function linkNotice(count: number, target: string): string {
  return `Updated ${count} link${count === 1 ? '' : 's'} so they still point to ${target.replace(/\.(md|mdx)$/i, '')}.`;
}
