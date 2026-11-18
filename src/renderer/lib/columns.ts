// <Columns> and its <Column width="40%"> children: finding the columns in the
// block's text, turning their widths into numbers, and writing dragged widths
// back into the tags. Pure, so the rounding can be tested without a window.

export interface ColumnSegment {
  /** Offset in the block text of the column's `<Column`. */
  tagStart: number;
  /** Offset in the block text of the first character after the open tag's `>`. */
  contentStart: number;
  content: string;
  width: string | undefined;
}

export const MIN_COLUMN = 10;

const OPEN = /<Column\b([^>]*?)(\/?)>/y;

/**
 * The top-level <Column> children of a <Columns> block, in order. A <Columns>
 * nested inside a column keeps its own columns to itself.
 */
export function splitColumns(block: string): ColumnSegment[] {
  const segments: ColumnSegment[] = [];
  const first = block.indexOf('>');
  if (first < 0) return segments;
  let depth = 0;
  let current: { tagStart: number; contentStart: number; width: string | undefined } | null = null;
  const tag = /<(\/?)(Columns?)\b([^>]*?)(\/?)>/g;
  tag.lastIndex = first + 1;
  for (let match = tag.exec(block); match; match = tag.exec(block)) {
    const [whole, closing, name, attrs, selfClosing] = match;
    if (name === 'Columns') {
      if (selfClosing) continue;
      if (closing) { if (depth === 0) break; depth--; } else depth++;
      continue;
    }
    if (depth > 0) continue;
    if (!closing) {
      if (current) continue;
      const width = /\bwidth="([^"]*)"/.exec(attrs)?.[1];
      const at = { tagStart: match.index, contentStart: match.index + whole.length, width };
      if (selfClosing) segments.push({ ...at, content: '' });
      else current = at;
    } else if (current) {
      segments.push({ ...current, content: block.slice(current.contentStart, match.index) });
      current = null;
    }
  }
  return segments;
}

/** A width attribute as a percentage, or undefined when it is not one. */
export function parseWidth(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(value);
  if (!match) return undefined;
  const n = Number(match[1]);
  return n > 0 && n <= 100 ? n : undefined;
}

/**
 * Widths for `count` columns that sum to 100. Columns without a usable width
 * share what the others leave; widths that over- or under-fill are scaled.
 */
export function resolveWidths(raw: readonly (string | undefined)[], count = raw.length): number[] {
  if (count <= 0) return [];
  const given = Array.from({ length: count }, (_, i) => parseWidth(raw[i]));
  const fixed = given.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const free = given.filter((w) => w === undefined).length;
  let widths: number[];
  if (free === 0) widths = given as number[];
  else {
    const share = fixed < 100 ? (100 - fixed) / free : 100 / count;
    widths = given.map((w) => w ?? share);
  }
  const total = widths.reduce((sum, w) => sum + w, 0);
  return widths.map((w) => (w * 100) / total);
}

/** Whole percentages that still sum to exactly 100, by largest remainder. */
export function roundWidths(widths: readonly number[]): number[] {
  if (!widths.length) return [];
  const total = widths.reduce((sum, w) => sum + w, 0) || 1;
  const scaled = widths.map((w) => (w * 100) / total);
  const floors = scaled.map(Math.floor);
  let left = 100 - floors.reduce((sum, w) => sum + w, 0);
  const order = scaled.map((w, i) => ({ i, rest: w - Math.floor(w) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; floors[i]++; left--; }
  return floors;
}

/**
 * Move the divider after column `index` by `delta` percentage points. Only the
 * two columns beside it change, and neither gets narrower than MIN_COLUMN.
 */
export function dragWidths(widths: readonly number[], index: number, delta: number): number[] {
  if (index < 0 || index >= widths.length - 1) return [...widths];
  const pair = widths[index] + widths[index + 1];
  const left = Math.min(pair - MIN_COLUMN, Math.max(MIN_COLUMN, widths[index] + delta));
  const next = [...widths];
  next[index] = left;
  next[index + 1] = pair - left;
  return next;
}

/**
 * The block with each top-level column's width attribute set, in order. A
 * column without one gains it after its tag name; every other byte stays.
 */
export function writeColumnWidths(block: string, widths: readonly number[]): string {
  const segments = splitColumns(block);
  let out = '';
  let from = 0;
  segments.forEach((segment, i) => {
    if (i >= widths.length) return;
    const { tagStart } = segment;
    OPEN.lastIndex = tagStart;
    const match = OPEN.exec(block);
    if (!match) return;
    const attrs = match[1];
    const value = `width="${widths[i]}%"`;
    const nextAttrs = /\bwidth="[^"]*"/.test(attrs) ? attrs.replace(/\bwidth="[^"]*"/, value) : ` ${value}${attrs}`;
    out += block.slice(from, tagStart) + `<Column${nextAttrs}${match[2]}>`;
    from = tagStart + match[0].length;
  });
  return out + block.slice(from);
}
