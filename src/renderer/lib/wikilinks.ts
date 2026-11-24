/**
 * Resolving `[[Note name]]` to a file in the workspace, the way Obsidian does.
 *
 * One resolver for every place a link is read: the reading view and the live
 * editor (the pill, missing or not, and what a click opens), the graph's edges
 * and so the local graph's backlinks, the `[[` autocomplete, and the rewrites
 * that keep links pointing where they did after a rename or a new duplicate.
 * Two copies of a matching rule drift, which is how this repository once
 * shipped a package with placeholder Store identity in it.
 *
 * The rules (`examples/demo-repo/guides/wikilinks-and-tags.mdx`):
 * - `[[Name]]`, with or without the extension, matches every file of that name.
 *   With several, a file in the linking note's own folder wins; otherwise the
 *   one with the fewest folders from the workspace root; otherwise the first
 *   by path. A file's name always beats another note's `aliases:`, which follow
 *   the same tie rules.
 * - `[[Folder/Name]]` is a path link: it matches that path from the root, or a
 *   file whose path ends in it, and never falls back to the bare name.
 *   `[[/Name]]` is a path from the root and nothing else.
 * - Matching is case-insensitive: a link that fails on capitalisation reads as
 *   a broken feature rather than a typo.
 */

export interface WikiIndex {
  /** Every file, as listed. */
  files: readonly string[];
  /** Full path, lowercased, with and without its extension -> files. */
  exact: Map<string, string[]>;
  /** Every path suffix of two or more segments, lowercased, with and without the extension -> files. */
  suffixes: Map<string, string[]>;
  /** File name, lowercased, with and without its extension -> files. */
  names: Map<string, string[]>;
  /** Alias, lowercased -> the notes that declare it. */
  aliases: Map<string, string[]>;
}

const withoutExtension = (name: string) => name.replace(/\.[^./]+$/, '');
/** The folder a path is in, '' at the root. */
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
/** The name a link to this file reads as: its file name without the extension. */
export const linkName = (path: string) => withoutExtension(path.slice(path.lastIndexOf('/') + 1));

function add(map: Map<string, string[]>, key: string, path: string) {
  const list = map.get(key);
  if (!list) map.set(key, [path]);
  else if (!list.includes(path)) list.push(path);
}

/** Both spellings of a key: as written, and without the extension. */
function addBoth(map: Map<string, string[]>, key: string, path: string) {
  add(map, key, path);
  const bare = withoutExtension(key);
  if (bare && bare !== key && !bare.endsWith('/')) add(map, bare, path);
}

/**
 * The index for `files`. `aliases` maps a note's path to the aliases its
 * frontmatter declares (see noteAliases); aliases of a path not in `files` are
 * ignored.
 */
export function buildWikiIndex(files: readonly string[], aliases?: Iterable<readonly [string, readonly string[]]>): WikiIndex {
  const index: WikiIndex = { files, exact: new Map(), suffixes: new Map(), names: new Map(), aliases: new Map() };
  for (const file of files) {
    // Paths are normalised to `/` by main; `\` is split on too so a stray one
    // cannot make a whole path read as a single name.
    const segments = file.toLowerCase().split(/[\\/]/);
    addBoth(index.exact, segments.join('/'), file);
    addBoth(index.names, segments[segments.length - 1], file);
    for (let i = segments.length - 2; i >= 0; i--) addBoth(index.suffixes, segments.slice(i).join('/'), file);
  }
  if (aliases) {
    const known = new Set(files);
    for (const [path, list] of aliases) {
      if (!known.has(path)) continue;
      for (const alias of list) {
        const key = alias.trim().toLowerCase();
        if (key && !key.includes('/')) add(index.aliases, key, path);
      }
    }
  }
  return index;
}

/** Alphabetical by path, the same on every machine. */
function byPath(a: string, b: string) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/** The tie rules: same folder as the linking note, then fewest folders, then by path. */
function pick(candidates: readonly string[] | undefined, from: string | null | undefined): string | null {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  let pool = [...candidates];
  if (typeof from === 'string') {
    const here = folderOf(from);
    const same = pool.filter((path) => folderOf(path) === here);
    if (same.length) pool = same;
  }
  const depth = (path: string) => path.split('/').length;
  const fewest = Math.min(...pool.map(depth));
  return pool.filter((path) => depth(path) === fewest).sort(byPath)[0];
}

/**
 * The file this target points at from the note `from` (a workspace-relative
 * path; omitted, no folder is preferred), or null. `target` is the part of the
 * link before `#` and `|` (see parseWikiLink).
 */
export function resolveWikiLink(index: WikiIndex, target: string, from?: string | null): string | null {
  const normalized = target.trim().replace(/\\/g, '/').toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('/')) return pick(index.exact.get(normalized.replace(/^\/+/, '')), from);
  if (normalized.includes('/')) return pick(index.exact.get(normalized) ?? index.suffixes.get(normalized), from);
  return pick(index.names.get(normalized), from) ?? pick(index.aliases.get(normalized), from);
}

export interface WikiLinkParts {
  /** What the link points at. */
  target: string;
  /** `#heading` (with its `#`), or ''. */
  heading: string;
  /** The text after `|`, or null when there is none. */
  label: string | null;
}

