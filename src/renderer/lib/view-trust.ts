// Trust in an HTML view changed somewhere other than its own tab (Workspace
// settings removed it). The tab listens and shows its prompt again; main has
// already stopped its session. One window per workspace, so a DOM event is
// enough: no IPC broadcast.

export const VIEW_TRUST_CHANGED = 'neuron:html-view-trust-changed';

export function announceViewTrustChanged(path: string): void {
  window.dispatchEvent(new CustomEvent<string>(VIEW_TRUST_CHANGED, { detail: path }));
}

export function onViewTrustChanged(callback: (path: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail === 'string') callback(detail);
  };
  window.addEventListener(VIEW_TRUST_CHANGED, listener);
  return () => window.removeEventListener(VIEW_TRUST_CHANGED, listener);
}
