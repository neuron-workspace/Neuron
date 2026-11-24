/** A site is a DNS hostname, never a URL, IP literal, path, or wildcard. */
export function normalizeCookieDomain(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 253) return null;
  const host = value.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host)) return null;
  return host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? host : null;
}

export function cookieDomainMatches(cookieDomain: string, site: string): boolean {
  const host = cookieDomain.toLowerCase().replace(/^\./, '');
  const domain = normalizeCookieDomain(site);
  return domain !== null && (host === domain || host.endsWith(`.${domain}`));
}
