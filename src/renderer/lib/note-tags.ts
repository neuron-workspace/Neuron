import { parseFrontmatter, normalizeStringList } from './frontmatter';

/** The same body and frontmatter tags used by the workspace tag filter. */
export function noteTags(content: string): string[] {
  const tags = new Set<string>();
  const tagRegex = /(?:^|\s)#([A-Za-z0-9_-]+)(?=\s|$|\.|,)/g;
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1];
    if (!/^[0-9a-fA-F]{3,6}$/.test(tag) && !/^\d+$/.test(tag)) tags.add(tag);
  }
  const fm = parseFrontmatter(content);
  if (fm.valid && fm.data.tags != null) normalizeStringList(fm.data.tags).forEach(tag => tags.add(tag));
  return [...tags].sort((a, b) => a.localeCompare(b));
}
