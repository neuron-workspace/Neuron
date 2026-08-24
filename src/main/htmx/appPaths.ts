// Electron-free path decisions for HTMX views and folder mini-apps. Kept
// separate from index.ts (which imports electron) so these security-relevant
// rules — what opens as a privileged view, and where its manifest lives — are
// unit-testable.

const HTML_RE = /\.html$/i;
const APP_ENTRY_RE = /^(.*\/)index\.html$/i;

/** True for anything that opens through the view server. */
export function isViewPath(rel: string): boolean {
  return HTML_RE.test(rel);
}

/** Candidate marker for a non-root folder app; the caller still verifies it exists. */
export function appManifestPathFor(viewRel: string): string | null {
  const match = viewRel.match(APP_ENTRY_RE);
  return match ? `${match[1]}neuron.app.json` : null;
}

/**
 * Where a view's manifest lives. A plain view's manifest is mirrored under
 * .neuron/manifests/ (keeping app/layout config inside .neuron instead of
 * scattering *.neuron.json sidecars). A folder app uses its co-located marker.
 */
export function manifestPathFor(viewRel: string, appEntry = false): string {
  if (appEntry) return appManifestPathFor(viewRel)!;
  return `.neuron/manifests/${viewRel.replace(/\.html$/i, '.json')}`;
}

// ponytail: legacy sidecar location, still read so existing workspaces keep
// working. Drop once no one ships pre-.neuron/manifests views.
export function legacyManifestPathFor(viewRel: string): string {
  return viewRel.replace(/\.html$/i, '.neuron.json');
}

/** Display name for a view path when no manifest name is set. */
export function defaultViewName(viewRel: string, appEntry = false): string {
  if (appEntry) return viewRel.split('/').slice(-2, -1)[0] ?? 'App';
  return viewRel.split('/').pop()!.replace(/\.html$/i, '');
}
