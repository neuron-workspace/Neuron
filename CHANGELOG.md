# Changelog

All notable changes to Neuron are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[semantic versioning](https://semver.org/).

> **A note on version numbers.** Releases up to July 2026 were numbered 1.x.
> That overstated how finished the app was, so every version has been
> renumbered down one major -- 1.4.1 became 0.4.1, and so on, with the first
> release landing at 0.0.1. The dates and the contents are unchanged; only the
> numbers moved. Nothing was removed, and no released tag was reused.

## [0.4.3] - 2026-08-24

### Added
- **Planner dashboards.** A board grouped by status, a workload split per
  project ordered by open work, and quick capture that appends a task to
  `Planner.db`. Capture writes under the hash it read, so an edit made
  elsewhere is refused with a conflict rather than silently discarded.
- **`<Run />` buttons in notes** — one command, sent to the workspace terminal,
  which the click opens if it is closed. The command is printed on the button:
  the label is what the note's author claims, the command is what actually
  happens, and a note can arrive by clone or by sync. Multi-line commands are
  refused, because a second line could run something the button never showed.
- **MDX layout components** — `Grid`, `Row`, `Col`, `Cell`, `Card`, `Stat` and
  `Divider`, for building a dashboard out of ordinary Markdown.
- **Snake**, a folder mini-app in the demo workspace. It asks for two variable
  capabilities and no file access at all, which makes it the least-privileged
  thing there and a worked example of the sandbox.
- **Closable shell panels**, with a restore control so closing is never
  one-way, and a floating workspace graph that recentres on the open note.
- **Build provenance and SHA-256 checksums** on every release. Verify a
  download with `gh attestation verify <file> --repo shiv-khetan/Neuron`.

### Fixed
- **A view's relative API calls never worked.** A view document is served at
  `/views/{sid}/document`, so `./api/v1/...` resolved under that prefix and
  answered 404 — while the protocol design document had described the relative
  form as supported all along. The custom dashboard's data fetch had never once
  succeeded in the running app.
- **The served stylesheet overrode styling that views wrote themselves.** Its
  card default matched any `<section>` carrying any class, at a specificity no
  author selector beats, so a view with its own palette rendered as grey boxes.
  It now applies only to genuinely unclassed elements.
- **Text failed WCAG AA in three of the four themes.** Ten tokens were moved
  along their own lightness axes, hue and saturation preserved. Nord's danger
  colour was 2.46:1 — error states were hardest to read in the theme where it
  mattered most.
- Commands could be swallowed when a terminal had just opened: a pty exists
  before its shell reads stdin, and anything written into that gap was lost.
- A quitting app no longer leaves shell processes running.
- The canvas opens fitted to its content instead of at an arbitrary offset.

### Changed
- The demo workspace is generic and organised into `guides/`, `projects/`,
  `daily/` and `properties/`. Its content no longer describes building Neuron.
- The download site is rebuilt, and every download now routes through an
  install page explaining the Windows SmartScreen and macOS Gatekeeper warnings
  — an unsigned build's first-run warning reasonably reads as malware without
  one. Its fonts are self-hosted: the page says the product makes no network
  calls, and it should not contradict that by fetching typefaces.

### Security
- **The approval prompt now lists the paths a view may read and change.** It
  previously promised access was "limited to the paths in its manifest" while
  never showing them, so the one decision worth making was invisible.
- Values from the GitHub API are escaped before reaching the download page's
  markup, and the install page validates the asset URL it is handed against the
  exact shape the downloads page emits — without that check it is an open
  redirect borrowing the site's credibility.

## [0.4.2] - 2026-08-23

### Added
- **Version history**, backed by a write journal that captures a file's
  previous contents before anything overwrites it — so history works even for
  files edited outside the app.
- **Multi-table `.db` databases** with a schema overview, typed columns and
  select options, still stored as readable JSON that `git diff` can explain.
- **Plain `.html` workspace views**, replacing the `.nhtml` and `.ndash`
  extensions. One CSP, one approval flow, and scripts allowed inside the
  sandbox rather than behind a manifest flag.
- **Sandboxed HTML plugins**, reusing the folder-app manifest rather than
  inventing a second permission model.
- A **workspace graph**, a **database view route** for views that run no
  JavaScript, and **AI providers on the Vercel AI SDK**.
- A **Playwright end-to-end suite** running against the real Electron app in
  CI, plus contributing, support and code-of-conduct documents.

### Fixed
- The navigation guard compared URL prefixes, so `http://localhost:5174@evil`
  passed it. It now compares parsed origins.
- Fragment variables were readable without the capability that gates them.

### Security
- **API keys are no longer reachable from the renderer.** They live in a
  main-process store with no getter on the bridge at all, and existing keys
  were migrated rather than merely hidden.

### Changed
- Relicensed to Apache 2.0.

## [0.4.1] - 2026-07-14

### Security
- **Markdown/MDX preview now sanitizes note-authored HTML.** Raw HTML in a note
  was previously injected directly into the reading view, so event-handler
  attributes and nested `<img onerror>` could execute in the app renderer.
  That path now runs through an allowlist parser that drops scripts, inline
  handlers, and unsafe URLs — closing a stored cross-site-scripting hole.

## [0.4.0] - 2026-07-11

### Added
- **HTMX views (`.nhtml`)** — the new way to build custom interfaces in a
  workspace. Author plain HTML with [htmx](https://htmx.org) attributes; each
  view renders in an isolated, sandboxed webview and talks to a capability-
  scoped local API for reading notes, searching, and permitted file writes.
  Configuration, variables, reusable fragments, permissions, and manifests
  live in a `.neuron` folder you can inspect and edit. htmx is bundled, so
  views work fully offline. See [docs/htmx-views.md](docs/htmx-views.md).
- **JSON Canvas overhaul** — undo/redo, multi-selection with marquee, clipboard
  (copy/cut/paste/duplicate as standard JSON Canvas fragments, pasteable across
  canvases and other tools), alignment and distribution, bring-to-front/
  send-to-back, snap-to-grid, context menus, safe Markdown rendering in cards,
  edge arrow-direction controls, broken-reference indicators, and preservation
  of unknown fields and unknown node types across load→edit→save.
- **`neuron.style` canvas extension (v1)** — versioned, namespaced per-node
  styling (shape, border, text alignment, font size, opacity) and presets,
  while the standard `color` field stays authoritative for interoperability.
- **Editable properties** — YAML frontmatter shown as a typed properties panel
  (text, tags, aliases, numbers, dates, lists, booleans) with round-trip-safe
  serialization that preserves comments and untouched keys.
- **Workbench customization** — activity rail, configurable layout, and a
  distraction-free zen mode.

### Changed
- **The `.vw` block-view dashboards were replaced by HTMX views.** Existing
  `.vw` files are left untouched on disk but are no longer rendered; see
  [docs/htmx-views.md](docs/htmx-views.md) for migrating them to `.nhtml`.
- The bundled demo workspace was rebuilt around an HTMX dashboard alongside the
  database and canvas examples, with a `.neuron` config folder.
- The `neuron-mini-apps` agent skill now teaches `.nhtml`, `.db`, and `.canvas`.

### Security
- **HTMX views are treated as untrusted content.** The local view server binds
  only to loopback on an ephemeral port; every request carries an unguessable
  per-view session token (HttpOnly cookie, constant-time comparison, short
  TTL); a strict Content-Security-Policy blocks remote scripts and inline
  execution; Host and Origin are validated; capabilities are declared in a
  manifest and denied by default for writes; and all filesystem access is
  confined to canonical, glob-scoped workspace paths (traversal, symlink, and
  drive-letter escapes rejected).
- Canvas documents are treated as untrusted input: safe Markdown rendering with
  no HTML injection, a URL scheme allowlist, and size/node budgets.

### Fixed
- YAML frontmatter serialization type error.

## [0.1.0] - 2026-07-05

### Added
- **Custom-view system** — file-backed surfaces that render live, interactive
  UI from workspace files, with a controlled component registry, per-block and
  per-surface error boundaries, and a documented security model.
- **`.vw` block views** — dashboards authored in HTML + Tailwind: metrics,
  stats, progress bars, file counts and tables, bar/line/area charts, habit
  heatmaps, editable CSV databases, galleries, list/folder views, bookmarks,
  checklists, and trusted action buttons. Any tag accepts a `class` for
  12-column bento grid placement.
- **`.db` databases** — Notion-style databases stored as JSON: typed
  properties, colored select/multi-select tags, per-property filters, sorting,
  and Table, Board (kanban with drag-and-drop), and Cards layouts, all
  runtime-editable from the UI.
- **`.canvas` boards** — an infinite spatial whiteboard in the open
  [JSON Canvas](https://jsoncanvas.org) format (Obsidian-compatible): text,
  file, link, and group cards with labelled, colored connections, pan/zoom,
  and one-click conversion of a card into a permanent note.
- **Agent skill** — `skills/neuron-mini-apps` teaches AI agents to build
  Neuron mini-apps from `.vw`, `.db`, and `.canvas` files.
- **Design-system component gallery** for reviewing primitives and variants.

### Changed
- **Repositories are now Workspaces** across the entire UI, docs, and demo
  content. A workspace is any folder — local or in a synced folder such as
  OneDrive or Google Drive.
- Workspace shell layout moved from a root `neuron.config` file to
  `.neuron/layout.json`; existing `neuron.config` files migrate automatically.
- Note and view writes are now **atomic** (temp file + rename) to prevent
  half-written files.
- The demo workspace was rebuilt to production quality with paired default and
  custom dashboards, a database, and a canvas board over shared sample data.

### Security
- View documents are treated as untrusted input: URL scheme allowlist for
  links and images, document size budgets, and node/depth limits on `.vw`
  trees. Privileged operations stay behind capability-shaped, workspace-confined
  IPC handlers. See [docs/custom-views.md](docs/custom-views.md) for the threat
  model.

## [0.0.1] - 2026-06-20

- Initial release: local-first Markdown/MDX workspace with live editing,
  split preview, tabs, wiki-links, tags, a wiki-link graph, resizable docks,
  a plugin host, optional AI integrations, an interactive terminal, and
  themeable UI.
