# Notion-like UI: library evaluation & design-system roadmap

> Status: research + phased plan. First slice implemented (see [First slice](#first-slice-shipped)).
> Audience: Neuron maintainers. Scope: renderer UI + HTMX view kit. Not a Notion clone —
> Neuron adopts Notion's *qualities* (calm hierarchy, keyboard-first flow, excellent
> menus/popovers, inline editing, hover actions, block affordances, lightweight databases,
> consistent empty/loading/error states) while keeping its local-first, Markdown-as-source,
> sandboxed, Electron architecture.

## TL;DR recommendation

**Add no new UI or editor dependency.** Neuron already stands on the exact foundation this
research would otherwise recommend building toward:

- **Component system:** an *owned* [shadcn/ui](https://ui.shadcn.com) "new-york" library
  (~60 components in `src/renderer/components/ui/`) on the full set of
  [Radix UI](https://www.radix-ui.com) primitives, with CVA + `clsx` + `tailwind-merge`,
  Tailwind 3.4, a CSS-variable token system, runtime theme presets, a semantic z-index
  scale, and a focus-ring token.
- **Editor:** [CodeMirror 6](https://codemirror.net) with Markdown as the source of truth,
  plus a **decoration/widget-based "live" layer** that already renders Notion-style block
  chrome (drag handle + hover toolbar, `.cm-lp-block*`) and inline React widgets — without a
  separate JSON document model.
- **Supporting libs already in place:** [cmdk](https://cmdk.paco.me) (command palette),
  [sonner](https://sonner.emilkowal.ski) (toasts), [@tanstack/react-table](https://tanstack.com/table)
  (data tables), `react-resizable-panels`, `lucide-react`, `next-themes`.

The valuable work is therefore **cleanup + expansion of the owned system**, a **Notion-like
consistency audit**, **completion of the HTMX CSS kit**, and a **phased, optional in-editor
block-UX layer built on the existing CodeMirror decorations** — not a block-editor library.
Every block-editor library (BlockNote, Yoopta, Novel, Mina) imposes a JSON block document
model that conflicts with Markdown-first storage and MDX safety, so all are **inspiration
only**.

---

## 1. Current architecture audit

Inspected before evaluating any dependency (no dependency was added during the audit).

| Area | Implementation | Notes |
| --- | --- | --- |
| Renderer framework | React 18.3 + Vite + TypeScript 5.4 | `type: commonjs` main; Electron 42. |
| Styling system | Tailwind 3.4 + `tailwindcss-animate`, CVA, `clsx`, `tailwind-merge` | shadcn "new-york", `baseColor: neutral`, `cssVariables: true`, no prefix (`components.json`). |
| Design tokens | CSS variables in `src/renderer/index.css` | `--canvas/--nav/--surface/--surface-hover/--divider/--ink*/--accent*/--positive/--danger/--warning/--info`, a **shadcn bridge** (`--background/--card/--primary/--border/--ring…`), `--radius: 4px`, `--focus` ring, `--ease-out`, **semantic z-scale** `--z-titlebar…--z-toast`. Themes (Graphite/Void/Nord/Light) override on `<html>` at runtime via `lib/theme.ts`. `color-mix(in oklch …)` used throughout. |
| Component library | **Owned shadcn/ui**, ~60 files in `components/ui/` | button, input, textarea, dialog, alert-dialog, tabs, tooltip, popover, dropdown-menu, context-menu, menubar, navigation-menu, command (cmdk), badge, card, empty, skeleton, spinner, alert, sidebar, breadcrumb, resizable, sonner, table, data-table, kbd, avatar, calendar, date-picker, select, native-select, combobox, checkbox, radio-group, switch, slider, progress, separator, scroll-area, toggle(+group), pagination, field, input-group, button-group, item, typography, chart, carousel, drawer/sheet, hover-card, collapsible, accordion, aspect-ratio, input-otp, direction. |
| Radix usage | Full primitive set installed | accordion, alert-dialog, aspect-ratio, avatar, checkbox, collapsible, context-menu, dialog, direction, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, slot, switch, tabs, toggle(+group), tooltip. |
| Editor | CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/lang-markdown`, `language-data`, `state`, `view`) | Source mode + **live mode** (`LiveEditor.tsx`): `StateField` → `Decoration`/`WidgetType` renders `FrontmatterWidget`, `ReactWidget` (block/inline React components with `.cm-lp-block` handle + hover toolbar), `TaskCheckboxWidget`. Markdown text is the model; blocks are decorations. |
| Markdown/MDX render | Hand-rolled parser `MDXPreview.tsx` (reading mode) | Supports `<Badge>`, `<Callout>`, `<DbView>`, GFM tables, wiki-links, tags. Untrusted HTML routed through `sanitizeHtmlToReact` (`lib/sanitize-html.ts`). `@mdx-js/*` present but rendering is the safe custom parser. |
| Canvas surface | `CanvasSurface.tsx` + `canvas/` (model/history/markdown) | JSON Canvas (Obsidian-compatible), pan/zoom, multi-select, styling. |
| Database surface | `DbSurface.tsx` (`.db` = Notion-style JSON) | Table/board(kanban)/gallery, typed props, colored selects, filter/sort, atomic writes, live reload. `.vw-*` CSS in `index.css`. |
| HTMX view CSS | `src/main/htmx/theme.ts` (`NEURON_VIEW_CSS`) | shadcn-style kit served to sandboxed webviews: tokens (light/dark), semantic-element defaults, `card/btn/badge/input` components + legacy `neuron-*` aliases. No remote fonts/CSS/scripts (strict CSP). |
| Command palette | `CommandPalette.tsx` on **cmdk** | Groups: Actions, Plugin commands, Notes. No in-editor slash menu yet. |
| Toasts | **sonner** (`ui/sonner.tsx`) | |
| Settings / sidebar / tabs / dialogs / menus | Custom shell (`App.tsx`, `Sidebar.tsx`, `NoteTabs.tsx`, `TitleBar.tsx`, `StatusBar.tsx`, `RightPanel.tsx`, `ActivityRail.tsx`) + shadcn primitives | Resizable VS Code-style docks (`react-resizable-panels`). |
| Accessibility utilities | `--focus` ring token, global `:focus-visible` box-shadow, `prefers-reduced-motion` block, `text-wrap: balance/pretty`, custom scrollbars; WCAG 2.2 AA target (PRODUCT.md) | Radix gives roving focus / ARIA for free. |

**Conclusion of the audit:** the "adopt vs. copy patterns vs. reference" question is *already
answered by the codebase*. Neuron has adopted Radix + an owned shadcn system and a
Markdown-first CodeMirror editor with a block decoration layer. The right posture is **expand
and standardize what exists**, treat external kits as **references/pattern donors**, and reject
anything that would replace the editor's data model or the sandbox posture.

---

## 2. Decision framework

For each candidate, we ask: does it *improve architecture, accessibility, or maintainability*
more than owning the equivalent pattern would? A dependency earns its place only if it clears
all of:

1. **License** permits MIT-compatible bundling in a shipped Electron app.
2. **Data model** does not fight Markdown-as-source-of-truth or MDX safety.
3. **Security**: no unsafe HTML injection, remote scripts, uncontrolled iframes, or unrestricted
   JS execution; works offline; safe inside the sandboxed webview where relevant.
4. **Theming** via CSS variables (light/dark, narrow panes) without hard-to-override global CSS.
5. **Net maintenance** is lower than owning the pattern (fewer moving parts, not more).

Neuron's existing stack already clears these; most external candidates fail #2, #3, or #5 for
Neuron specifically (not on their own merits).

---

## 3. Library comparison

Columns: **Library · Category · Best use in Neuron · Dep or inspiration · License · Maturity ·
A11y · Theming · Bundle impact · Editor compatibility · Security risk · Maintenance risk ·
Recommendation.** (Maturity/maintenance reflect signals as of mid-2026.)

### Component systems & primitives

| Library | Category | Best use in Neuron | Dep / inspiration | License | Maturity | A11y | Theming | Bundle impact | Editor compat | Security risk | Maint. risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Radix UI** | Headless primitives | Already the base for every menu/dialog/popover | **Dep (in use)** | MIT | Mature, very active | Excellent (WAI-ARIA, focus mgmt) | Unstyled → CSS vars | Tree-shaken per-primitive | N/A | Low | Low | **Keep & standardize on it** |
| **shadcn/ui** | Owned copy-paste components | The whole `ui/` layer | **Owned (in use)** | MIT | Mature, very active | Inherits Radix | CSS vars (already bridged) | You own it; zero runtime lib | N/A | Low | Low (you maintain) | **Keep, clean up, expand** |
| **cmdk** | Command menu | Command palette (in use) | **Dep (in use)** | MIT | Mature | Good | CSS vars | Tiny | N/A | Low | Low | **Keep** |
| **sonner** | Toasts | Toaster (in use) | **Dep (in use)** | MIT | Mature | Good | CSS vars | Tiny | N/A | Low | Low | **Keep** |
| **@tanstack/react-table** | Headless table | `.db` / DataTable | **Dep (in use)** | MIT | Mature, very active | Headless (you wire ARIA) | N/A (headless) | Moderate | N/A | Low | Low | **Keep; use for DataTable** |
| **Untitled UI React** | Copy-paste components (React Aria + Tailwind) | Pattern donor for a specific accessible control if ever missing | **Inspiration** | MIT (base); PRO paid ($349+) | Active | Excellent (React Aria) | Tailwind utility-based | N/A (copy) | N/A | Low (if copied selectively) | Low | **Reference only** — mixing React Aria with Radix adds a second a11y runtime; copy a pattern, not the lib |
| **TailGrids** | Tailwind blocks/templates | Marketing/landing blocks (not app UI) | **Inspiration** | MIT core (freemium) | Active | Variable | Tailwind utilities | N/A (copy) | Low | Med | **Reference only** — block/marketing focus, not app primitives |
| **Twistail** | Copy-paste (Radix + Tailwind v4) | Chart/dataviz pattern ideas | **Inspiration** | OSS (Apache/MIT-influenced) | Young | Inherits Radix | Tailwind v4 (Neuron is v3) | N/A (copy) | Low | Med-High (small project) | **Reference only** — redundant with your Radix+shadcn; TW v4 mismatch |
| **Tailwind Catalyst** | Commercial UI kit | — | **Reject** | Commercial (Tailwind Plus, paid, non-redistributable) | Mature | Good (Headless UI) | Tailwind | N/A | N/A | Low | Low | **Reject** — license forbids shipping in an MIT OSS repo |
| **notion-kit** (steeeee0223) | Notion-style components | Visual/interaction reference for sidebar rows, property rows | **Inspiration** | Community (small) | Young/solo | Unknown | CSS-var friendly | N/A (copy) | Low | High (bus factor) | **Reference only** |
| **react-notion-x** | Notion API renderer | — | **Reject** | MIT | Mature | Good | — | Heavy | N/A | Renders *Notion's* hosted data (remote) | Low | **Reject** — solves a different problem (rendering notion.so pages) |

### Block / rich-text editors

| Library | Category | Best use in Neuron | Dep / inspiration | License | Maturity | A11y | Theming | Bundle impact | Editor/data model | Security risk | Maint. risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Neuron current** (CM6 + decorations) | Markdown editor + block layer | The editor | **Owned (in use)** | MIT deps | Mature (CM6) | Good | CSS vars | Already bundled | **Markdown text = model**; blocks are decorations | Low (no HTML injection; sanitized preview) | Low | **Keep & extend** |
| **BlockNote** (TypeCellOS) | Block editor | Slash/handle UX reference | **Inspiration** | MPL-2.0 (core); XL packages **GPL-3.0** | Active (v0.51.x, 2026) | Good | CSS vars / theme obj | Heavy (ProseMirror + TipTap) | **JSON block doc**; Markdown import/export is lossy | Med (renders rich HTML; own sanitizer) | Low | **Reject as dep** — JSON model replaces Markdown; GPL in XL is a licensing trap |
| **Yoopta-Editor** | Block editor (Slate) | Slash-menu & plugin-shape reference | **Inspiration** | MIT | Active but **RC** (4.0.0-rc, 2026) | Fair | CSS vars | Heavy (Slate + plugins) | **Slate JSON doc**; no Markdown source | Med | Med (pre-1.0) | **Reject as dep** — pre-1.0, Slate model, Markdown round-trip not first-class |
| **Novel** (steven-tey) | Notion WYSIWYG (TipTap) | Bubble-menu / AI-affordance reference | **Inspiration** | Apache-2.0 | Active | Fair | Tailwind | Heavy (TipTap + AI SDK) | **TipTap JSON/HTML**; headline feature needs OpenAI (network) | Med-High (AI network path; HTML) | Low | **Reject as dep** — Next.js-shaped, network AI, non-Markdown model |
| **Mina Rich Editor** | Block editor | Theme-preset / extension-API reference | **Inspiration** | MIT | Young (solo maintainer) | Unknown | CSS vars (Notion/Minimal/GitHub presets) | ~45 KB gzip (no ProseMirror) + Yjs/AI | **Own block JSON**; AI + Yjs built in | Med (AI implies network) | High (bus factor, young) | **Reject as dep** — young, own model, network-leaning |
| **TipTap** (underlying) | ProseMirror toolkit | What BlockNote/Novel build on | **Inspiration** | MIT (core) | Mature | Good | CSS | Heavy | JSON/ProseMirror | Med | Low | **Reference** — if Neuron ever needs a true WYSIWYG surface, evaluate here, still behind Markdown |

---

## 4. Block-editor deep dive: replace, wrap, or keep?

**Decision: keep Markdown as the source of truth; *wrap* it with Notion-like affordances by
expanding the existing CodeMirror decoration layer. Do not adopt a block-editor library.**

Why not replace the editor with BlockNote/Yoopta/Novel/Mina:

| Concern | Impact of adopting a block editor |
| --- | --- |
| **Storage model** | All four store a **JSON block document**. Neuron's contract is *plain Markdown/MDX files* ("workspaces remain usable without Neuron"). Adopting one means either dual-writing JSON↔Markdown (drift, conflicts) or abandoning Markdown-first. |
| **Markdown round-trip fidelity** | Import/export is **lossy** (custom blocks, callouts, MDX components, exotic HTML degrade or vanish). Every open→edit→save risks silent data loss. |
| **MDX compatibility** | `.mdx` mixes JSX components with Markdown. Block editors don't model MDX component nodes; opening an `.mdx` would corrupt or strip `<Badge/>`, `<DbView/>`, etc. |
| **Frontmatter** | YAML frontmatter is first-class in Neuron (properties panel, tags). Block editors treat it as opaque text or drop it. |
| **Undo/redo** | A second editor brings its own history stack, competing with CodeMirror and the app's file-watch reload. |
| **Plugins** | Neuron's plugin API renders MDX components + panels; a block editor's plugin model is incompatible and would fork the extension story. |
| **Collaboration** | Yjs/CRDT (Yoopta, Mina) is irrelevant to a local-first single-user file model and adds a networked state surface. |
| **Search/indexing** | Neuron greps Markdown text. A JSON block model needs a separate indexer. |
| **Security** | Rich-HTML editors widen the XSS surface; Neuron deliberately routes untrusted content through `sanitizeHtmlToReact` and sandboxes views. |
| **Migration complexity** | High: a data-model migration + re-plumbing preview, canvas cards, `.db`, plugins, and file watching. |

**What Neuron already has that these libraries are famous for:** block drag-handle + hover
toolbar (`.cm-lp-block-handle` / `.cm-lp-block-toolbar`), inline React widgets, task checkboxes
as widgets, frontmatter-as-widget — all as **decorations over Markdown**, so the file on disk
stays plain text.

**Phased plan to close the remaining Notion-editor gaps (dependency-free):**

- **Phase E1 — Slash menu (`/`)**: a CodeMirror input handler that opens the existing cmdk-style
  menu at the caret to insert Markdown snippets (headings, list, task, table, callout, `<DbView/>`).
  Pure text insertion; no model change.
- **Phase E2 — Block hover actions everywhere**: extend the `.cm-lp-block` handle/toolbar to
  plain Markdown lines (drag-to-reorder = move lines; duplicate/delete = text ops), not just
  React-widget blocks.
- **Phase E3 — Turn-into / block type menu**: transform the current line's Markdown prefix
  (`#`, `- [ ]`, `>`), a text transform.
- **Phase E4 (only if a true WYSIWYG surface is ever required)**: evaluate TipTap behind a
  Markdown serializer as an *optional* alternate view, never the storage model.

If any phase would compromise Markdown-first storage or MDX safety, stop and keep the snippet
approach.

---

## 5. Component-system roadmap (owned shadcn + Radix)

Neuron is already standardized on Radix + owned shadcn. The roadmap is **cleanup + fill gaps +
document**, not replacement. Every component must use Neuron CSS variables, support light/dark,
have accessible focus states, and work in narrow panes.

| Component | Status | Action |
| --- | --- | --- |
| Button, IconButton | ✅ `ui/button.tsx` (+ `button-group`) | Add an explicit `IconButton` size/variant; audit for one-off buttons in the shell. |
| Tooltip, Popover, DropdownMenu, ContextMenu | ✅ | Ensure all use `--z-*` scale; verify narrow-pane collision handling. |
| Dialog, AlertDialog, Drawer/Sheet | ✅ | Consistent close affordance + focus return. |
| CommandMenu | ✅ (cmdk) | Add in-editor slash trigger (Phase E1). |
| Tabs | ✅ | Align tab density with NoteTabs. |
| Sidebar | ⚠️ custom `Sidebar.tsx`; unused shadcn `ui/sidebar.tsx` + dead `--sidebar-*` HSL tokens | Decide: adopt `ui/sidebar` or delete it + the unused tokens (drift). |
| Breadcrumbs | ✅ `ui/breadcrumb.tsx` (unused?) | Wire into the editor header or remove. |
| Card | ✅ `ui/card.tsx` | Standardize the few ad-hoc card divs onto it. |
| PropertyRow | ⚠️ exists inside `DocumentProperties.tsx` | Extract a reusable `PropertyRow`. |
| DataTable | ✅ `ui/data-table.tsx` (+ tanstack) | Use for read-only DB embeds/settings. |
| Badge, Avatar | ✅ | — |
| Toast | ✅ (sonner) | — |
| EmptyState | ✅ `ui/empty.tsx` + `.empty-state-icon` | One canonical empty component; retire bespoke empties. |
| Skeleton | ✅ `ui/skeleton.tsx` | Prefer skeletons over spinners in content areas. |
| Alert | ✅ `ui/alert.tsx` (+ `.callout`) | Unify Alert vs Callout vocabulary. |
| Toolbar | ⚠️ ad-hoc (`.mode-switch`, pane headers) | Add a `Toolbar` component (Radix Toolbar or owned) for editor/canvas/db headers. |
| SplitPane, ResizableHandle | ✅ `ui/resizable.tsx` + `.resize-handle` | — |
| ShortcutRecorder | ❌ | New component for a future keybindings UI. |
| PermissionPrompt | ⚠️ bespoke in `HtmxViewSurface.tsx` | Extract a reusable `PermissionPrompt` for HTMX + plugin grants. |
| Kbd | ✅ `ui/kbd.tsx` (React) + **`.neuron-kbd` now added** to the HTMX kit | Use in palette hints, tooltips, shortcut docs. |

---

## 6. HTMX view CSS kit

The kit in `src/main/htmx/theme.ts` (`NEURON_VIEW_CSS`) intentionally **matches the React look
via the same token names** but is a hand-written CSS file (no React) served to sandboxed
webviews. It relies on **no remote fonts, CDN CSS, or scripts** (blocked by CSP anyway).

Required class set — all present after the first slice:

`.neuron-view` · `.neuron-card` · `.neuron-button` · `.neuron-input` · `.neuron-table` ·
`.neuron-badge` · `.neuron-toolbar` · `.neuron-stack` · `.neuron-grid` · `.neuron-alert` ·
`.neuron-empty` · **`.neuron-kbd`** (added). Plus the shadcn-style aliases `card` / `btn` /
`badge` / `input` and semantic-element defaults (a bare `<section>` is a card, etc.).

Rules: keep it token-driven (light/dark), keep semantic elements styled so authors can write
plain HTML, and keep the class visuals within one or two pixels of their React counterparts.

---

## 7. Notion-like UI consistency audit

Goal: calmer, sharper, more consistent — **not flashier**.

| Surface | Finding | Fix |
| --- | --- | --- |
| **Spacing** | Two token systems: React uses ad-hoc rem values in places; HTMX kit now uses a scale; `.db` uses `.vw-*`. | Define one 4pt spacing scale as CSS vars and adopt it renderer-wide (mirrors the kit). |
| **Typography** | `.preview-prose`, `.vw-content`, `.cm-live-editor`, and kit each set their own heading scale. | Extract a shared type scale (sizes/weights/line-height) as tokens; have all four reference it. |
| **Sidebar density** | Good (34px rows, hover states) but selection contrast is subtle. | Slightly stronger `data-selected` treatment; align row height token with tabs. |
| **Tabs** | `NoteTabs` labels strip only `.md/.mdx`; `.db/.canvas/.nhtml/.ndash` show extensions. | Map extensions to friendly labels + a per-type icon (parity with the sidebar app icon). |
| **Editor header** | Source/Preview `.mode-switch` is bespoke, not the `Toolbar` component. | Move to a shared `Toolbar`; add breadcrumb (folder → file). |
| **Properties panel** | `DocumentProperties` rows are one-off. | Extract `PropertyRow`; align with `.db` cell affordances. |
| **Canvas controls** | Zoom/align controls styled locally. | Reuse `Toolbar` + IconButton so canvas matches editor. |
| **Database views** | `.vw-*` table is strong; board/gallery cards are read-only summaries. | Keep; align chip colors + empty state with the kit; ensure header uses `Toolbar`. |
| **HTMX toolbar** | `.neuron-toolbar` exists; demos underuse it. | Standardize example views on `toolbar` + `btn` + `kbd`. |
| **Command palette** | Good groups; no shortcut hints or in-editor slash. | Add `Kbd` shortcut hints; Phase E1 slash trigger. |
| **Settings pages** | Mixed field styles (`.field` vs shadcn Input). | Standardize on shadcn `Field`/`Input`; group with `Card`. |
| **Permission prompts** | Bespoke card in `HtmxViewSurface`. | Extract `PermissionPrompt`; reuse for plugin grants. |
| **Examples (demo repo)** | Now consistent (Team dashboard, templates, folder app, `.ndash`). | Add a `kbd` example; keep one idiom per surface. |
| **Loading states** | Mixed: "Loading…" text vs `–` skeleton. | Prefer `Skeleton` in React content; keep specific text ("Loading tags…") in HTMX. |
| **Empty states** | `ui/empty.tsx` exists but bespoke empties remain. | One `EmptyState` everywhere: icon + one line + optional action. |
| **Error states** | Good structured errors in views; renderer varies. | One `Alert`/error surface vocabulary; always name a recovery. |

---

## 8. Phased implementation plan

- **Phase 0 — this document + first slice** (done): complete the HTMX kit (`.neuron-kbd`),
  record the plan, seed the backlog.
- **Phase 1 — design-system cleanup (dependency-free)**: shared spacing + type-scale tokens;
  a `Toolbar` component; extract `PropertyRow`, `EmptyState`, `PermissionPrompt`; delete the
  unused `ui/sidebar.tsx` + `--sidebar-*` tokens or adopt them (resolve the drift); standardize
  cards/buttons/fields across shell + settings.
- **Phase 2 — Notion affordances (dependency-free)**: slash menu (E1), block hover actions on
  plain Markdown lines (E2), turn-into menu (E3), palette shortcut hints, friendly tab labels.
- **Phase 3 — surfaces polish**: canvas + db headers on `Toolbar`; DataTable for read-only db
  embeds; consistent empty/loading/error across every surface.
- **Phase 4 — optional, gated**: only if a true WYSIWYG surface is ever required, evaluate
  TipTap behind a Markdown serializer as an *alternate view*, never storage.

Each phase ships independently and adds **no runtime dependency** through Phase 3.

## 9. Risks

- **Drift, not dependency, is the main risk.** Two token systems + bespoke one-offs are the real
  source of "AI-ish" inconsistency; the fix is consolidation, which is low-risk but broad.
- **Editor temptation.** Adopting a block editor "for polish" would trade a small UX gain for a
  large data-loss + MDX + security regression. Gate any such move behind Phase 4 and a written
  migration plan.
- **Unused shadcn surface.** ~60 `ui/` files include components Neuron never renders; leaving
  them invites drift and dead code. Cleanup is safe but must confirm non-use first.
- **HTMX/React divergence.** Two style implementations can drift; mitigate by sharing token
  names and reviewing them together.

## 10. Acceptance criteria

- No new UI/editor runtime dependency added in Phases 0–3.
- One spacing scale and one type scale referenced by renderer, preview, `.db`, and HTMX kit.
- `Toolbar`, `EmptyState`, `PropertyRow`, `PermissionPrompt`, `IconButton` exist and are used in
  ≥2 places each; bespoke equivalents removed.
- Every interactive component has default/hover/focus/active/disabled states and passes WCAG AA
  contrast in all theme presets (light + dark).
- HTMX kit exposes the full required class set including `.neuron-kbd`, visually matching React.
- Markdown/MDX remains the on-disk source of truth; no block-editor JSON model introduced.
- `npm test` green; no console errors; reduced-motion respected.

---

## First slice (shipped)

Dependency-free, bounded, and it does **not** touch the editor:

- **Completed the HTMX CSS kit**: added **`.neuron-kbd`** (+ `kbd` alias) to
  `src/main/htmx/theme.ts` so the kit now exposes the full required class set, matching the
  React `ui/kbd.tsx`.
- **Documented** the kit's `kbd` in `docs/htmx-views.md` and this roadmap.
- The broader "standardize cards/buttons/toolbar/empty states + HTMX example styles" slice was
  substantially completed earlier this cycle: the kit was rewritten to a shadcn-style,
  token-driven system with semantic-element defaults; the Team dashboard, starter templates,
  folder mini-app, and `.ndash` example were standardized onto it.

**Explicitly deferred:** no editor replacement; no BlockNote/Yoopta/Novel/Mina; the slash menu
and block-UX phases wait for a separate editor plan (Phase 2).

### Next recommended step

**Phase 1, step 1:** introduce shared **spacing + type-scale tokens** in `index.css` and the
HTMX kit, then add a `Toolbar` component and move the editor's Source/Preview `.mode-switch`
onto it. This removes the biggest source of cross-surface inconsistency with zero new
dependencies.

---

## Sources

- Radix UI — <https://www.radix-ui.com> · shadcn/ui — <https://ui.shadcn.com>
- cmdk — <https://cmdk.paco.me> · sonner — <https://sonner.emilkowal.ski> · TanStack Table — <https://tanstack.com/table>
- CodeMirror 6 — <https://codemirror.net>
- BlockNote — <https://www.blocknotejs.org/> · repo <https://github.com/TypeCellOS/BlockNote> · releases <https://github.com/TypeCellOS/BlockNote/releases>
- Yoopta-Editor — <https://yoopta.dev/> · repo <https://github.com/yoopta-editor/Yoopta-Editor> · npm <https://www.npmjs.com/package/@yoopta/editor>
- Novel — <https://novel.sh/> · repo <https://github.com/steven-tey/novel> · npm <https://www.npmjs.com/package/novel>
- Mina Rich Editor — <https://mina-rich-editor.vercel.app/> · repo <https://github.com/Mina-Massoud/Mina-Rich-Editor>
- Untitled UI React — <https://www.untitledui.com/react> · repo <https://github.com/untitleduico/react> · pricing <https://www.untitledui.com/pricing>
- Tailwind Catalyst — <https://catalyst.tailwindui.com/docs> · <https://tailwindcss.com/plus/ui-kit>
- TailGrids — <https://tailgrids.com/> · repo <https://github.com/Tailgrids/tailgrids>
- Twistail — <https://twistail.com/docs> · repo <https://github.com/riipandi/twistail>
- notion-kit — <https://github.com/steeeee0223/notion-kit> · react-notion-x — <https://github.com/NotionX/react-notion-x>
