import { parseFrontmatter } from './parse';

// Moved from LiveEditor: replace only the serialized property block.
export function applyFrontmatter(current: string, next: string): string {
  if (next === current) return current;
  const { body } = parseFrontmatter(current);
  const newBlock = next.length >= body.length ? next.slice(0, next.length - body.length) : next;
  return newBlock + body;
}
