# Deferred work — consolidated backlog

A single place for everything we scoped but chose **not** to build yet, so it can
be picked up later without re-deriving context. Grouped by area, roughly ordered
by value/effort within each group. Detailed designs live in the linked docs;
this is the index + the items those docs don't already track.

Legend: **[S]** small (hours) · **[M]** medium (a day) · **[L]** large (multi-day).
"Needs app" = requires `npm run dev` (port **5174**) to verify visually/interactively
before it can be called done — the reason most UI polish was deferred.

Companion docs:
- `docs/design/notion-like-ui-roadmap.md` — design-system + editor research, phased plan, acceptance criteria.
- `docs/roadmap/production-readiness-plan.md` §12 — the same design-system backlog in checklist form.

---

## 1. Design system (Notion-like roadmap, Phases 1–3)

Already done this cycle: HTMX kit rewrite (shadcn-style, token-driven) + `.neuron-kbd`;
sidebar drift removed (deleted unused `ui/sidebar.tsx` + `use-mobile` + `--sidebar-*`
tokens); shared `--space-*` / `--text-*` / `--leading-*` tokens **defined** in
`index.css`.

Deferred:

- **[M] Adopt the shared spacing + type scale.** Point `.preview-prose`,
  `.vw-content`, `.cm-live-editor`, and the HTMX kit at `--space-*` / `--text-*`.
  Needs app — this changes real reading-mode sizes; verify each surface at each
  step, no silent layout shift. This is the single biggest consistency win.
- **[M] `Toolbar` component.** `.pane-header` already standardizes the header
  visual, so `Toolbar`'s value is structure (left/center/right slots). Build it,
  then move the editor Source/Preview `.mode-switch`, canvas controls, and the
  `.db` header onto it. Needs app.
- **[M] Extract reusable primitives**: `PropertyRow` (out of `DocumentProperties`),
  one canonical `EmptyState` (retire bespoke empties), `PermissionPrompt` (out of
  `HtmxViewSurface`, reuse for plugin grants). Acceptance: each used in ≥2 places,
  bespoke copies removed.
- **[S] `IconButton`** explicit size/variant; audit the shell for one-off buttons.
- **[S] Standardize settings fields** on shadcn `Field`/`Input`, grouped with `Card`.
- **[S] Prune unused `ui/` components.** ~60 shadcn files exist; several are never
  rendered. Confirm non-use, then delete (drift/dead code). Safe but broad.

## 2. Knowledge Graph View (Obsidian-style)

Already done: theme-aware rewrite of `GraphCanvas.tsx` (CSS vars, was hardcoded
slate/emerald), **degree-based node sizing**, and the **three-tier active/connected/
rest highlight + dim** with hover-reveal and a degree tooltip. Panel layer already
has `scope: active | folder | repo` (local/global seed).

Deferred (the bulk of the pasted spec — a genuine multi-phase feature):

- **[M] Interaction, dependency-free.** Zoom (wheel), pan (drag background), drag
  nodes, plus fit-to-screen / reset-view / full-screen / refresh controls. SVG
  transform + handlers. Needs app to tune feel. **Recommended first.**
- **[L] Force-directed layout.** Replace the static hex layout. Decision point:
  adopt **`d3-force`** (MIT, layout-math only, pairs with the SVG/Canvas we render)
  vs. hand-roll. Add link-distance and repulsion-strength controls. This is where
  the "add a dependency?" call must be made explicitly.
- **[L] Settings panel + legend.** Controls: node size, line thickness, link
  distance, repulsion, animation on/off, directional arrows, text labels,
  orphan-note visibility, attachment visibility, tag visibility, link-depth
  (1/2/3). Filter the graph by title/folder/tag/created/modified/metadata. Create
  **filter-rule color groups**. A legend explaining node colors + connection types.
- **[M] Node/edge semantics.** Distinguish incoming vs outgoing links, and tags /
  attachments / unresolved links as their own node styles. Option to hide
  unresolved links or draw them differently. Orphan notes shown when enabled.
