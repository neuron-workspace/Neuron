---
name: neuron-mini-apps
description: Build mini apps (dashboards, trackers, tables, galleries) inside a Neuron workspace using sandboxed .html views, .db Notion-style databases, and .canvas boards. Use when asked to create a dashboard, tracker, database, or interactive view in Neuron.
---

# Building mini apps in Neuron

A Neuron **workspace** is a plain folder of files. A mini app is just files in
that folder — no build step, no bundler, no localStorage:

- **`.html` files** — the UI. Plain HTML with optional
  [htmx](https://htmx.org) attributes, inline CSS, and JavaScript, rendered in
  an isolated view tab against Neuron's local API.
- **`.db` files** — Notion-style databases: typed properties, colored select tags, filters (schema below).
- **`.canvas` files** — infinite whiteboards in the open JSON Canvas format (Obsidian-compatible).
- **`.md`/`.mdx` files** — notes/docs, linkable with `[[wikilinks]]`.
- **Folder mini-apps** — a folder with `index.html` and `neuron.app.json` renders as a single app instead of a file listing.
- **`.neuron/` folder** — variables, reusable fragments, styles, templates, and per-view manifests.

## The .html format

A view file is HTML **body content** (no `<html>`/`<head>`). Neuron wraps it,
injects the bundled htmx runtime, and **attaches the `neuron.css` design
system for you**, serving it from a loopback server. Auth is automatic (an
HttpOnly session cookie) — never put tokens in the file.

Interactivity comes from htmx attributes (`hx-get`, `hx-post`, `hx-put`,
`hx-delete`, `hx-trigger`, `hx-target`, `hx-swap`, `hx-include`, `hx-vals`)
pointed at `/api/v1/...`. Inline `<script>` may execute, while views have **no
network access** — everything is local and capability-gated.

**Write plain semantic HTML** — it's styled to match the app with no classes:
a bare `<section>`/`<article>` is a card, `<button>` is a button, and
`<input>`, `<select>`, `<textarea>`, `<table>`, `<label>`, `<code>` all inherit
the Neuron look and track light/dark theme. `<header>` stays transparent.

On top of the defaults, `neuron.css` is a small **shadcn-style component
library**: `card` (+ `card-header`/`card-title`/`card-description`/
`card-content`/`card-footer`), `btn` (+ `btn-secondary`/`btn-outline`/
`btn-ghost`/`btn-destructive`, sizes `btn-sm`/`btn-lg`/`btn-icon`), `badge`
(+ `badge-primary`/`badge-outline`/`badge-destructive`), `input`, `label`,
`grid` (+ `cols-2/3/4`), `stack`, `row`, `toolbar`, `separator`, `metric` /
`metric-label`, `muted`. The legacy `neuron-*` classes stay as aliases so
existing views and server fragments keep working. Inline `style` attributes are
allowed for fine-tuning.

`{{ variables.name }}` interpolates a variable from `.neuron/variables.json`,
HTML-escaped. Key lookup only — no expressions.

## API routes

| Route | Purpose |
| --- | --- |
| `GET /api/v1/context` | View, workspace, theme, granted capabilities |
| `GET /api/v1/search?query=…` | Note search (HTML fragment for htmx targets) |
| `GET /api/v1/notes?tag=…&folder=…&limit=…` | Note metadata table |
| `GET /api/v1/tags` | Tag badges |
| `GET /api/v1/files?dir=…&glob=…&limit=…` | File listing |
| `GET /api/v1/files/content?path=…` | Read a file → `{path, content, hash}` |
| `PUT /api/v1/files/content` | Update (`{path, content, baseHash}`; 409 on conflict) |
| `POST /api/v1/files` | Create (`{path, content}`) |
| `DELETE /api/v1/files?path=…` | Delete |
| `GET/PUT /api/v1/variables/:key` | Read / update a writable variable |
| `GET /api/v1/fragments/:name?param=…` | Render `.neuron/fragments/<name>.html` |

GET routes return HTML fragments when called from htmx, JSON otherwise.

## Permissions

Views receive **no capabilities by default**. Reading or writing workspace data
needs a manifest under
`.neuron/manifests/`, mirroring the view's path
(`Tracker.html` → `.neuron/manifests/Tracker.json`):

```json
{
  "name": "Tracker",
  "permissions": ["workspace.files.read", "workspace.files.write", "workspace.files.create", "variables.read"],
  "allowedReadPaths": ["data/**"],
  "allowedWritePaths": ["data/**"],
  "networkPolicy": "none"
}
```

Capabilities: `workspace.files.read/write/create/delete`,
`workspace.directories.list`, `workspace.search`, `notes.read`, `tags.read`,
`variables.read/write`. Request the minimum; every requested capability shows
the user an approval dialog. Unknown fields/permissions are rejected. Scope
`allowedWritePaths` as tightly as possible (ideally one file or folder).

## Folder mini-apps

To ship a self-contained app as a folder (so the sidebar shows one app entry
instead of the folder's files), put two files in the folder:

- `index.html` — the UI, using the same sandboxed HTML view format.
- `neuron.app.json` — the manifest, same schema as a view manifest.

```json
{
  "name": "Launch board",
  "permissions": ["workspace.search", "notes.read", "tags.read", "variables.read"],
  "allowedReadPaths": ["**"],
  "networkPolicy": "none"
}
```

A manifest with no `permissions` grants nothing — list the read caps a
read-only app needs. Everything else (API routes, isolation, approval) works
exactly like a standalone `.html` view. The workspace root can't be an app.

## JavaScript views

When htmx isn't enough, add inline `<style>` and `<script>` to the `.html` file:

```html
<style>/* your CSS; theme via body.theme-dark / body.theme-light */</style>
<div id="app">…</div>
<script>
  const api = (p, opts) => fetch('/api/v1' + p, opts).then((r) => r.json());
  const notes = await api('/notes?limit=50');          // read
  await api('/variables/status', { method: 'PUT',       // write (needs approval)
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'done' }) });
</script>
```

The JS reaches the loopback API but has **no network access** — it is airgapped.
GET routes return JSON to `fetch` (HTML only to htmx). Neuron always injects
the bundled htmx runtime and `neuron.css`, whether or not the document uses
them.

## Recipe: a tracker mini app

`Reading tracker.html`:
```html
<header><h1>Reading tracker</h1></header>
<div class="neuron-grid cols-3">
  <section hx-get="/api/v1/fragments/workspace-summary" hx-trigger="load" hx-swap="innerHTML">Loading…</section>
  <section>
    <span class="neuron-metric-label">Status</span>
    <div class="neuron-metric">{{ variables.projectStatus }}</div>
  </section>
  <section hx-get="/api/v1/files?dir=books&limit=20" hx-trigger="load" hx-swap="innerHTML">Loading…</section>
</div>

<section>
  <form hx-get="/api/v1/search" hx-target="#results"
        hx-trigger="submit, input changed delay:300ms from:#q">
    <label for="q">Find a book note</label>
    <input id="q" name="query" type="search" autocomplete="off" />
  </form>
  <div id="results"></div>
</section>
```

Pattern: workspace files as state, the view as UI, htmx requests as verbs.
For typed/records data, pair the view with a `.db` file the user edits in its
own tab; the view reads it via `/api/v1/files/content`.

## .db databases (Notion-style)

A `.db` file opens as a fully editable database table. It is one JSON document:

```json
{
  "schema": {
    "order": ["name", "status"],
    "properties": {
      "name": { "name": "Task", "type": "text" },
      "status": {
        "name": "Status", "type": "select",
        "options": [{ "id": "todo", "name": "Todo", "color": "#8b8b8b" }]
      }
    }
  },
  "view": { "sortBy": "name", "sortDir": "asc", "filterProp": null, "filterValue": "" },
  "rows": [{ "id": "r1", "values": { "name": "Ship it", "status": "todo" } }]
}
```

- Property types: `text`, `number`, `checkbox`, `date`, `url`, `select`, `multiselect`.
- `select` values store the option **id**; `multiselect` values store an array of option ids.
- Option `color` is any CSS color (the app palette: `#8b8b8b #a27763 #e28f44 #d9b23c #5aa06c #528fd1 #9a6dd7 #d15796 #dd5c5c`).
- `view` persists sort and filter; the UI writes it back as the user changes them.
- Users can add/rename/retype/reorder/delete properties and options entirely from the GUI — when generating a `.db`, just provide a sensible starting schema and rows.
- The app watches the file: external edits appear live in the open table.

Prefer `.db` when records need types, colored tags, or filtering; prefer plain
files read through the API when an `.html` view must present the data.

## .canvas boards (JSON Canvas)

A `.canvas` file is `{ "nodes": [...], "edges": [...] }` per [jsoncanvas.org](https://jsoncanvas.org):

- Node types: `text` (markdown in `text`), `file` (workspace path in `file`), `link` (`url`), `group` (`label`). All have `id`, `x`, `y`, `width`, `height`, optional `color`.
- Edges: `{ id, fromNode, fromSide, toNode, toSide, label?, color? }` with sides `top|right|bottom|left`.
- `color` is `"1"`–`"6"` (red, orange, yellow, green, cyan, purple) or any CSS color.
- When generating a canvas, lay cards out on a rough grid (~300×150 cards, 60+px gaps), put groups behind the cards they contain, and label edges with the relationship ("causes", "supports", "example of").

## Rules

- All persistent state goes in workspace files. Never suggest localStorage, external databases, or embedded JS.
- Inline scripts may call the local API, but cannot access the network or Node.
- Request the minimum capabilities and the tightest path scopes in manifests.
- Relative data paths in API calls resolve from the workspace root.
- Reusable partials go in `.neuron/fragments/`; per-view CSS in `.neuron/styles/<view name>.css`.
