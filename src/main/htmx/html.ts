// Safe HTML helpers for server-rendered fragments. All untrusted text goes
// through esc(); fragments are built from these helpers, never from raw
// string concatenation of user data.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Deliberately limited `{{ scope.key }}` interpolation for fragments: safe own-
 * property lookup only (no expressions, no prototypes), result HTML-escaped.
 */
export function interpolate(template: string, scopes: Record<string, Record<string, unknown>>): string {
  return template.replace(/\{\{\s*([A-Za-z][\w-]*(?:\.[\w-]+)*)\s*\}\}/g, (_m, expr: string) => {
    const parts = expr.split('.');
    let cur: unknown = scopes;
    for (const part of parts) {
      if (part === '__proto__' || part === 'constructor' || part === 'prototype') return '';
      if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) return '';
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur === null || cur === undefined) return '';
    if (typeof cur === 'object') return esc(JSON.stringify(cur));
    return esc(cur);
  });
}

/**
 * Wrap a user-authored view body in the full served document, always injecting
 * the neuron.css design system, the neuron.js helper and the bundled htmx runtime.
 */
export function wrapDocument(opts: { body: string; title: string; sessionId: string; theme: 'light' | 'dark'; styles: string[] }): string {
  const base = `/views/${opts.sessionId}`;
  const styleLinks = opts.styles
    .map((name) => `  <link rel="stylesheet" href="${base}/styles/${esc(name)}">`)
    .join('\n');
  const head = [
    `  <link rel="stylesheet" href="${base}/neuron.css">`,
    styleLinks,
    `  <script src="${base}/neuron.js"></script>`,
    `  <script src="${base}/htmx.js" defer></script>`,
  ].join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
${head}
</head>
<body class="neuron-view theme-${opts.theme}">
${opts.body}
</body>
</html>`;
}

// --- full documents ------------------------------------------------------------
//
// A view file that is already a whole HTML document is served as written, with
// two script tags and a data-theme attribute added. Finding where to put them
// takes a small scanner rather than a parser: it only has to know which "<head"
// and "<html" are real tags, so it skips comments, the bodies of raw-text
// elements like <script> and <style>, and quoted attribute values.

/** The exact tags added to a full document's head, each only when missing. */
export const DOCUMENT_SCRIPTS = {
  neuron: '<script src="neuron.js"></script>',
  htmx: '<script src="htmx.js" defer></script>',
} as const;

interface ScannedTag { name: string; start: number; end: number; attrs: Map<string, string> }

// Content inside these is text, not markup, so a "<head>" there is not a tag.
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);

/** Attribute names (lowercased) and values from the inside of a start tag. */
function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/**
 * Every start tag outside comments and raw-text bodies, in order. Stops at
 * anything unterminated (an open comment, quote or tag), since what follows
 * cannot be placed with confidence.
 */
function scanTags(html: string): ScannedTag[] {
  const tags: ScannedTag[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?' || html[lt + 1] === '/') {
      const close = html.indexOf('>', lt + 2);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    const nameMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(html.slice(lt + 1, lt + 65));
    if (!nameMatch) { i = lt + 1; continue; }
    const name = nameMatch[0].toLowerCase();
    // Find the tag's closing ">", stepping over quoted attribute values so a
    // ">" inside one does not end the tag early.
    let j = lt + 1 + nameMatch[0].length;
    let end = -1;
    while (j < html.length) {
      const c = html[j];
      if (c === '>') { end = j + 1; break; }
      if (c === '=') {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          if (close < 0) return tags;
          j = close + 1;
          continue;
        }
        continue;
      }
      j++;
    }
    if (end < 0) break;
    tags.push({ name, start: lt, end, attrs: parseAttrs(html.slice(lt + 1 + nameMatch[0].length, end - 1)) });
    i = end;
    if (RAW_TEXT.has(name)) {
      const closeRe = new RegExp(`</${name}[\\s/>]`, 'ig');
      closeRe.lastIndex = end;
      const close = closeRe.exec(html);
      if (!close) break;
      i = close.index;
    }
  }
  return tags;
}

/**
 * Whether a view file is a whole document: after a BOM, whitespace and
 * comments, it starts with <!doctype or <html.
 */
export function isFullDocument(html: string): boolean {
  let i = html.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < html.length && /\s/.test(html[i])) i++;
    if (!html.startsWith('<!--', i)) break;
    const close = html.indexOf('-->', i + 4);
    if (close < 0) return false;
    i = close + 3;
  }
  return /^<!doctype[\s>]/i.test(html.slice(i, i + 10)) || /^<html[\s/>]/i.test(html.slice(i, i + 6));
}

const loadsScript = (tags: ScannedTag[], src: RegExp) =>
  tags.some((t) => t.name === 'script' && src.test(t.attrs.get('src') ?? ''));

/**
 * Prepare a full view document for serving: add neuron.js and htmx.js to its
 * head (each only when the document does not already load it) and data-theme to
 * <html> (only when absent). Nothing is removed or rewritten.
 *
 * Returns null when the file is not a full document, or when no <head> or
 * <html> tag can be found; the caller then wraps it as a fragment.
 */
export function prepareFullDocument(html: string, theme: 'light' | 'dark'): string | null {
  if (!isFullDocument(html)) return null;
  const tags = scanTags(html);
  const bodyAt = tags.find((t) => t.name === 'body')?.start ?? Infinity;
  const htmlTag = tags.find((t) => t.name === 'html' && t.start < bodyAt);
  const headTag = tags.find((t) => t.name === 'head' && t.start < bodyAt);
  if (!htmlTag && !headTag) return null;

  const scripts = (loadsScript(tags, /(?:^|\/)neuron\.js(?:[?#]|$)/i) ? '' : DOCUMENT_SCRIPTS.neuron)
    + (loadsScript(tags, /(?:^|\/)htmx\.js(?:[?#]|$)/i) ? '' : DOCUMENT_SCRIPTS.htmx);

  // Edits are applied from the end of the file backwards so earlier offsets
  // stay valid.
  const edits: { at: number; text: string }[] = [];
  if (headTag) {
    if (scripts) edits.push({ at: headTag.end, text: scripts });
  } else if (htmlTag) {
    edits.push({ at: htmlTag.end, text: `<head>${scripts}` });
  }
  if (htmlTag && !htmlTag.attrs.has('data-theme')) {
    const selfClosing = html[htmlTag.end - 2] === '/';
    edits.push({ at: htmlTag.end - (selfClosing ? 2 : 1), text: ` data-theme="${theme}"` });
  }
  let out = html;
  for (const edit of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  return out;
}

export function errorFragment(message: string): string {
  return `<div class="neuron-alert" role="alert">${esc(message)}</div>`;
}

export interface FileRow { path: string; name: string; size: number; modified: string; directory: boolean }

export function fileListFragment(rows: FileRow[]): string {
  if (rows.length === 0) return '<p class="neuron-empty">No matching files.</p>';
  const items = rows
    .map((r) => `<li class="neuron-list-row"><span class="neuron-file-name">${esc(r.name)}</span><span class="neuron-file-path">${esc(r.path)}</span></li>`)
    .join('\n');
  return `<ul class="neuron-list">\n${items}\n</ul>`;
}

export interface SearchRow { path: string; title: string; snippet: string }

export function searchResultsFragment(rows: SearchRow[], query: string): string {
  if (!query) return '';
  if (rows.length === 0) return `<p class="neuron-empty">No notes match “${esc(query)}”.</p>`;
  const items = rows
    .map((r) => `<li class="neuron-list-row"><span class="neuron-file-name">${esc(r.title)}</span><span class="neuron-snippet">${esc(r.snippet)}</span><span class="neuron-file-path">${esc(r.path)}</span></li>`)
    .join('\n');
  return `<ul class="neuron-list">\n${items}\n</ul>`;
}

export interface NoteRow { path: string; title: string; tags: string[]; modified: string }

export function noteRowsFragment(rows: NoteRow[]): string {
  if (rows.length === 0) return '<p class="neuron-empty">No notes found.</p>';
  const body = rows
    .map((r) => `<tr><td>${esc(r.title)}</td><td>${r.tags.map((t) => `<span class="neuron-badge">${esc(t)}</span>`).join(' ')}</td><td class="neuron-file-path">${esc(r.path)}</td></tr>`)
    .join('\n');
  return `<div class="neuron-scroll"><table class="neuron-table"><thead><tr><th>Note</th><th>Tags</th><th>Path</th></tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}
