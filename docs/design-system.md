# Neuron Design System

## Direction

Neuron is a desktop writing instrument used in focused, often dim indoor environments. Its restrained graphite surfaces reduce glare while a mineral-green accent marks selection, focus, and successful local state. The visual language is sharp, quiet, and tactile without pretending to be a terminal.

## Color

`src/renderer/lib/theme.ts` is the canonical runtime palette model. It applies core CSS tokens for four presets: **Graphite** (default), **Void**, **Nord**, and **Light**. `src/renderer/index.css` duplicates Graphite as the initial `:root` palette so startup never flashes an unthemed surface.

Core roles are canvas, navigation, surface, hover surface, divider, three ink levels, accent, positive, danger, warning, and info. Accent is reserved for primary actions, selection, focus, and active state. Semantic colors always include an icon or label.

Chrome (`--nav`) and content (`--canvas`) must read as separate planes. In the light preset they were 1.5% apart in lightness, so the sidebar, title bar and status bar dissolved into the page.

`tools/contrast.test.mjs` holds every text role to WCAG AA against all three backgrounds text sits on — canvas, surface **and** nav.

Markdown rendering uses a separate role layer derived from the active preset: `--md-heading`, `--md-text`, `--md-bold`, `--md-link`, `--md-code`, `--md-code-bg`, `--md-quote`, and `--md-quote-border`. User overrides apply to both live preview and reading view and persist under the `appearance` settings key.

## Typography

- UI: system sans stack, with medium and semibold weights carrying hierarchy.
- Source, filenames, counts, and graph labels: system monospace stack with tabular figures.
- Base UI text: 13px; compact metadata: 11px; workspace title: 15px.
- Product headings use a fixed scale and no display typography.
- Prose preview is capped near 70ch with comfortable line height.
- Labels use sentence case. Uppercase is limited to genuinely abbreviated status text.

## Geometry and spacing

- Desktop-only minimum viewport: 960 × 640; default Electron window: 1280 × 820.
- Left navigation rail: 272px.
- Editor and preview share remaining width equally, with a single divider.
- Spacing follows a 4px base: 4, 8, 12, 16, 20, 24, 32.
- Controls use 6px corners; panels remain square and are separated by dividers, not cards.
- No nested cards, ornamental shadows, glass effects, gradient text, or accent side stripes.

### Control sizes

Two, and only two, both defined in `index.css`:

- `--control-sm` (28px) — dense chrome: title bar, sidebar tools, segmented switches, in-field affordances. Clears the WCAG 2.2 AA target minimum of 24px.
- `--control` (34px) — fields and standalone buttons.

Anything interactive uses one of them. Before these existed the same class of icon button shipped at 16, 21, 24 and 28px in four different files.

## Components

### Workspace navigation

Contains app identity, Editor/Graph mode switch, file search, note creation, file list, and tag filters. Selected rows use a full low-chroma accent surface plus icon and text changes. Destructive actions appear on row focus or hover and require a second explicit action.

### Segmented control

Every mutually exclusive switch uses `Segmented` (`components/ui/segmented.tsx`), styled by `.segmented` in `index.css`: editor view modes, surface preview/source, database table/board/cards, plugin category filters. Options carry an icon and a label, disabled options carry a `title` saying why.

The editor's three view modes are named **Reading**, **Live** and **Split** wherever they appear, including in a workspace with its own `layout.json`. A layout's editor panel owns its mode, so the pane header does not also offer one.

### Pane headers

Each pane header names its role on the left and shows useful state on the right. Source shows the active path and save state; preview shows MDX render status. Headers are compact and visually subordinate to content.

### Editor

CodeMirror uses the same canvas and divider tokens as the shell. Active line, selection, gutters, and focus are perceptible without bright blocks. Saving feedback is textual and does not interrupt typing.

### Preview

Rendered prose prioritizes reading. Custom MDX components use a single surface boundary. Callouts use full subtle borders and state icons, never colored side stripes.

Markdown tables use a quiet bordered frame, a distinct header surface, compact cells, alignment from the divider row, and horizontal overflow instead of compressing content below readability. The frame — border, radius, clipping and vertical rhythm — belongs to the scroll wrapper in `MDXPreview`; `index.css` styles only the table's typography and cells. Setting both is what put an empty band above every header row.

Headings in the preview carry hierarchy through size and weight alone. No rule under `h1`.

Hovering a block to jump to its source lights its border one step, not the accent: accent means selection, focus, or a primary action.

### Plugin peeks

Plugins register panels for either the right-side peek or bottom peek. Side views suit assistants, calendars, and inspectors; bottom views suit terminals, logs, and diagnostics. Both regions are independently collapsible, use the same pane-header tabs, and keep the central editor mounted while open.

### Graph

The graph is a workspace, not a dashboard card. Nodes are stable between selection changes. Search results occupy a contextual inspector on the right only when a query exists.

## Interaction and motion

- Hover/focus transitions: 140–180ms using `cubic-bezier(0.16, 1, 0.3, 1)`.
- Pressed controls translate by 1px; no decorative scale or page-load choreography.
- Focus rings are 2px and offset from the control.
- `prefers-reduced-motion: reduce` removes nonessential transitions.
- Empty, saving, saved, parsing, parse-error, no-results, and file-operation-error states use direct copy.

## Accessibility

- WCAG 2.2 AA contrast for text and controls.
- Minimum interactive target height: 30px in dense tool areas, 36px for primary actions.
- Icon-only controls require `aria-label` and a visible tooltip through `title`.
- Mode controls expose pressed state; active notes expose current selection.
- Keyboard focus must never be removed without an equivalent replacement.
