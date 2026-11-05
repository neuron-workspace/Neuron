import type { SearchHit } from './search';

interface NoteData {
  path: string;
  content: string;
}

export interface ContextOptions {
  notes: readonly NoteData[];
  maxChars?: number;
  surroundingLines?: number;
}

export interface BuiltContext {
  text: string;
  sources: string[];
}

// 12,000 characters is roughly 3,000 English tokens: enough evidence to be
// useful while reserving most small model windows for instructions, history,
// and the answer. When it binds, each excerpt loses its tail at 2,000 chars;
// first excerpts are shared across distinct notes before extra excerpts from
// any one note, so cross-note coverage is the last thing dropped.
export const CONTEXT_CHAR_BUDGET = 12_000;
const SNIPPET_CHAR_LIMIT = 2_000;

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 0) return '';
  return maxChars === 1 ? '…' : `${text.slice(0, maxChars - 1)}…`;
}

function snippet(note: NoteData, line: number | null, surroundingLines: number, maxChars: number): string {
  const header = `--- File: "${note.path}" ---\n`;
  const footer = '\n---';
  let body: string;

  if (line === null) {
    body = 'Filename matched; no matching body line.';
  } else {
    const lines = note.content.split(/\r?\n/);
    const start = Math.max(0, line - 1 - surroundingLines);
    const end = Math.min(lines.length, line + surroundingLines);
    body = `Lines ${start + 1}-${end}:\n${lines.slice(start, end).map((text, index) => `${start + index + 1}: ${text}`).join('\n')}`;
  }

  const bodyBudget = Math.max(0, maxChars - header.length - footer.length);
  return clip(header, maxChars) === header ? `${header}${clip(body, bodyBudget)}${footer}` : clip(header, maxChars);
}

export function buildContext(hits: readonly SearchHit[], options: ContextOptions): BuiltContext {
  const maxChars = options.maxChars ?? CONTEXT_CHAR_BUDGET;
  const surroundingLines = options.surroundingLines ?? 2;
  const notes = new Map(options.notes.map((note) => [note.path, note]));
  const candidates: Array<{ note: NoteData; line: number | null; first: boolean }> = [];
  const usable = hits.flatMap((hit) => {
    const note = notes.get(hit.path);
    return note ? [{ hit, note }] : [];
  });
  const rounds = Math.max(0, ...usable.map(({ hit }) => Math.max(1, hit.matches.length)));

  for (let round = 0; round < rounds; round += 1) {
    for (const { hit, note } of usable) {
      if (round === 0 && hit.matches.length === 0) candidates.push({ note, line: null, first: true });
      else if (hit.matches[round]) candidates.push({ note, line: hit.matches[round].line, first: round === 0 });
    }
  }

  if (candidates.length === 0) {
    return { text: clip('No matching workspace notes were found.', maxChars), sources: [] };
  }

  let text = '';
  const sources: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const separator = text ? '\n\n' : '';
    const remaining = maxChars - text.length - separator.length;
    if (remaining <= 0) break;
    const firstRemaining = candidate.first
      ? candidates.slice(index).filter((item) => item.first).length
      : 1;
    const allowance = Math.min(SNIPPET_CHAR_LIMIT, Math.floor(remaining / firstRemaining));
    const block = snippet(candidate.note, candidate.line, surroundingLines, allowance);
    if (!block) continue;
    text += separator + block;
    if (!sources.includes(candidate.note.path)) sources.push(candidate.note.path);
  }

  return { text, sources };
}

export function buildActiveContext(note: NoteData, maxChars = CONTEXT_CHAR_BUDGET): BuiltContext {
  const header = `--- File: "${note.path}" ---\nContent (numbered lines):\n`;
  const footer = '\n---';
  const body = note.content.split(/\r?\n/).map((line, index) => `${index + 1}: ${line}`).join('\n');
  const bodyBudget = Math.max(0, maxChars - header.length - footer.length);
  const text = clip(header, maxChars) === header ? `${header}${clip(body, bodyBudget)}${footer}` : clip(header, maxChars);
  return { text, sources: [note.path] };
}
