import { timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { resolveInside, realpathInside } from './repoPath';
import { extensionOf, fileKind, MEDIA_KINDS } from './file-kinds';

// neuron-file:// serves workspace images, video and audio to the app's own
// windows, so <img>, <video> and <audio> can stream them (with seeking)
// instead of carrying whole files over IPC.
//
//   neuron-file://w/<windowId>/<token>/<encodeURIComponent(relative path)>
//
// The token is minted per window when it is created and is only ever handed
// to that window's main frame. A request cannot say who sent it, so the token
// is what proves it came from that window: a view or browser webview runs in
// its own session, where this scheme is not registered at all, and could not
// guess the token if it were.

export const FILE_SCHEME = 'neuron-file';

export const MEDIA_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
};

/** Sent with every response; the CSP is what keeps an SVG inert even if it were ever navigated to. */
export const FILE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'Cache-Control': 'no-cache',
} as const;

export type FileWindowLookup = (windowId: number) => { token: string; repo: string | null } | null;
export type FileDecision = { ok: true; fullPath: string; mime: string; relativePath: string } | { ok: false };

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Whether a neuron-file:// URL may be served, and from where on disk.
 *
 * The window must exist and have a workspace, the token must be that
 * window's, the path must resolve inside that window's workspace (the same
 * guard as every notes:* handler), and the file must be an image, video or
 * audio file. Anything else is refused; the caller answers 403.
 */
export function authorizeFileUrl(url: string, lookup: FileWindowLookup, resolve = resolveInRepo): FileDecision {
  const deny = { ok: false } as const;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return deny; }
  if (parsed.protocol !== FILE_SCHEME + ':' || parsed.hostname !== 'w' || parsed.port || parsed.username || parsed.password || parsed.search) return deny;
  const parts = parsed.pathname.split('/');
  if (parts.length !== 4 || parts[0] !== '') return deny;
  const [, idText, token, encoded] = parts;
  if (!/^\d{1,9}$/.test(idText)) return deny;
  const entry = lookup(Number(idText));
  if (!entry || !entry.repo || !sameToken(token, entry.token)) return deny;
  let relativePath: string;
  try { relativePath = decodeURIComponent(encoded); } catch { return deny; }
  if (!relativePath || !MEDIA_KINDS.includes(fileKind(relativePath))) return deny;
  const mime = MEDIA_MIME[extensionOf(relativePath)];
  if (!mime) return deny;
  const fullPath = resolve(entry.repo, relativePath);
  return fullPath ? { ok: true, fullPath, mime, relativePath } : deny;
}

function resolveInRepo(repo: string, relativePath: string): string | null {
  const fullPath = resolveInside(repo, relativePath);
  return fullPath && realpathInside(repo, fullPath) ? fullPath : null;
}

/**
 * The answer to a neuron-file:// request: the file streamed from disk, never
 * read whole, so an image or video of any size costs the main process a
 * buffer, not the file. 403 for anything refused (wrong method, token, path or
 * kind), 404 for a missing file, 416 for a range past the end, 206 for a range.
 * HEAD answers the same headers with no body.
 */
export async function respondWithFile(request: Request, lookup: FileWindowLookup): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 403 });
  const decision = authorizeFileUrl(request.url, lookup);
  if (!decision.ok) return new Response(null, { status: 403 });
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(decision.fullPath); } catch { return new Response(null, { status: 404 }); }
  if (!stat.isFile()) return new Response(null, { status: 403 });
  const headers: Record<string, string> = { ...FILE_HEADERS, 'Content-Type': decision.mime, 'Accept-Ranges': 'bytes' };
  const range = parseRange(request.headers.get('range'), stat.size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
  const start = range ? range.start : 0;
  const end = range ? range.end : stat.size - 1;
  const length = Math.max(0, end - start + 1);
  headers['Content-Length'] = String(length);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  const body = request.method === 'HEAD' || length === 0
    ? null
    : Readable.toWeb(fs.createReadStream(decision.fullPath, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}

/**
 * A single `Range: bytes=...` request against a file of `size` bytes.
 *
 * null: no range, or one this does not handle (malformed, several ranges);
 * send the whole file. 'unsatisfiable': answer 416.
 */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] && Number(match[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 };
}
