# JSON Canvas Backlog

## Purpose

Tracks deferred, skipped, discovered, blocked, and future JSON Canvas work for
Neuron, so future sessions can continue without re-investigating. Companion to
the plan at `docs/plans/json-canvas-enhancements.md` (architecture map,
feature matrix, compatibility rules live there).

## Current implementation status

Phase 1 complete (2026-07-11): model/persistence foundation
(`src/renderer/canvas/model.ts`), snapshot undo/redo
(`src/renderer/canvas/history.ts`), safe Markdown rendering
(`src/renderer/canvas/markdown.tsx`), and a rewritten `CanvasSurface` with
multi-selection, marquee, clipboard, z-order, alignment, context menus,
keyboard editing, snap-to-grid, edge arrow controls, unknown-node fallbacks,
and broken-reference indicators.

`neuron.style` extension v1 complete (2026-07-11): versioned namespaced
extension (shape/borderStyle/borderWidth/textAlign/fontSize/opacity/preset),
lazy creation, future-version read-only preservation, presets, style panel.
Full report: docs/plans/json-canvas-enhancements.md §10. Remaining Phase 2
items (search, DnD, minimap, group styling) not started.

## Completed tasks

- [x] Phase 0: investigation, architecture map, feature matrix, plan
  - Completed: 2026-07-11
  - Relevant files: docs/plans/json-canvas-enhancements.md
  - Notes: 34-item feature matrix; weaknesses table documents pre-existing issues.
- [x] Phase 1: model + history + interaction foundation
  - Completed: 2026-07-11
  - Relevant files: src/renderer/canvas/model.ts, src/renderer/canvas/history.ts,
    src/renderer/canvas/markdown.tsx, src/renderer/surfaces/CanvasSurface.tsx
  - Tests: tools/canvas-model.test.mjs (`npm run test:canvas`)
  - Notes: unknown top-level/node/edge fields and unknown node types now
    survive round-trips (previously top-level extras were dropped).
- [x] `neuron.style` extension v1 (narrow scope)
  - Completed: 2026-07-11
  - Relevant files: src/renderer/canvas/model.ts (getNodeStyle/setNodeStyle/
    applyStyleToNodes/applyStylePreset/CLEAR_STYLE/STYLE_PRESETS),
    src/renderer/surfaces/CanvasSurface.tsx (style panel), src/renderer/index.css
  - Tests: tools/canvas-model.test.mjs (extension section)
  - Notes: v1 fields only (shape/borderStyle/borderWidth/textAlign/fontSize/
    opacity/preset); `neuron` written lazily and removed when empty; future
    versions read-only; standard `color` authoritative; multi-selection = one
    undo entry. Full report: docs/plans/json-canvas-enhancements.md §10.

## In progress

(none)

## Next recommended tasks

