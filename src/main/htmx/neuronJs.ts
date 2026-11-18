// The script served to every HTML view as `neuron.js`. It defines
// `window.neuron`, a thin wrapper over the /api/v1 routes so a view can fetch
// data without hand-writing fetch calls. It grants nothing: every call is an
// ordinary same-origin request with the session cookie, and the server applies
// the same capability and path checks it applies to any other request.
//
// Embedded as a string so the packaged app needs no extra asset plumbing.

export const NEURON_VIEW_JS = `(() => {
  'use strict';
  let theme = null;

  // Root-relative, so a view that changes its own URL with history.pushState
  // still reaches the API.
  const url = (route, params) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    const qs = query.toString();
    return '/api/v1/' + route + (qs ? '?' + qs : '');
  };

  const request = async (method, route, { params, body } = {}) => {
    const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url(route, params), init);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const error = new Error((data && data.error && data.error.message) || ('Request failed (' + res.status + ').'));
      error.status = res.status;
      error.code = (data && data.error && data.error.code) || null;
      throw error;
    }
    return data;
  };

  const neuron = {
    async context() {
      const data = await request('GET', 'context');
      if (data && (data.theme === 'light' || data.theme === 'dark')) theme = data.theme;
      return data;
    },
    /** 'light' or 'dark' once context() has resolved; null before. */
    get theme() { return theme; },
    variables: () => request('GET', 'variables'),
    variable: (key) => request('GET', 'variables/' + encodeURIComponent(key)),
    setVariable: (key, value) => request('PUT', 'variables/' + encodeURIComponent(key), { body: { value } }),
    files: ({ dir, glob, limit } = {}) => request('GET', 'files', { params: { dir, glob, limit } }),
    read: (path) => request('GET', 'files/content', { params: { path } }),
    write: (path, content, baseHash) => request('PUT', 'files/content', { body: { path, content, baseHash } }),
    create: (path, content) => request('POST', 'files', { body: { path, content } }),
    remove: (path) => request('DELETE', 'files', { params: { path } }),
    search: (query) => request('GET', 'search', { params: { query } }),
    notes: ({ tag, folder, limit } = {}) => request('GET', 'notes', { params: { tag, folder, limit } }),
    tags: () => request('GET', 'tags'),
    db: (path, { table } = {}) => request('GET', 'db', { params: { path, table } }),
  };

  window.neuron = Object.freeze(neuron);
})();
`;
