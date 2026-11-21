/**
 * The task box at the start of a list item: indentation, any blockquote
 * markers (`>`, repeated, spaced or not), a bullet (`-`, `*`, `+`) or a number
 * (`1.`, `1)`), whitespace, then `[ ]`, `[x]` or `[X]` -- a non-breaking space
 * counts as the empty box, as Markdown editors write it -- and whitespace or
 * the end of the line after it. The marker may be left out (`[ ] text`): the
 * preview draws that as a task too, so its checkbox must work. Anything else
 * on the line, earlier or later, is text and is never changed.
 */
const TASK = /^([ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?\[)([  xX])(\](?=\s|$))/;

/** Tick or untick the task on one source line. Null when the line holds no task, or it already reads that way. */
export function toggleTaskLine(content: string, lineIndex: number, checked: boolean): string | null {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return null;
  const match = TASK.exec(line);
  if (!match) return null;
  const ticked = match[2] === 'x' || match[2] === 'X';
  if (ticked === checked) return null;
  lines[lineIndex] = match[1] + (checked ? 'x' : ' ') + match[3] + line.slice(match[0].length);
  return lines.join('\n');
}