1. **Canvas search (#19)** — search node text/file/url/label, highlight +
   step through matches, fade non-matches. Reuse the in-memory notesData
   approach; no new index.
2. **Drag notes from sidebar onto canvas (#20)** — Sidebar rows need
   `draggable` + a dataTransfer mime; CanvasSurface needs onDrop → file node.
3. **Group membership polish (#22)** — drag-into/out-of detection on drop,
   group auto-fit command, padding. Containment rule today: fully-inside
   rectangles move with the group (see `nodesInsideGroup` in model.ts).
4. **Style extension increments** — group styling, edge styling
   (`neuron.style` on edges: width/dash), and more presets — only after the
   node style panel has real usage. Icons/shadows/cover images/arbitrary
   fonts/unrestricted colors stay deferred (see Deferred features).

## Deferred features

- [ ] `neuron.style` increments beyond v1: icons, shadows, cover images,
  arbitrary fonts, unrestricted custom colors, group styling, edge styling
  - Reason deferred: keep the extension foundation reviewable; avoid building
    a second design system before the panel proves itself. Standard `color`
    remains the only color mechanism for now.
  - Suggested approach: add fields one at a time to `NeuronCanvasStyle` +
    `getNodeStyle` validation + tests; bump `version` only on breaking shape
    changes (additive fields don't need it).
- [ ] `neuron.behavior` extension (locked/pinned/hidden/collapsed)
  - Reason deferred: interaction semantics (what does locked block?) need a
    product decision. `setNodeStyle` already preserves sibling keys like
    `behavior`, so the data path is ready.
  - Compatibility: namespaced key; other tools ignore it (verify Obsidian
    preserves unknown props on nodes it doesn't edit — see Compatibility
    follow-ups).
- [ ] Minimap (#18): defer until after style work; needs perf care.
- [ ] Layout commands (#23): tidy/stack/grid; must be one undo entry (history
  API already supports this — one `write()` per layout).
- [ ] Templates (#24): plain .canvas files in `.neuron/templates/` +
  insert-with-ID-regen (reuse `remapFragmentIds`).
- [ ] Viewport memory per canvas (#25): store in app settings keyed by
  workspace+path, NOT in the file.
- [ ] Compatibility export / export selection as canvas (#26): reuse
  `serializeCanvas` + fragment helpers; "strip `neuron`" option.
- [ ] PNG/SVG export (#27), Mermaid interop (#30), dynamic query nodes (#31),
  orthogonal edge routing (#32): later phases, see matrix.
- [ ] Paste image from clipboard (#21): needs an IPC to write binary assets;
  current `notes:write` is text-only.

## Skipped during implementation

- [ ] Edge label editing UX kept as-is (select edge → inline input). A
  double-click-to-edit affordance was considered and skipped for scope.
- [ ] Resize handles only bottom-right. Eight-direction resize skipped; add
  when styling work touches node chrome anyway.
- [ ] Marquee requires Shift+drag (plain drag pans, matching previous
  behavior). Revisit default-drag=marquee + Space=pan after user feedback.
- [ ] Text-node markdown *editing* is still a plain textarea; rendering is
  markdown. Inline rich editing deliberately out of scope.
- [ ] `fromEnd: "arrow"` (bidirectional start arrow) is parsed/preserved and
  toggleable via context menu, but the marker renders only when set — no
  toolbar affordance.

## Bugs and technical debt discovered

- [ ] `views:file` IPC loads whole images as base64 data URLs — fine for
  note-sized images, wasteful for photo-heavy canvases. Recommended fix: a
  custom protocol handler for workspace media. Risk: low until media-heavy
  canvases appear. (Pre-existing; noted in main.ts ponytail comment.)
- [ ] Link cards fetch favicons from Google's favicon service (remote
  request from a local file's URL). Privacy-conscious users may object;
  consider a local fallback-only mode. Pre-existing behavior, kept.
- [ ] No component/E2E test infrastructure exists in the repo (unit tests are
  esbuild+assert Node scripts). Canvas interaction paths are untested beyond
  the model layer.
- [ ] **Pre-existing TypeScript failures, NOT canvas-related** — do not
  attribute these to canvas work; they were present before any canvas changes
  and live in uncommitted files from a separate frontmatter/properties
  feature. `npx tsc -p tsconfig.renderer.json --noEmit` reports exactly:
  - `src/renderer/components/properties/DocumentProperties.tsx(6,3): error
    TS6133: 'labelFor' is declared but its value is never read.`
  - `src/renderer/lib/frontmatter/serialize.ts(59,29): error TS2322: Type
    'YAMLMap<unknown, ParsedNode | null>' is not assignable to type
    'Alias.Parsed | Scalar.Parsed | YAMLMap.Parsed<...> | YAMLSeq.Parsed<...>
    | null'.` (yaml library generic mismatch on `items`)
  - Recommended fix: delete the unused `labelFor`; cast or narrow the YAMLMap
    in `serialize.ts:59`. Risk: none to canvas; `vite build` doesn't
    typecheck so production builds still pass.

## Open product questions

- Question: should plain background drag marquee-select (Figma-style) instead
  of pan?
  - Context: current UX pans on drag; Shift+drag selects.
  - Options: keep; swap with Space-to-pan; make it a setting.
  - Recommendation: gather feedback before changing muscle memory.
- Question: where should advanced node customization live — floating
  selection toolbar, right inspector panel, or context menu submenus?
  - Context: blocks the style-extension feature.
  - Recommendation: compact floating toolbar for frequent ops; defer full
    inspector until property count justifies it.

## Open architecture questions

- Question: when (if ever) to replace snapshot undo with an operation model?
  - Context: snapshots are references to immutable docs — free at 2 MB cap.
    All mutations already flow through one `write()` chokepoint in
    CanvasSurface, so a swap is localized.
  - Suggested investigation: only if collaborative editing or >2 MB docs
    arrive.
- Question: virtualization threshold?
  - Constraints: no measurements yet. Add a generated-fixture benchmark
    (500/1000/5000 nodes) before optimizing. See performance follow-ups.

## Test gaps

- [ ] Component tests for selection/gesture/keyboard interaction — area:
  CanvasSurface; risk: regressions invisible; suggested: adopt a lightweight
  DOM test runner repo-wide first (decision above the canvas feature).
- [ ] Cross-app interop test with a real Obsidian-authored canvas fixture
  containing Obsidian-specific extras — currently simulated with synthetic
  unknown fields.
- [ ] External-modification conflict during an in-flight text edit (watcher
  adoption while textarea focused) — manual test only so far.

## Performance follow-ups

- [ ] Benchmark: generated 100/500/1000/5000-node fixtures; measure initial
  render, pan/zoom frame time, multi-drag. Current result: unmeasured.
  Desired: 60fps pan at 500 nodes. Suggested optimization order: memoized
  node components → viewport culling → spatial index.

## Security and privacy follow-ups

- [ ] Favicon fetches leak visited-link hostnames to Google (pre-existing).
  Mitigation option: settings toggle or local letter-avatar fallback.
- [ ] Markdown renderer is intentionally minimal; if it ever grows raw-HTML
  or image support, route through `safeUrl` + keep React-element-only output.

## Accessibility follow-ups

- [ ] Keyboard-only edge creation (nodes are traversable and nudgeable via
  keyboard; connecting still requires pointer drag).
- [ ] Screen-reader announcements for selection changes and save state.
- [ ] Reduced-motion: canvas has no animations today; keep it that way or
  gate any future ones on `prefers-reduced-motion`.

## Compatibility follow-ups

- [ ] Verify round-trips against current Obsidian Canvas build (open Neuron-
  saved file, edit, reopen in Neuron; confirm `neuron` keys survive Obsidian
  edits of *other* nodes).
- [ ] JSON Canvas spec allows `color` on groups' background — we render a 6%
  tint; confirm acceptable contrast in both themes.

## Useful implementation context

- Canvas entry point: `src/renderer/surfaces/CanvasSurface.tsx`
  (registered for extension `canvas` via `registerSurface`).
- Model/parse/serialize/fragments/geometry: `src/renderer/canvas/model.ts`.
- Undo/redo: `src/renderer/canvas/history.ts` (snapshot stack, cap 100).
- Markdown: `src/renderer/canvas/markdown.tsx` (React elements only).
- Persistence: `notes:write` IPC = atomic temp+rename (src/main/main.ts);
  echo suppression via `lastWritten` ref; watcher = `notes:changed`.
- Tests: `npm run test:canvas` → `tools/canvas-model.test.mjs`; full suite
  `npm test`; typecheck `npx tsc -p tsconfig.renderer.json --noEmit`
  (two pre-existing failures in uncommitted frontmatter/properties files are
  unrelated to canvas); build `npm run build`.
- Invariants: doc objects are immutable; every committed mutation goes
  through `write()`; transient state (selection/viewport/gesture) is never
  serialized; serializer = tabs + trailing newline; unknown fields must
  survive (tested).

## Session handoff log

### 2026-07-11 — Production-readiness audit + stored-XSS fix

- Scope: repo/product audit beyond canvas. Durable output:
  `docs/roadmap/production-readiness-plan.md` (inventory, Obsidian parity
  matrix, milestones M0–M9, risk register, testing master plan, Ctrl+L
  decision, example-restructure plan, non-goals).
- Bounded slice: fixed a **stored XSS** (Risk R1) — `MDXPreview.tsx` injected
  untrusted note HTML via `dangerouslySetInnerHTML` (nested `<img onerror>` /
  event handlers executed in the privileged renderer). Now routed through new
  `src/renderer/lib/sanitize-html.ts` (allowlist DOMParser walk, drops
  scripts/handlers/unsafe URLs; reuses `safeUrl`). Test:
  `tools/sanitize-html.test.mjs` (+ `linkedom` devDep, DOMParser shim) wired
  into `npm test` as `test:sanitize`.
- Verified: `npm test` (5 suites green), `tsc` renderer + main both clean
  (the two historical TS errors are gone — YAML fixed in 6b88bab, `labelFor`
  removed this pass), `npm run build` passes.
- Recommended next task: roadmap **M0** (make CI run typecheck + `npm test`,
  not just build), then **M1** command/keybinding foundation (roadmap §4+§7).

### Canvas handoff entries below


### 2026-07-11 — neuron.style extension v1

- Work completed: versioned `neuron` style extension (model functions +
  validation + presets), card rendering (shape/border/align/fontSize/opacity),
  compact style panel (toolbar palette button + context-menu "Style…"),
  em-based markdown sizing so fontSize scales headings; report preserved in
  plan §10; pre-existing TS failures pinned above with exact text.
- Files changed: src/renderer/canvas/model.ts, src/renderer/surfaces/
  CanvasSurface.tsx, src/renderer/index.css, tools/canvas-model.test.mjs,
  docs/plans/json-canvas-enhancements.md, this file.
- Tests run: npm test (view-security, frontmatter, htmx-views, canvas-model),
  renderer typecheck, npm run build.
- Tests passing: all suites; typecheck clean for canvas (two pre-existing
  unrelated failures documented under "Bugs and technical debt").
- Important decisions: `preset` stores provenance while concrete props are
  always written (fallback-friendly); presets also set standard `color`;
  future `neuron.version` values are read-only; groups excluded from styling
  in v1; clicking an active style chip clears that property.
- Unfinished work: group/edge styling, behavior flags, icons/shadows —
  see Deferred features.
- Recommended next step: canvas search (Next recommended tasks #1).

### 2026-07-11 — Phase 0 + Phase 1: model, history, multi-select editing

- Work completed: investigation + plan doc; new canvas model layer with
  unknown-field preservation and diagnostics; snapshot undo/redo; safe
  Markdown rendering; CanvasSurface rewrite (multi-select, marquee,
  clipboard, duplicate, z-order, align/distribute, context menus, keyboard
  nudge/select-all/undo chords, snap-to-grid, zoom controls, edge
  arrow/reverse controls, unsupported-node fallback, broken-ref badge).
- Files changed: see plan §3 + this file's context section.
- Tests run: `npm test` (all suites), typecheck, `npm run build`.
- Tests passing: canvas-model, view-security, frontmatter, htmx-views.
- Important decisions: snapshot undo over operation classes (rationale in
  plan §3); Shift+drag marquee to preserve pan muscle memory; unknown node
  types render read-only.
- Unfinished work: everything in "Deferred features".
- Recommended next step: `neuron` style extension (see Next recommended
  tasks #1) — parser support already in place.
