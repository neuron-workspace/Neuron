// Electron-free path decisions for HTMX views. Kept separate from index.ts
// (which imports electron) so these security-relevant rules — what opens as a
// privileged view, and where its manifest lives — are unit-testable.

const HTML_RE = /\.html$/i;

/** True for anything that opens through the view server. */
export function isViewPath(rel: string): boolean {
  return HTML_RE.test(rel);
}

/**
 * Where a view's manifest lives: mirrored under .neuron/manifests/, keeping
 * layout/permission config inside .neuron instead of scattering sidecars.
 */
export function manifestPathFor(viewRel: string): string {
  return `.neuron/manifests/${viewRel.replace(/\.html$/i, '.json')}`;
}

// ponytail: legacy sidecar location, still read so existing workspaces keep
// working. Drop once no one ships pre-.neuron/manifests views.
export function legacyManifestPathFor(viewRel: string): string {
  return viewRel.replace(/\.html$/i, '.neuron.json');
}

/** Display name for a view path when no manifest name is set. */
export function defaultViewName(viewRel: string): string {
  return viewRel.split('/').pop()!.replace(/\.html$/i, '');
}
