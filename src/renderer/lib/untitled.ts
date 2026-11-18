/** Pick the first free path, including directory names implied by child paths. */
export function nextUntitled(existingPaths: string[], folder: string, base = 'Untitled', ext = '.md'): string {
  const occupied = new Set<string>();
  for (const path of existingPaths) {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) occupied.add(parts.slice(0, i).join('/').toLowerCase());
  }
  const prefix = folder ? folder.replace(/\/$/, '') + '/' : '';
  let index = 0;
  let path = prefix + base + ext;
  while (occupied.has(path.toLowerCase())) path = prefix + base + ' ' + (++index) + ext;
  return path;
}
