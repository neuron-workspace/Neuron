import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';

/** Invalid addresses fail closed. Mapped IPv6 is classified as its IPv4 address. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (family !== 6 || ip.includes('%')) return true;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const halves = canonical.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left)
    .map((word) => parseInt(word, 16));
  // IPv4 carried in IPv6: mapped (::ffff:a.b.c.d), deprecated compatible
  // (::a.b.c.d, which also covers :: and ::1) and NAT64 (64:ff9b::a.b.c.d).
  const embedsIpv4 = (words.slice(0, 5).every((word) => word === 0) && (words[5] === 0xffff || words[5] === 0))
    || (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0));
  if (embedsIpv4) {
    return isBlockedAddress(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  return (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80
    || (words[0] & 0xff00) === 0xff00;
}

export interface PublicRequest { url: string; method?: string; headers?: Record<string, string>; body?: string }

/** Both directions: a plugin's request body, and the response collected for it. */
export const BODY_LIMIT = 10 * 1024 * 1024;
export const RESPONSE_TOO_LARGE = 'The response was larger than 10 MB.';
export const REQUEST_TOO_LARGE = 'The request body was larger than 10 MB.';
export const REQUEST_TOO_SLOW = 'Network request took longer than 60 seconds.';
/** Injectable so tests need not wait a minute. */
export interface RequestTimeouts { idleMs?: number; totalMs?: number }

interface Deadline { expired: boolean; current: http.ClientRequest | null }

export async function requestPublic(req: PublicRequest, timeouts: RequestTimeouts = {}): Promise<{ status: number; body: string }> {
  // Refused before any lookup or connection.
  if (req.body !== undefined && Buffer.byteLength(req.body) > BODY_LIMIT) throw new Error(REQUEST_TOO_LARGE);
  // The idle timeout never trips on a server that keeps sending, so the whole
  // request -- every redirect hop, DNS included -- also has a deadline.
  const deadline: Deadline = { expired: false, current: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overall = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      deadline.expired = true;
      const error = new Error(REQUEST_TOO_SLOW);
      reject(error);
      deadline.current?.destroy(error);
    }, timeouts.totalMs ?? 60_000);
  });
  try {
    return await Promise.race([followRedirects(req, timeouts.idleMs ?? 30_000, deadline), overall]);
  } finally {
    clearTimeout(timer);
  }
}

async function followRedirects(req: PublicRequest, idleMs: number, deadline: Deadline): Promise<{ status: number; body: string }> {
  let url = new URL(req.url);
  let method = (req.method || 'GET').toUpperCase();
  let body = req.body;
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  // Match fetch's decoded-text contract without negotiating compressed content.
  headers['accept-encoding'] = 'identity';
  for (let hop = 0; hop <= 5; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are allowed.');
    if (url.username || url.password) throw new Error('URL credentials are not allowed.');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await dns.lookup(hostname, { all: true });
    if (deadline.expired) throw new Error(REQUEST_TOO_SLOW);
    if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) throw new Error('Only public network addresses are allowed.');
    const vetted = addresses[0];
    // fetch sent a length for string bodies; keep servers that refuse chunked uploads working.
    if (body !== undefined && headers['content-length'] === undefined && headers['transfer-encoding'] === undefined) {
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    const result = await new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(url, {
        method, headers, agent: false,
        // Keep the URL hostname for Host/TLS, but never resolve it again at connect time.
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [vetted]);
          else callback(null, vetted.address, vetted.family);
        },
      }, (response) => {
        response.on('error', reject);
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          resolve({ status, body: '', location });
          // Its body is never read, and a server that kept sending one would
          // hold this connection open past the deadline.
          request.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > BODY_LIMIT) {
            reject(new Error(RESPONSE_TOO_LARGE));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      });
      deadline.current = request;
      request.on('error', reject);
      request.setTimeout(idleMs, () => request.destroy(new Error('Network request timed out.')));
      request.end(body);
    });
    if (!result.location) return { status: result.status, body: result.body };
    if (hop === 5) throw new Error('Too many redirects.');
    const next = new URL(result.location, url);
    if (next.origin !== url.origin) {
      for (const key of ['authorization', 'proxy-authorization', 'cookie', 'host']) delete headers[key];
    }
    if (((result.status === 301 || result.status === 302) && method === 'POST') || (result.status === 303 && method !== 'HEAD')) {
      method = 'GET';
      body = undefined;
      for (const key of ['content-type', 'content-length', 'transfer-encoding']) delete headers[key];
    }
    url = next;
  }
  throw new Error('Too many redirects.');
}
