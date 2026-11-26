// `.neuron/sync-ignore`: this device's own exclusions, in a subset of gitignore
// syntax. Blank lines and `#` comments are skipped; `!` re-includes; a leading
// or inner `/` anchors to the workspace root, otherwise a pattern matches at any
// depth; a trailing `/` matches folders only; `*` and `?` stay inside one path
// segment and `**` crosses segments. The last matching line wins. Matching is
// case-insensitive: excluding a little more is safe, since an excluded path is
// neither sent nor received and is never deleted on other devices.
// ponytail: no character classes or escapes; add them if someone needs them.

export const IGNORE_FILE = '.neuron/sync-ignore';
const MAX_BYTES = 64 * 1024;
const MAX_RULES = 1000;
const MAX_PATTERN = 1024;
const MAX_WILDCARDS = 16; // bounds regex backtracking

interface Rule { negate: boolean; re: RegExp; source: string }

function compile(line: string): Rule | null {
  let p = line.replace(/\s+$/, '');
  if (!p || p.startsWith('#')) return null;
  const negate = p.startsWith('!');
  if (negate) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.replace(/\/+$/, '');
  const anchored = p.startsWith('/') || p.includes('/');
  p = p.replace(/^\/+/, '');
  if (!p || p.length > MAX_PATTERN || (p.match(/[*?]/g)?.length ?? 0) > MAX_WILDCARDS) return null;
  let body = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      const slashAfter = p[i + 2] === '/';
      body += slashAfter ? '(?:.*/)?' : '.*';
      i += slashAfter ? 2 : 1;
    } else if (c === '*') body += '[^/]*';
    else if (c === '?') body += '[^/]';
    else body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A pattern names the path itself or a folder above it; `dir/` only a folder.
  const re = new RegExp(`${anchored ? '^' : '^(?:.*/)?'}${body}${dirOnly ? '/.*' : '(?:/.*)?'}$`, 'i');
  return { negate, re, source: line.trim() };
}

/** A matcher for one ignore file's text. Over the limits, the extra is dropped and reported. */
export function parseIgnore(text: string): { match: (path: string) => string | null; dropped: number } {
  const bounded = text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
  const lines = bounded.split(/\r?\n/);
  const rules: Rule[] = [];
  let dropped = text.length > MAX_BYTES ? 1 : 0;
  for (const line of lines) {
    const rule = compile(line);
    if (!rule) { if (line.trim() && !line.trim().startsWith('#')) dropped++; continue; }
    if (rules.length >= MAX_RULES) { dropped++; continue; }
    rules.push(rule);
  }
  return {
    dropped,
    match(path: string): string | null {
      let hit: Rule | null = null;
      for (const rule of rules) if (rule.re.test(path)) hit = rule.negate ? null : rule;
      return hit ? `ignored by ${IGNORE_FILE} (${hit.source})` : null;
    },
  };
}
