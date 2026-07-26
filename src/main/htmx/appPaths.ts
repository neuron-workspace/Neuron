// Electron-free path decisions for HTMX views and folder mini-apps. Kept
// separate from index.ts (which imports electron) so these security-relevant
// rules — what opens as a privileged view, and where its manifest lives — are
// unit-testable.

// A folder mini-app's entry point: a `neuron.app` file whose co-located
// `neuron.app.json` marks the folder as an app.
const APP_ENTRY_RE = /(^|\/)neuron\.app$/i;

/** True for anything that opens through the view server: .nhtml, .ndash, or a neuron.app entry. */
export function isViewPath(rel: string): boolean {
  return /\.(nhtml|ndash)$/i.test(rel) || APP_ENTRY_RE.test(rel);
}

export function isAppEntry(rel: string): boolean {
  return APP_ENTRY_RE.test(rel);
}

/** A .ndash scripting dashboard: its document runs inline JS (relaxed CSP), not htmx. */
export function allowsScripts(rel: string): boolean {
  return /\.ndash$/i.test(rel);
}

/**
 * Where a view's manifest lives. A .nhtml view's manifest is mirrored under
 * .neuron/manifests/ (keeping app/layout config inside .neuron instead of
 * scattering *.neuron.json sidecars); a folder app's manifest is the
 * co-located neuron.app.json that marks the folder.
 */
export function manifestPathFor(viewRel: string): string {
  if (isAppEntry(viewRel)) return `${viewRel}.json`;
  return `.neuron/manifests/${viewRel.replace(/\.(nhtml|ndash)$/i, '.json')}`;
}

// ponytail: legacy sidecar location, still read so existing workspaces keep
// working. Drop once no one ships pre-.neuron/manifests views.
export function legacyManifestPathFor(viewRel: string): string {
  return viewRel.replace(/\.nhtml$/i, '.neuron.json');
}

/** Display name for a view path when no manifest name is set. */
export function defaultViewName(viewRel: string): string {
  if (isAppEntry(viewRel)) return viewRel.split('/').slice(-2, -1)[0] ?? 'App';
  return viewRel.split('/').pop()!.replace(/\.(nhtml|ndash)$/i, '');
}
