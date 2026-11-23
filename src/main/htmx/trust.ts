// Trust for HTML views is bound to content (7B). A view is trusted as one exact
// version: its HTML file, its manifest, and every workspace file the view
// server would serve to it as code or style. Change any of them and the view
// asks again; the server refuses a changed file even under a running view.
//
// The set is exactly what server.ts serves from the workspace to a view:
//   - the view document itself (GET /views/{sid}/document),
//   - its manifest, the one loadManifest() reads (primary, else legacy),
//   - every .neuron/styles/<name>.css (GET /views/{sid}/styles/<name>.css),
//   - every .neuron/fragments/<name>.html (GET /api/v1/fragments/<name>);
//     htmx runs <script> tags in a swapped fragment, so a fragment is code.
// Not in it: htmx.js, neuron.js and neuron.css (bundled with Neuron, not
// workspace files), .neuron/variables.json (data: every value is HTML-escaped
// where it is interpolated), and file/API reads (JSON data the view asked for).
//
// Electron-free so the unit suite can run it in plain Node.

import * as fs from 'fs';
import { createHash } from 'crypto';
import { resolveInWorkspace } from './pathPolicy';
import { manifestPathFor, legacyManifestPathFor } from './appPaths';

export const MAX_DOC_BYTES = 2 * 1024 * 1024;     // view document
export const MAX_STYLE_BYTES = 256 * 1024;        // one custom stylesheet
export const MAX_FRAGMENT_BYTES = 128 * 1024;     // one fragment template
const MAX_MANIFEST_BYTES = 256 * 1024;
/** Per folder. Files past this are neither hashed nor served. */
const MAX_DIR_FILES = 1000;

/** Names the server accepts, so the set holds exactly what it can serve. */
export const STYLE_NAME = /^[A-Za-z0-9 _.-]+\.css$/;
export const FRAGMENT_NAME = /^[A-Za-z0-9_-]{1,64}\.html$/;

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/** Map key for a workspace path; one spelling per file on a case-insensitive disk. */
export function trustKey(rel: string): string {
  return CASE_INSENSITIVE ? rel.toLowerCase() : rel;
}

export interface TrustSnapshot {
  /** SHA-256 over every path in the set and its content hash, in a stable order. */
  contentHash: string;
  /** trustKey(rel) -> SHA-256 of the file's bytes, for each file the server may serve. */
  files: Map<string, string>;
  /** The workspace-relative paths that were hashed, sorted. */
  paths: string[];
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Read a plain file up to `limit` bytes through one open handle, so the size
 * check and the read see the same file (no swap between a stat and a read).
 */
function readLimited(full: string, limit: number): Buffer | 'not-a-file' | { tooLarge: number } {
  const fd = fs.openSync(full, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return 'not-a-file';
    if (stat.size > limit) return { tooLarge: stat.size };
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** The manifest loadManifest() would read for this view, if any. */
export function activeManifestPath(root: string, viewRel: string): string | null {
  for (const rel of [manifestPathFor(viewRel), legacyManifestPathFor(viewRel)]) {
    const resolved = resolveInWorkspace(root, rel);
    if (resolved && fs.existsSync(resolved.full)) return resolved.rel;
  }
  return null;
}

function listServable(root: string, dirRel: string, pattern: RegExp): string[] {
  const dir = resolveInWorkspace(root, dirRel);
  if (!dir) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir.full, { withFileTypes: true }); } catch { return []; }
  // Plain files only: a link is never followed into the trusted set.
  return entries
    .filter((e) => e.isFile() && pattern.test(e.name))
    .map((e) => `${dirRel}/${e.name}`)
    .sort()
    .slice(0, MAX_DIR_FILES);
}

/** The workspace files that make up this view, sorted, each with its size limit. */
export function trustedFileSet(root: string, viewRel: string): { rel: string; limit: number }[] {
  const out: { rel: string; limit: number }[] = [{ rel: viewRel, limit: MAX_DOC_BYTES }];
  const manifest = activeManifestPath(root, viewRel);
  if (manifest) out.push({ rel: manifest, limit: MAX_MANIFEST_BYTES });
  for (const rel of listServable(root, '.neuron/styles', STYLE_NAME)) out.push({ rel, limit: MAX_STYLE_BYTES });
  for (const rel of listServable(root, '.neuron/fragments', FRAGMENT_NAME)) out.push({ rel, limit: MAX_FRAGMENT_BYTES });
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Hash the view's whole trusted set as it is on disk right now. */
export function computeTrust(root: string, viewRel: string): TrustSnapshot {
  const entries: [string, string][] = [];
  const files = new Map<string, string>();
  for (const { rel, limit } of trustedFileSet(root, viewRel)) {
    const resolved = resolveInWorkspace(root, rel);
    let digest: string;
    try {
      if (!resolved) throw new Error('outside');
      const read = readLimited(resolved.full, limit);
      if (read === 'not-a-file') digest = 'not-a-file';
      // Over its limit the server will not serve it; say so without reading it.
      else if (!Buffer.isBuffer(read)) digest = `too-large:${read.tooLarge}`;
      else {
        digest = sha256Bytes(read);
        files.set(trustKey(rel), digest);
      }
    } catch {
      digest = 'missing';
    }
    entries.push([rel, digest]);
  }
  return {
    // JSON keeps every path and hash unambiguous, whatever characters a name holds.
    contentHash: createHash('sha256').update(JSON.stringify(entries), 'utf-8').digest('hex'),
    files,
    paths: entries.map(([rel]) => rel),
  };
}

/**
 * The bytes of a workspace file the view may run, or null when it is not in
 * the trusted set or no longer matches the version that was trusted.
 */
export function readTrusted(trusted: ReadonlyMap<string, string>, root: string, rel: string, limit: number): Buffer | null {
  const expected = trusted.get(trustKey(rel));
  if (!expected) return null;
  const resolved = resolveInWorkspace(root, rel);
  if (!resolved) return null;
  let bytes: Buffer;
  try {
    const read = readLimited(resolved.full, limit);
    if (!Buffer.isBuffer(read)) return null;
    bytes = read;
  } catch { return null; }
  return sha256Bytes(bytes) === expected ? bytes : null;
}
