// Path policy for HTMX views: every filesystem operation a view requests is
// resolved and checked here. Workspace-relative paths only; traversal,
// absolute paths, drive letters, null bytes, and symlink escapes are rejected.
// Electron-free so tests can run it in plain Node.

import * as path from 'path';
import * as fs from 'fs';
import { hasGitSegment } from '../repoPath';

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/** A compiled glob: the whole path must match. */
export interface GlobMatcher {
  test(relPath: string): boolean;
}

type GlobToken = { kind: 'char'; ch: string } | { kind: 'one' } | { kind: 'star' } | { kind: 'globstar' };

/**
 * Compile a glob (`Projects/**`, `*.md`, `data/?.csv`) to an anchored matcher.
 * `**` matches anything, `**\/` also zero folders, `*` any run within one
 * folder name, `?` one character other than `/`; everything else is literal.
 *
 * Not a RegExp: globs also come from a view's own query string, and a
 * backtracking regex built from one (`a?a?a?...` or `*a*a*a...`) can hold the
 * main thread for minutes. This runs every possible position at once, so a
 * test costs at most pattern length x path length steps.
 */
export function compileGlob(pattern: string): GlobMatcher {
  const tokens: GlobToken[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') i++; // `**/` also matches zero directories
        tokens.push({ kind: 'globstar' });
      } else {
        tokens.push({ kind: 'star' });
      }
    } else if (c === '?') {
      tokens.push({ kind: 'one' });
    } else {
      tokens.push({ kind: 'char', ch: CASE_INSENSITIVE ? c.toLowerCase() : c });
    }
  }
  const end = tokens.length;
  // A star may match nothing, so reaching it also reaches whatever follows it.
  const close = (states: Uint8Array) => {
    for (let t = 0; t < end; t++) {
      if (states[t] && (tokens[t].kind === 'star' || tokens[t].kind === 'globstar')) states[t + 1] = 1;
    }
  };
  return {
    test(relPath: string): boolean {
      let states = new Uint8Array(end + 1);
      states[0] = 1;
      close(states);
      for (let i = 0; i < relPath.length; i++) {
        const ch = CASE_INSENSITIVE ? relPath[i].toLowerCase() : relPath[i];
        const next = new Uint8Array(end + 1);
        let alive = false;
        for (let t = 0; t < end; t++) {
          if (!states[t]) continue;
          const token = tokens[t];
          if (token.kind === 'globstar' || (token.kind === 'star' && ch !== '/')) { next[t] = 1; alive = true; }
          else if ((token.kind === 'one' && ch !== '/') || (token.kind === 'char' && token.ch === ch)) { next[t + 1] = 1; alive = true; }
        }
        if (!alive) return false;
        close(next);
        states = next;
      }
      return states[end] === 1;
    },
  };
}

export function compilePolicy(patterns: string[]): GlobMatcher[] {
  return patterns.map(compileGlob);
}

export function policyAllows(policy: GlobMatcher[], relPath: string): boolean {
  return policy.some((re) => re.test(relPath));
}

/**
 * Normalize an untrusted workspace-relative path to posix form, or null if it
 * is not a plain relative path (absolute, drive-lettered, UNC, traversal,
 * home shortcut, null byte, or empty after normalization).
 */
export function normalizeRel(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024) return null;
  if (input.includes('\0') || input.includes('%00')) return null;
  const p = input.replace(/\\/g, '/');
  if (p.startsWith('~') || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith('//')) return null;
  const segments: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null; // no traversal, even if it would stay inside
    segments.push(seg);
  }
  if (segments.length === 0) return null;
  const rel = segments.join('/');
  return hasGitSegment(rel) ? null : rel; // never a repository's internals
}

/** Like normalizeRel but '' (the workspace root) is allowed — for directory listings. */
export function normalizeRelDir(input: unknown): string | null {
  if (input === '' || input === '.' || input === undefined || input === null) return '';
  return normalizeRel(input);
}

/** Real path of the deepest existing ancestor (for symlink-escape detection). */
function realExistingAncestor(fullPath: string): string {
  let cur = fullPath;
  for (;;) {
    if (fs.existsSync(cur)) return fs.realpathSync(cur);
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
}

export interface ResolvedPath {
  /** Absolute filesystem path. */
  full: string;
  /** Normalized posix workspace-relative path (what policies match against). */
  rel: string;
}

/**
 * Resolve an untrusted relative path against the workspace root. Returns null
 * unless the canonical target (following symlinks on every existing ancestor)
 * stays inside the canonical root.
 */
export function resolveInWorkspace(root: string, input: unknown, opts: { allowRootDir?: boolean } = {}): ResolvedPath | null {
  const rel = opts.allowRootDir ? normalizeRelDir(input) : normalizeRel(input);
  if (rel === null) return null;
  const realRoot = fs.realpathSync(root);
  const full = path.resolve(realRoot, rel.split('/').join(path.sep));
  const back = path.relative(realRoot, full);
  if (back.startsWith('..') || path.isAbsolute(back)) return null;
  // Symlink / junction escape: canonicalize the deepest existing ancestor and
  // require it to still be under the canonical root.
  const real = realExistingAncestor(full);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  // Again on the real path: a link or a short name can reach `.git` without spelling it.
  if (hasGitSegment(path.relative(realRoot, real))) return null;
  return { full, rel };
}