/** The inside of `[[...]]`, split into target, `#heading` and `|label`. */
export function parseWikiLink(inner: string): WikiLinkParts {
  const bar = inner.indexOf('|');
  const head = bar < 0 ? inner : inner.slice(0, bar);
  const label = bar < 0 ? null : inner.slice(bar + 1);
  const hash = head.indexOf('#');
  return { target: (hash < 0 ? head : head.slice(0, hash)).trim(), heading: hash < 0 ? '' : head.slice(hash).trim(), label };
}

/** The candidates a path-form target matches, as resolveWikiLink would look them up. */
function pathCandidates(index: WikiIndex, target: string): string[] {
  const key = target.toLowerCase();
  if (key.startsWith('/')) return index.exact.get(key.slice(1)) ?? [];
  return index.exact.get(key) ?? index.suffixes.get(key) ?? [];
}

/**
 * The shortest target that reaches `note` from `from`: its bare name when that
 * resolves there, otherwise its shortest unique path suffix (`Folder/Name`, or
 * `/Name` for a note at the root), and the full path when nothing shorter is
 * unique. `bare` says which.
 */
export function shortestTarget(index: WikiIndex, note: string, from: string | null, allowBare = true): { target: string; bare: boolean } {
  const segments = note.split('/');
  const file = segments.pop()!;
  const stem = withoutExtension(file);
  if (allowBare) {
    for (const name of [stem, file]) if (resolveWikiLink(index, name, from) === note) return { target: name, bare: true };
  }
  const tries: string[] = [];
  for (let k = 1; k <= segments.length; k++) {
    const folder = segments.slice(-k).join('/');
    tries.push(`${folder}/${stem}`, `${folder}/${file}`);
  }
  tries.push(`/${segments.length ? segments.join('/') + '/' : ''}${stem}`, `/${note}`);
  for (const target of tries) {
    const found = pathCandidates(index, target);
    if (found.length === 1 && found[0] === note) return { target, bare: false };
  }
  return { target: `/${note}`, bare: false };
}

/**
 * What `[[` autocomplete writes between the brackets for `note`, typed in
 * `from`: the bare name when it resolves there, else the shortest unique path
 * written `Folder/Name|Name` so the text still reads as the name.
 */
export function wikiLinkText(index: WikiIndex, note: string, from: string | null): string {
  const { target, bare } = shortestTarget(index, note, from);
  return bare ? target : `${target}|${linkName(note)}`;
}

const ALIAS_KEY = /^(aliases|alias)\s*:/m;

/**
 * The aliases a note's frontmatter declares (`aliases:` as a list or a single
 * string; `alias:` too). Read without a YAML parser: this runs over every note
 * whenever the index is built, and only these two shapes matter.
 */
export function noteAliases(content: string): string[] {
  const text = content.startsWith('﻿') ? content.slice(1) : content;
  if (!/^---\r?\n/.test(text)) return [];
  const end = text.search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end < 0) return [];
  const block = text.slice(text.indexOf('\n') + 1, end);
  if (!ALIAS_KEY.test(block)) return [];
  const lines = block.split(/\r?\n/);
  const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(?:aliases|alias)\s*:(.*)$/.exec(lines[i]);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline.startsWith('[')) {
      for (const item of inline.replace(/^\[|\]$/g, '').split(',')) if (unquote(item)) result.push(unquote(item));
    } else if (inline && !inline.startsWith('#')) {
      result.push(unquote(inline));
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s+(.*)$/.exec(lines[j]);
        if (!item) { if (/^\S/.test(lines[j])) break; continue; }
        if (unquote(item[1])) result.push(unquote(item[1]));
      }
    }
  }
  return [...new Set(result)];
}

const aliasCache = new Map<string, { content: string; aliases: string[] }>();

/** The aliases of every note, for buildWikiIndex. Remembered per path while its content is unchanged. */
export function aliasesOf(notes: readonly { path: string; content: string }[]): [string, string[]][] {
  const result: [string, string[]][] = [];
  for (const note of notes) {
    if (!/\.mdx?$/i.test(note.path)) continue;
    let cached = aliasCache.get(note.path);
    if (!cached || cached.content !== note.content) {
      cached = { content: note.content, aliases: noteAliases(note.content) };
      aliasCache.set(note.path, cached);
    }
    if (cached.aliases.length) result.push([note.path, cached.aliases]);
  }
  if (aliasCache.size > notes.length * 2 + 100) aliasCache.clear();
  return result;
}

/** A workspace-relative path for a Markdown link's href from `source`, or null when it climbs out. */
export function relativeLinkPath(source: string, href: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(href).replace(/\\/g, '/'); } catch { return null; }
  const parts = decoded.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/**
 * The file a Markdown link's href (without its `#fragment`) reaches from
 * `source`: relative to the note first, then from the workspace root, then by
 * name the way a wiki-link would.
 */
export function resolveMarkdownLink(index: WikiIndex, href: string, source: string | null): string | null {
  const target = href.trim();
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
  const exact = (path: string | null) => {
    if (!path) return null;
    const found = index.exact.get(path.toLowerCase())?.filter((file) => file.toLowerCase() === path.toLowerCase()) ?? [];
    return found.find((file) => file === path) ?? found[0] ?? null;
  };
  const relative = relativeLinkPath(source ?? '', target);
  const found = exact(relative) ?? exact(relativeLinkPath('', target));
  if (found) return found;
  let decoded = target;
  try { decoded = decodeURIComponent(target); } catch { /* as written */ }
  return resolveWikiLink(index, decoded.replace(/\.(md|mdx)$/i, ''), source);
}
