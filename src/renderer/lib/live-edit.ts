/** Replace an inclusive body-line range; end < start inserts, [] deletes. */
export function replaceLines(doc: string, fmLineOffset: number, start: number, end: number, replacement: string | string[]): string {
  // Keep untouched lines (including their own line endings) byte-for-byte.
  const lines: string[] = doc.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (!doc || doc.endsWith('\n')) lines.push('');
  const from = fmLineOffset + start;
  const to = Math.min(fmLineOffset + end + 1, lines.length);
  if (!Number.isInteger(from) || !Number.isInteger(to) || start < 0 || end < start - 1 || from > lines.length || fmLineOffset + end > lines.length) {
    throw new RangeError('Invalid body line range');
  }
  const eol = doc.includes('\r\n') ? '\r\n' : '\n';
  const inserted = Array.isArray(replacement) ? replacement.join(eol) : replacement.replace(/\r?\n/g, eol);
  const deleting = Array.isArray(replacement) && replacement.length === 0;
  let before = lines.slice(0, from).join('');
  const after = lines.slice(to).join('');
  if (!deleting && before && !before.endsWith('\n')) before += eol;
  const hadLineEnding = to > from && lines[to - 1]?.endsWith('\n');
  if (deleting && to === lines.length && !hadLineEnding) before = before.replace(/\r?\n$/, '');
  return before + (deleting ? '' : inserted + (to < lines.length || hadLineEnding ? eol : '')) + after;
}

export function splitLinePrefix(line: string): { prefix: string; text: string } {
  const prefix = /^(?:#{1,6} |(?:[-*] )?\[(?: |x|X)?\]\s*|[-*] |\d+\. |> )/.exec(line)?.[0] ?? '';
  return { prefix, text: line.slice(prefix.length) };
}

export function nextLinePrefix(prefix: string): string {
  if (/^\d+\. $/.test(prefix)) return String(Number.parseInt(prefix, 10) + 1) + '. ';
  if (/^[-*] /.test(prefix)) return prefix.replace(/\[[xX]\]/, '[ ]');
  return '';
}

/** Enough of DOM Node for browser use and dependency-free unit tests. */
export interface MarkdownNode {
  nodeType: number;
  tagName?: string;
  textContent: string | null;
  childNodes: ArrayLike<MarkdownNode>;
  dataset?: { md?: string };
}

/** Serialize the contents of an editable region; null means unsupported DOM. */
export function serializeInline(root: MarkdownNode): string | null {
  const children = Array.from(root.childNodes);
  // Chromium leaves a lone BR after deleting all text in a contenteditable.
  if (children.length === 1 && children[0].tagName === 'BR' && children[0].dataset?.md === undefined) return '';
  let result = '';
  for (const node of children) {
    if (node.nodeType === 3) { result += node.textContent ?? ''; continue; }
    if (node.dataset?.md !== undefined) { result += node.dataset.md; continue; }
    const tag = node.tagName?.toLowerCase();
    const marker = tag === 'strong' || tag === 'b' ? '**' : tag === 'em' || tag === 'i' ? '*' : tag === 'del' || tag === 's' ? '~~' : null;
    if (marker === null) return null;
    const inner = serializeInline(node);
    if (inner === null) return null;
    if (inner) result += marker + inner + marker;
  }
  return result;
}

export function canRoundTrip(root: MarkdownNode, source: string): boolean {
  return serializeInline(root) === source;
}