- **[M] Local vs Global UI toggle** with configurable depth (currently only the
  `scope` panel spec; no user-facing depth control).
- **[L] Scale.** Switch rendering to **Canvas/WebGL** past a node threshold; label
  and animation budgets; lazy loading / graph simplification for large workspaces.

## 3. Editor — Notion affordances over Markdown (roadmap Phase 2)

Decision already made: **keep Markdown as source of truth**, extend the existing
CodeMirror decoration/widget layer (`.cm-lp-block*`) — do **not** adopt a block
editor (BlockNote/Yoopta/Novel/Mina; JSON model breaks Markdown-first + MDX). All
deferred, and each needs an editor mini-plan + app verification:

- **[M] Slash menu (`/`).** CodeMirror input handler → menu at the caret that
  inserts Markdown snippets (heading, list, task, table, callout, `<DbView/>`).
  Pure text insertion, no model change.
- **[M] Block hover actions on plain Markdown lines.** Extend the existing block
  handle/toolbar (currently only on React-widget blocks) to any line:
  drag-to-reorder = move lines; duplicate/delete = text ops.
- **[S] "Turn into" block-type menu.** Transform the current line's Markdown prefix
  (`#`, `- [ ]`, `>`).
- **[S] Command-palette shortcut hints** via `Kbd`; **friendly tab labels** +
  per-type icons (tabs currently show raw `.db/.canvas/.nhtml/.ndash` extensions).
- **[L] Phase 4, gated:** only if a true WYSIWYG surface is ever required, evaluate
  TipTap behind a Markdown serializer as an *alternate view*, never storage.

## 4. Dashboards & HTMX examples — leftovers

Mostly polished (Custom dashboard, templates, folder app). Deferred:

- **[S] `.ndash` perf nit:** the Custom dashboard fetches `/notes?limit=500` and
  derives counts client-side; fine for demo scale, revisit if a real workspace is
  huge. (Server caps notes anyway.)
- **[S] Custom dashboard alt:** optionally offer the exact "Loud" finance layout as
  a *static style demo* (no live data) in addition to the data-wired version — only
  if wanted.
- **[S] Touch targets < 44px** in the HTMX kit/dashboards — low priority (desktop
  app), noted for completeness.

## 5. Sidebar

Already done: folders collapsed by default (workspace-switch aware; search
force-opens).

Deferred:

- **[S] Clarify "repositories collapsed."** We collapsed the note-folder tree. If
  the intent also included the recent-repositories list / repository switcher,
  confirm and apply the same default there.

## 6. Dev / infra small items

- **[S] Single dev-port constant.** The dev port lives in 4 places
  (`vite.config.ts`, `tools/dev/start-electron.js`, `main.ts` ×2, now `5174`).
  Factor into one `DEV_PORT` to remove the duplication.
- **[S] Impeccable skill update** to v3.9.1 (currently 3.6.0) via
  `npx impeccable update` — cosmetic/tooling, applies next session.

## 7. Cross-cutting: "needs visual verification"

Everything above marked "Needs app" shares one blocker: from a headless
environment the automated suite is defect evidence only, not proof the pixels/
interactions are right. The efficient path for all UI-polish items is a session
with `npm run dev` running (port 5174), changing one surface at a time and
screenshot-checking. Prioritize in this order when that session happens:

1. Graph interaction (zoom/pan/drag/fit) — biggest felt win, no new dep.
2. Shared spacing/type-scale adoption + `Toolbar` — biggest consistency win.
3. Editor slash menu + block hover — biggest "Notion-like" win.

---

## Definition of done (per item)

- No new runtime dependency without an explicit, recorded decision (graph force
  layout is the one place a dependency is genuinely on the table — `d3-force`).
- Markdown/MDX stays the on-disk source of truth; no block-editor JSON model.
- Every interactive element: default/hover/focus/active/disabled states; WCAG AA
  contrast in all four theme presets (light + dark).
- HTMX views stay sandbox-safe: no remote fonts/CSS/scripts, `connect-src 'self'`.
- `npm test` green; reduced-motion respected; no console errors.
