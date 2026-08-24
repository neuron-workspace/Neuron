# T-042 — Impeccable sweep of the Neuron interface

Audit date: 2026-08-24

This is a source-verified product audit, not a redesign proposal. It applies the
Impeccable product register, technical audit, critique, and polish checks to the
current Electron renderer and the stylesheet served to sandboxed HTML views.
The ranking is by user cost: legibility and broken interaction paths come before
component-shape or spacing polish.

## Register verdict

Neuron is closest to the product register where it behaves like a familiar,
dense desktop tool. The shell uses conventional rails, tabs, panes, dropdowns,
and a command palette (`src/renderer/App.tsx:657`,
`src/renderer/components/TitleBar.tsx:88`); its restrained palette assigns the
accent to selection and action rather than decoration
(`src/renderer/index.css:9`); and the shared component layer gives controls a
consistent small-radius vocabulary (`src/renderer/components/ui/button.tsx:5`,
`src/renderer/components/ui/input.tsx:4`). Graph nodes are genuinely keyboard
operable rather than merely painted as controls
(`src/renderer/components/GraphCanvas.tsx:357`). Error states in the Canvas,
HTML-view, MDX, database, and frontmatter surfaces generally preserve the file
and tell the user how to recover (`src/renderer/surfaces/CanvasSurface.tsx:459`,
`src/renderer/surfaces/HtmxViewSurface.tsx:151`,
`src/renderer/components/MDXPreview.tsx:566`,
`src/renderer/surfaces/DbSurface.tsx:415`,
`src/renderer/components/properties/DocumentProperties.tsx:77`). These are the
parts a Linear/Figma/Notion/Raycast user would trust without pausing.

It reads as “almost right” where the system stops being systemic. Three presets
put common small text below WCAG AA; reading-view blocks advertise clickability
without a keyboard equivalent; wiki-links look like links but are inert; several
row actions exist only on hover; keybindings have neither focus scope nor
collision prevention; sandboxed HTML views use a separate green theme instead
of the selected preset; and the declared spacing/type scale is unused. Those
are not requests for a new visual direction. They are trust leaks in an otherwise
credible product vocabulary.

### Audit and critique scores

These scores are deliberately conservative because browser inspection and live
profiling were unavailable. They summarize the source evidence below; they are
not substitutes for the ranked work list.

| Technical dimension | Score | Evidence-led judgment |
| --- | ---: | --- |
| Accessibility | 2/4 | Good global focus treatment and Radix primitives, but pointer-only reading interactions, hidden keyboard actions, tab semantics, and contrast failures remain. |
| Performance | 3/4 | No source-level blocking issue found; graph animation is bounded and reduced motion is global. Runtime frame, paint, and bundle measurements were not available. |
| Responsive structure | 2/4 | The desktop shell intentionally has a minimum size, but explicit MDX grids and the workspace table do not adapt to narrow panes. |
| Theming | 2/4 | Four coherent presets exist, but semantic contrast, hardcoded reading hover colors, unused scale tokens, and the separate HTML-view theme prevent a full-system score. |
| Anti-patterns | 2/4 | The overall product is restrained, but three explicit bans fail: accent side-stripe selection, custom scrollbars, and a border-plus-wide-shadow ghost surface. |
| **Audit health** | **11/20 — Acceptable** | Significant fixes are needed, but no overhaul is warranted. |

| Nielsen heuristic | Score | Main reason |
| --- | ---: | --- |
| Visibility of system status | 2/4 | Plugin discovery and workspace mutations can fail without visible state. |
| Match with the real world | 3/4 | File/folder/workspace language is mostly natural. |
| User control and freedom | 3/4 | Undo, cancel, Source-mode recovery, and reversible workspace removal are strong. |
| Consistency and standards | 2/4 | Form heights, panel terminology, themes, and interaction disclosure drift by surface. |
| Error prevention | 2/4 | Duplicate keybindings are accepted even though one command then becomes unreachable. |
| Recognition rather than recall | 2/4 | Tooltips help, but icon-only navigation and hover-only row actions still demand recall or pointer discovery. |
| Flexibility and efficiency | 2/4 | Shortcuts and palette exist, but the one global dispatcher has known focus holes. |
| Aesthetic and minimalist design | 3/4 | Restrained hierarchy and density are appropriate; card use is mostly functional. |
| Error recovery | 2/4 | File-surface recovery is good; plugin/repository async recovery is not. |
| Help and documentation | 2/4 | Empty-state guidance and tooltips exist, but there is little contextual help for advanced surfaces. |
| **Design health** | **23/40 — Acceptable** | Solid foundation; functional trust gaps precede polish. |

The cognitive-load checklist has two material failures: recognition rather than
recall (hover-only controls and the icon rail) and consistent pattern learning
(the same panel and form concepts vary by surface). Grouping, single focus,
progressive disclosure, and the restrained visual hierarchy are otherwise sound.

## Prioritized findings

### 1. P1 — Semantic text fails contrast in Graphite, Nord, and Light

**Location:** preset values at `src/renderer/lib/theme.ts:39`; semantic mappings
at `src/renderer/index.css:42`; muted text is used throughout surface cards and
panels, for example `src/renderer/views/SettingsPage.tsx:196`; danger text is
used for 11px save/error labels at `src/renderer/App.tsx:574` and frontmatter
errors at `src/renderer/components/properties/DocumentProperties.tsx:80`.

**What is wrong:** the minimum `--ink-muted` ratio across the three common shell
backgrounds is 4.29:1 in Graphite, 3.84:1 in Nord, and 4.31:1 in Light. Nord
`--danger` falls to 2.46:1 on `--surface`. Light `--accent`, `--danger`, and
`--warning` are also below 4.5:1 on at least one common surface. These colors are
used at 10–12px, so the large-text exception does not apply.

**Why it matters:** low-vision users lose labels precisely where the interface
is densest; every user gets a weaker hierarchy and has to pause over status and
error text. A theme option that makes errors harder to read is a product-trust
failure, not cosmetic variance.

**Concrete fix:** adjust the affected preset tokens, not individual components.
Make `--ink-muted`, text-use `--accent`/`--info`, `--danger`, and `--warning`
meet 4.5:1 against every background on which they are used. Keep separate
foreground and indicator tokens if the same hue cannot serve both text and dots.
Add a preset contrast table to a unit test and reject Markdown color overrides
that fail against their resolved background (`src/renderer/views/SettingsPage.tsx:163`,
`src/renderer/views/SettingsPage.tsx:246`).

### 2. P1 — Wiki-links present a link affordance and do nothing

**Location:** `src/renderer/components/MDXPreview.tsx:542`.

**What is wrong:** `[[target]]` becomes an underlined, accent-colored `<span>`
with no click handler, keyboard behavior, link role, or destination.

**Why it matters:** wiki-links are a core knowledge-workspace affordance. A user
will reasonably click one, get no response, and stop trusting other rendered
content. There is no workaround from reading view except remembering the target
and finding it manually.

**Concrete fix:** resolve the target through the existing note-selection path
and render an actual link/button with Enter/Space support, visible focus, a
missing-target state, and an accessible name. Do not add a new navigation model.

### 3. P1 — Important actions are pointer-only or invisible to keyboard users

**Location:** reading blocks use `onClick` on headings, lists, blockquotes, and
paragraphs without `tabIndex`/keyboard handling at
`src/renderer/components/MDXPreview.tsx:409`,
`src/renderer/components/MDXPreview.tsx:443`, and
`src/renderer/components/MDXPreview.tsx:513`; the Sidebar folder action is
`opacity-0` with only `group-hover` at `src/renderer/components/Sidebar.tsx:177`;
Canvas note-open is hover-only at `src/renderer/surfaces/CanvasSurface.tsx:729`;
database header and row actions are hover-only at
`src/renderer/surfaces/DbSurface.tsx:604` and
`src/renderer/surfaces/DbSurface.tsx:622`.

**What is wrong:** clicking rendered Markdown jumps to its source line, but the
same operation cannot receive focus or be triggered from the keyboard. Several
secondary row actions remain fully transparent when their button receives focus
because only pointer hover changes opacity.

**Why it matters:** a keyboard user can tab onto invisible controls and cannot
invoke the reading-view shortcut at all. A power user fluent in editor products
expects keyboard parity; an invisible tab stop is worse than a merely hidden
feature because focus appears to disappear.

**Concrete fix:** expose source-jump through one explicit, focusable affordance
per block or a documented editor command rather than making every semantic text
node masquerade as a button. Add `focus-visible`/`group-focus-within` disclosure
to row actions. Preserve normal reading semantics and text selection.

### 4. P1 — Keybinding customization can silently create dead commands, and the dispatcher has no focus scope

**Location:** the dispatcher searches the first matching chord in one global
window listener at `src/renderer/App.tsx:506`; Settings writes any captured chord
without collision validation at `src/renderer/views/SettingsPage.tsx:89`; the
known terminal/webview focus hole is documented in the product code itself at
`src/renderer/components/TitleBar.tsx:149`.

**What is wrong:** assigning the same chord twice is accepted; the first
`Object.entries(bindings).find(...)` wins and the other command becomes
unreachable. The single renderer-window listener also cannot provide terminal,
webview, dialog, canvas, and editor scopes, and shortcuts do not arrive while a
webview holds focus.

**Why it matters:** users customize shortcuts specifically to gain control. A
setting that saves successfully but disables another action feels like data
corruption, while focus-dependent shortcuts make the same command intermittently
work and fail.

**Concrete fix:** complete the planned command registry and focus-scoped
dispatcher rather than adding more local listeners. During capture, detect a
collision, name the existing command, and require an explicit replace/cancel
choice. Keep a persistent non-shortcut escape for any state hosted in a webview.

### 5. P1 — Workspace and plugin mutations lack reliable loading, success, and error states

**Location:** repository rename/remove await main-process work with no pending or
error state at `src/renderer/views/RepositoriesPage.tsx:27`; their action buttons
remain enabled at `src/renderer/views/RepositoriesPage.tsx:79` and
`src/renderer/views/RepositoriesPage.tsx:103`. Plugin discovery converts every
failure into an empty array at `src/renderer/views/PluginsPage.tsx:176`; plugin
configuration saves on both blur and button click without success/error feedback
at `src/renderer/views/PluginsPage.tsx:58` and
`src/renderer/views/PluginsPage.tsx:85`.

**What is wrong:** a slow operation can be submitted repeatedly, and a failed
operation leaves the screen looking unchanged. Sandboxed plugin discovery failure
is indistinguishable from “no plugins,” and “Save settings” does not report that
anything was saved.

**Why it matters:** these are filesystem- and credential-adjacent actions. Users
need stronger confirmation here than on ordinary navigation; otherwise they
retry, create duplicate work, or assume settings were persisted when they were
not.

**Concrete fix:** give each async action an explicit pending state (`disabled`
plus `aria-busy` plus a stable label), a success acknowledgment, and an inline recoverable
error. Keep existing content visible while plugin discovery refreshes; distinguish
zero results, discovery failure, and loading.

### 6. P2 — Tabs are visually familiar but not a keyboard tab system

**Location:** `src/renderer/components/NoteTabs.tsx:24`.

**What is wrong:** open documents are a `<nav>` containing a select button and a
close button per document. There is no `tablist`/`tab` state, roving focus, arrow
navigation, Home/End, or a single-current-tab stop. A keyboard user traverses two
stops per open note plus the create and browser buttons.

**Why it matters:** with many open documents, focus order becomes long and does
not match the desktop-editor pattern the visuals promise.

**Concrete fix:** keep the visual design, but implement tab semantics and roving
focus around the select controls; keep close as a nested adjacent action exposed
for the active/focused tab. Add standard close/reopen commands through the command
registry rather than another component-level keydown.

### 7. P2 — Responsive behavior stops at the viewport and breaks inside narrow panes

**Location:** explicit MDX grids compile directly to fixed 1–6-column classes at
`src/renderer/components/mdx-layout.tsx:33` and bypass the intrinsic responsive
path at `src/renderer/components/mdx-layout.tsx:99`. The workspace table has no
horizontal-scroll wrapper or narrow layout at
`src/renderer/views/RepositoriesPage.tsx:58`.

**What is wrong:** Neuron renders notes inside full windows, split panes, and
peeks, but an explicit `<Grid cols="4">` never collapses based on its container.
The five-column workspace table likewise assumes full-page width even though the
shell can retain a sidebar and other panels.

**Why it matters:** responsive product UI is structural. Pane users get cramped
cells or clipped tables without changing the app viewport, which ordinary
viewport breakpoints cannot detect.

**Concrete fix:** use container queries or intrinsic `minmax()` rules for MDX
grids, capping requested columns to what the container can hold. Wrap the table
in a labeled horizontal scroll region or switch low-priority columns to a row
detail at narrow container widths. Do not introduce fluid typography.

### 8. P2 — Sandboxed HTML views do not inherit the selected preset

**Location:** the four app presets are defined at
`src/renderer/lib/theme.ts:39`; the HTML surface passes only `dark` or `light` at
`src/renderer/surfaces/HtmxViewSurface.tsx:49`; the served stylesheet defines a
separate green light/dark palette at `src/main/htmx/theme.ts:18` and
`src/main/htmx/theme.ts:65`.

**What is wrong:** Graphite, Void, and Nord all become the same HTMX dark theme,
and Light becomes a fixed warm-white/green theme. Opening a sandboxed view changes
the accent, neutral temperature, radii, and shadow vocabulary while the shell
around it retains the chosen preset.

**Why it matters:** cross-surface drift is the product register’s cardinal sin.
The HTML view looks like embedded third-party software even when it is a first-
party workspace surface.

**Concrete fix:** serialize the resolved semantic preset tokens into the scoped
view stylesheet/session, with capability-safe names and existing HTMX component
aliases. Keep the sandbox boundary; change only the style payload. The HTMX kit
may retain its own component tokens, but they must derive from the active app
preset.

### 9. P2 — The declared spacing and type scales are dead, so density cannot converge

**Location:** eight `--space-*`, seven `--text-*`, and two leading tokens are
declared at `src/renderer/index.css:68`; none is referenced anywhere in the
renderer or HTMX surface. Equivalent form controls independently use 34px
(`src/renderer/index.css:219`), 36px
(`src/renderer/components/ui/input.tsx:10`), padding-derived compact heights
(`src/renderer/components/properties/DocumentProperties.tsx:259`), and 36px in
HTMX (`src/main/htmx/theme.ts:175`).

**What is wrong:** the comment says the scales are a shared source of truth, but
the implementation uses Tailwind’s scale, arbitrary values, and local CSS
instead. The same form concept changes density and rhythm across Settings,
properties, databases, and HTML views.

**Why it matters:** density is allowed; unexplained density changes are not. The
dead scale also misleads maintainers into believing a system exists, so future
polish adds more one-offs.

**Concrete fix:** choose one real source of truth. The least disruptive path is
to map Tailwind’s relevant spacing/font sizes and shared field variants to the
existing CSS tokens, then migrate one component family at a time. Delete tokens
that are intentionally not part of the system; do not keep aspirational tokens.

### 10. P2 — The same panel and form concepts use different vocabulary and save behavior

**Location:** the title bar says “panel” and “bottom peek” at
`src/renderer/components/TitleBar.tsx:156`; its layout menu says “Side panel” and
“Bottom panel” at `src/renderer/components/TitleBar.tsx:175`; plugin actions say
“side peek” and “bottom peek” at `src/renderer/views/PluginsPage.tsx:132`.
Plugin fields save on blur and also offer a Save button
(`src/renderer/views/PluginsPage.tsx:80`), while properties commit edits on blur
or Enter with no Save button (`src/renderer/components/properties/DocumentProperties.tsx:313`).

**What is wrong:** “panel,” “side panel,” and “side peek” name the same region.
Forms mix implicit save and explicit save without telling the user which model
applies.

**Why it matters:** users cannot transfer learning between adjacent surfaces;
they must remember where a value saves and whether a “peek” is different from a
panel.

**Concrete fix:** choose “side panel” and “bottom panel” (or one other pair) and
use it in labels, tooltips, commands, and plugin metadata. Pick one settings save
model; if plugin configuration remains explicit, remove blur-save and show dirty,
saving, saved, and error states.

### 11. P2 — Several empty/loading states report absence instead of teaching or distinguishing failure

**Location:** the shell uses bare “Loading…” text at
`src/renderer/App.tsx:683`; MDX uses “Nothing to preview yet” at
`src/renderer/components/MDXPreview.tsx:583`; Canvas exposes tools but no first-
action empty guidance in its toolbar at `src/renderer/surfaces/CanvasSurface.tsx:802`;
plugin discovery failure collapses into the same no-result path at
`src/renderer/views/PluginsPage.tsx:176` and
`src/renderer/views/PluginsPage.tsx:255`.

**What is wrong:** these states either provide no structure during arrival or do
not explain the next useful action. Plugin empty and error are semantically
indistinguishable.

**Why it matters:** first-time and recovery moments are where the interface must
teach its mental model. “Nothing” makes users inspect the chrome for clues.

**Concrete fix:** use a shell skeleton for repository hydration, an inline
“Start writing / switch to Live editor” preview state, and a one-line Canvas
gesture hint (“Double-click to create a card; use + to add a note”). Give plugin
loading/error separate states. Keep the existing compact visual register.

### 12. P2 — Theme-independent white hover paint disappears in Light

**Location:** `src/renderer/components/MDXPreview.tsx:228`,
`src/renderer/components/MDXPreview.tsx:411`, and
`src/renderer/components/MDXPreview.tsx:515`.

**What is wrong:** clickable rendered blocks use translucent literal white for
hover feedback. On Light’s white canvas the change is effectively invisible;
on dark themes it is so faint (1–1.5% alpha) that it barely communicates state.

**Why it matters:** this is the exact kind of almost-right state that makes a
polished tool feel unreliable. It also bypasses the selected theme.

**Concrete fix:** replace every literal white hover with a semantic interactive
background token (normally `--surface-hover` mixed to the required subtlety), and
use the same state for live and reading blocks. This should land with finding 3’s
interaction redesign, not as an isolated color patch.

### 13. P3 — Three explicit Impeccable bans fail

**Location:** active activity items use a 2px colored side stripe at
`src/renderer/components/ActivityRail.tsx:31`; app-wide custom scrollbars are
defined at `src/renderer/index.css:385`; the live-editor block toolbar combines
a 1px border and an 18px-blur shadow at `src/renderer/index.css:357`.

**What is wrong:** these match the shared ban definitions exactly: colored
side-stripe selection, reinvented scrollbars in product UI, and the border-plus-
wide-shadow ghost surface.

**Why it matters:** none blocks a task, but each adds a slightly invented visual
idiom where a standard state would disappear more cleanly into the work.

**Concrete fix:** use a full selected background or icon/accent state on the
activity rail; use platform scrollbars (or restrict any styling to sizing only if
platform parity is unacceptable); and keep either the toolbar border or a shadow
with no more than 8px blur, not both.

## Token-system health

### What is healthy

- The four app presets supply the same 14 semantic inputs and apply them through
  root custom properties (`src/renderer/lib/theme.ts:26`,
  `src/renderer/lib/theme.ts:93`).
- Markdown colors derive from semantic app tokens and can be overridden without
  mutating the preset (`src/renderer/index.css:24`,
  `src/renderer/lib/theme.ts:64`).
- The shadcn bridge maps app semantics into shared components rather than
  creating a second renderer palette (`src/renderer/index.css:40`).
- Focus, motion easing, z-index, and reduced-motion behavior are named centrally
  (`src/renderer/index.css:37`, `src/renderer/index.css:61`,
  `src/renderer/index.css:374`).

### Defined and unused

The scan found zero uses of `--space-1` through `--space-8`, `--text-xs` through
`--text-2xl`, `--leading-tight`, and `--leading-normal`, all defined at
`src/renderer/index.css:68`. `--z-panel` is also unused
(`src/renderer/index.css:63`). In the HTML-view kit, `--divider-strong`,
`--on-accent`, `--shadow`, and `--shadow-md` are defined but unused
(`src/main/htmx/theme.ts:47`, `src/main/htmx/theme.ts:53`,
`src/main/htmx/theme.ts:39`). `--accent-bg`, `--accent-foreground`, and the
popover tokens are not false positives: Tailwind consumes them through
`tailwind.config.js`.

### Used and not locally defined

`--font-mono` is used with a valid `monospace` fallback at
`src/renderer/index.css:474` but is never defined. Either define it as part of the
type system or use the existing Tailwind `font-mono` family consistently. The
`--radix-*` variables reported by a raw scan are runtime-owned by Radix and are
not token defects.

### Hardcoded colors and values that bypass the system

- Literal white hover paint in reading view is a real theme defect
  (`src/renderer/components/MDXPreview.tsx:234`).
- Logo black/white values are explicitly split by light/dark mode and are a
  deliberate identity exception, not a finding (`src/renderer/index.css:444`).
- Database option colors are content/data colors rather than chrome, but their
  unnamed array should eventually become a documented data-color palette if it
  is reused (`src/renderer/surfaces/DbSurface.tsx:28`). It is not high enough cost
  to rank now.
- The HTMX palette is tokenized internally but hardcoded relative to the app’s
  four presets (`src/main/htmx/theme.ts:18`); finding 8 addresses the root cause.

## Computed contrast

Method: WCAG 2 relative luminance from the literal sRGB hex values in
`src/renderer/lib/theme.ts:40`. Each semantic value below is the minimum ratio
against `--canvas`, `--nav`, and `--surface`; this catches a token that is safe in
one layer but unsafe in another. Placeholder is shown separately against the
actual `.field`/shared Input background, `--canvas`
(`src/renderer/index.css:219`, `src/renderer/components/ui/input.tsx:10`). AA
requires 4.5:1 for normal text and placeholders, 3:1 for large text.

| Preset | Ink body | Secondary body | Muted body min | Placeholder | Accent/info body min | Danger body min | Warning body min | Positive min | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Graphite | 13.16 | 8.19 | **4.29 fail** | 4.72 pass | 7.15 | 6.70 | 9.37 | 9.42 | Muted normal text fails on surface. |
| Void | 13.30 | 6.59 | 5.41 | 5.84 pass | 10.09 | 10.14 | 10.13 | 10.11 | All measured pairs pass normal and large text. |
| Nord | 8.73 | 7.45 | **3.84 fail** | 4.77 pass | 5.03 | **2.46 fail** | 6.44 | 4.94 | Muted normal text fails; danger fails even the 3:1 large-text threshold on surface. |
| Light | 14.09 | 7.17 | **4.31 fail** | 4.83 pass | **4.10 fail** | **4.14 fail** | **3.25 fail normal** | **2.76 fail** | Multiple normal-text roles fail; positive also fails 3:1 on surface. |

`--positive` is currently used mainly as a status dot
(`src/renderer/components/StatusBar.tsx:30`), not body text. Its Light result is
therefore a non-text indicator/token warning and a latent large-text failure, not
a claim that positive body copy is currently rendered there. Light warning text
is used in the warning Badge variant (`src/renderer/components/ui/badge.tsx:12`)
and must be remeasured against its mixed warning surface after token changes.

The separate sandboxed-view themes currently pass the same checks: HTMX Light
foreground/background 16.40:1, secondary/card 7.73:1, muted placeholder/card
5.68:1, primary button 5.08:1, destructive button 5.44:1; HTMX Dark
foreground/background 15.35:1, secondary/card 8.97:1, muted placeholder/card
5.56:1, primary button 6.47:1, destructive button 5.20:1. Those values come from
`src/main/htmx/theme.ts:20` and `src/main/htmx/theme.ts:65`. Their problem is
cross-preset identity, not contrast.

Custom Markdown overrides are unrestricted hex inputs
(`src/renderer/lib/theme.ts:84`, `src/renderer/views/SettingsPage.tsx:246`), so a
user can create any contrast failure. The preset passes must not be presented as
a guarantee once an override is active.

## Missing interactive states

The shared renderer Button is the strongest family: default, hover, global
focus-visible, active, and disabled states are composed through
`src/renderer/components/ui/button.tsx:5` and
`src/renderer/index.css:113`. The following table lists only gaps.

| Control family | Missing states | Evidence | Required correction |
| --- | --- | --- | --- |
| Reading-view blocks | Focus-visible, keyboard activation, active, disabled/not-actionable distinction | `src/renderer/components/MDXPreview.tsx:407` | Do not make all prose implicit buttons; provide a focusable source-jump affordance/command. |
| Hover-revealed row actions | Visible default or visible focus disclosure | `src/renderer/components/Sidebar.tsx:177`; `src/renderer/surfaces/CanvasSurface.tsx:729`; `src/renderer/surfaces/DbSurface.tsx:604` | Add `focus-visible`/`group-focus-within` opacity and preserve the row’s focus indication. |
| Repository async actions | Loading, disabled while pending, success, error | `src/renderer/views/RepositoriesPage.tsx:27` | Model mutation state per row and announce completion/failure. |
| Plugin discovery/config | Loading, success, error | `src/renderer/views/PluginsPage.tsx:58`; `src/renderer/views/PluginsPage.tsx:176` | Separate discovery phases and show explicit save state. |
| HTML-kit inputs/selects | Hover, disabled, validation error/success | `src/main/htmx/theme.ts:175` | Add scoped `:hover`, `:disabled`, `[aria-invalid=true]`, and status styles derived from view tokens. |
| Canvas context menu | Focus entry, menuitem semantics, arrow-key active state, Escape return | `src/renderer/surfaces/CanvasSurface.tsx:473`; `src/renderer/surfaces/CanvasSurface.tsx:790` | Use the existing Radix context-menu primitive or implement its complete keyboard contract. |
| Floating graph move grip | Keyboard move/active mode, disabled bounds feedback | `src/renderer/components/FloatingGraph.tsx:36`; `src/renderer/components/FloatingGraph.tsx:83` | Add arrow-key movement with announced position/reset; keep pointer drag. |

## Keyboard and focus

- The global focus ring is coherent and uses `:focus-visible`, not `:focus`
  (`src/renderer/index.css:113`). Graph nodes expose role, label, tab stop, Enter,
  and Space (`src/renderer/components/GraphCanvas.tsx:357`). Keep both.
- Radix Dialog supplies the expected modal focus trap/restore behavior through
  the shared portal/content primitive (`src/renderer/components/ui/dialog.tsx:27`),
  and Create uses it with autofocus, Cancel, and disabled pending actions
  (`src/renderer/components/CreateModal.tsx:64`). This is source evidence; live
  trap cycling and focus return still need manual confirmation.
- Focus order is inflated in NoteTabs because every note contributes a select and
  close stop (`src/renderer/components/NoteTabs.tsx:24`). Finding 6 owns the fix.
- The Canvas root has a local keyboard scope and correctly ignores text fields
  (`src/renderer/surfaces/CanvasSurface.tsx:429`), but its custom menu does not
  enter a menu focus scope (`src/renderer/surfaces/CanvasSurface.tsx:790`).
- The known global-dispatcher defect is source-confirmed at
  `src/renderer/App.tsx:506` and `src/renderer/components/TitleBar.tsx:149`:
  shortcuts die while a webview owns focus and cannot express editor/terminal/
  dialog/canvas scopes. Finding 4 is the single owner; do not patch around it in
  each component.

## Empty, loading, and error-state coverage

“N/A” means the surface is synchronous/derived and does not need a fabricated
loading state.

| Surface | Empty | Loading | Error | Gap to address |
| --- | --- | --- | --- | --- |
| Shell/repository arrival | Actionable onboarding at `src/renderer/App.tsx:685` | Bare text at `src/renderer/App.tsx:683` | Repository open errors are not represented here | Use a stable shell skeleton and preserve a recoverable repository-open error. |
| Notes/sidebar/tags | Helpful create/search/tag copy at `src/renderer/components/Sidebar.tsx:191` and `src/renderer/components/Sidebar.tsx:237` | Refresh spinner only at `src/renderer/components/Sidebar.tsx:212` | Refresh failure has no local state | Keep the good empty copy; add refresh error and prevent repeat refresh. |
| Reading preview | “Nothing to preview yet” at `src/renderer/components/MDXPreview.tsx:583` | N/A | Detailed remediation at `src/renderer/components/MDXPreview.tsx:566` | Replace “nothing” with a next action; keep the excellent error remediation. |
| Workspace graph | Teaches that links create the graph at `src/renderer/components/GraphCanvas.tsx:391` | N/A | N/A (derived data) | Complete; keep this pattern. |
| Canvas | Blank work area with toolbar at `src/renderer/surfaces/CanvasSurface.tsx:802` | N/A | Safe Source-mode recovery at `src/renderer/surfaces/CanvasSurface.tsx:459` | Add one compact first-action hint; keep parse safety copy. |
| Database | Starter-schema CTA at `src/renderer/surfaces/DbSurface.tsx:426` | N/A | Explicit invalid-file alert at `src/renderer/surfaces/DbSurface.tsx:416` | Complete for current synchronous model. |
| HTML view | N/A | Full-surface spinner at `src/renderer/surfaces/HtmxViewSurface.tsx:122` | Error and crash/reload at `src/renderer/surfaces/HtmxViewSurface.tsx:151` | The spinner is acceptable because arbitrary view structure cannot be skeletonized; add only timeout/retry if startup can hang. |
| Document properties | Inline Add property at `src/renderer/components/properties/DocumentProperties.tsx:149` | N/A | YAML diagnosis + Edit as YAML at `src/renderer/components/properties/DocumentProperties.tsx:77` | Complete; replicate its recovery model elsewhere. |
| Plugins | Search-only empty at `src/renderer/views/PluginsPage.tsx:255` | Missing for sandbox discovery | Discovery errors are swallowed at `src/renderer/views/PluginsPage.tsx:195` | Separate loading, zero results, and failure. |
| Workspaces | Header actions plus explanatory empty copy at `src/renderer/views/RepositoriesPage.tsx:42` and `src/renderer/views/RepositoriesPage.tsx:55` | Missing per mutation | Missing per mutation | Add row-level pending/success/error states. |
| Layout surface | Empty and invalid collapse into one instructional message at `src/renderer/surfaces/LayoutSurface.tsx:43` | N/A | Same message; no parse detail | Name whether JSON is empty, invalid, or structurally unsupported and point to Source mode. |

## Density, rhythm, and consistency

Density itself is appropriate for a desktop knowledge tool. The activity rail,
sidebar rows, 40px title bar, 42px pane headers, and 24px status bar form a clear
compact hierarchy (`src/renderer/components/ActivityRail.tsx:55`,
`src/renderer/components/Sidebar.tsx:131`, `src/renderer/index.css:129`,
`src/renderer/index.css:258`, `src/renderer/index.css:163`). The drift is within
families: icon buttons range from 20px (`src/renderer/index.css:493`) through
24px (`src/renderer/components/FloatingGraph.tsx:90`) and 28px
(`src/renderer/components/TitleBar.tsx:45`) without a named density tier; field
heights vary as finding 9 records; Settings uses spacious 32px section breaks
(`src/renderer/views/SettingsPage.tsx:63`) while dense inline editors invent their
own padding. The fix is named compact/default density variants and real scale
adoption, not making every gap identical.

Button radii and the Lucide icon family are otherwise consistent
(`src/renderer/components/ui/button.tsx:6`,
`src/renderer/components/TitleBar.tsx:2`). Visible product nouns mostly use
“workspace,” correctly hiding the internal `repository` model
(`src/renderer/views/RepositoriesPage.tsx:44`). The panel/peek and save-model
drift in finding 10 is the meaningful terminology inconsistency; minor ordering
such as “Integrations & Plugins” versus “Plugins & integrations” is not worth an
independent task.

## Explicit ban check

| Ban | Result | Evidence |
| --- | --- | --- |
| Colored side-stripe accent | **Fail** | Active activity items use `border-l-2` + accent at `src/renderer/components/ActivityRail.tsx:31`. The neutral 2px Canvas blockquote marker at `src/renderer/index.css:513` is semantic quote punctuation, not an additional accent-stripe violation. |
| Gradient text | Pass | No `background-clip:text`/gradient-text implementation in the audited source. |
| Glassmorphism as default | Pass | Blur is limited to the modal overlay and two controls floating over the graph (`src/renderer/components/ui/dialog.tsx:18`, `src/renderer/components/FloatingGraph.tsx:90`), not a default surface material. |
| Hero-metric template | Pass | `Stat`/`.metric` are scoped data primitives (`src/renderer/components/mdx-layout.tsx:128`, `src/main/htmx/theme.ts:226`), not hero composition with supporting stats/gradient decoration. |
| Endless identical card grids | Pass | Plugin cards represent repeated configurable entities (`src/renderer/views/PluginsPage.tsx:109`); primary shell and data surfaces are not card grids. |
| Tiny uppercase tracked eyebrow on every section | Pass | Uppercase is scoped to table headers, property labels, and authored metric/card primitives (`src/renderer/views/RepositoriesPage.tsx:60`, `src/renderer/components/mdx-layout.tsx:121`), not used as page-section scaffolding. |
| Numbered section scaffolding | Pass | No numbered-eyebrow pattern found in the audited source. |
| Text overflow | **Live check unavailable** | Source uses truncation/min-width guards in shell chrome (`src/renderer/components/TitleBar.tsx:90`, `src/renderer/components/NoteTabs.tsx:31`), but exact rendered copy at every pane width was not verifiable. Finding 7 records two source-guaranteed structural risks. |
| Border + wide shadow ghost surface | **Fail** | The block toolbar uses a 1px border and 18px blur at `src/renderer/index.css:357`. |
| Cards/inputs with 32px+ radii | Pass | No audited product card/input uses such a radius. |
| Sketchy/hand-drawn SVG fallback | Pass | The custom logo is a clean geometric mark (`src/renderer/components/TitleBar.tsx:57`); no turbulence/doodle illustration pattern found. |
| Repeating-linear-gradient decoration | Pass | None found. Canvas uses a functional radial grid (`src/renderer/surfaces/CanvasSurface.tsx:559`), which is not the banned stripe decoration. |
| Meta-criticism copy | Pass | No user-facing copy built around ironic strawman/meta commentary found. |
| Decorative product motion | Pass | Motion communicates hover, open/close, selection, or loading; a global reduced-motion fallback exists at `src/renderer/index.css:374` and HTMX has one at `src/main/htmx/theme.ts:245`. |
| Inconsistent component vocabulary | **Fail** | Form density/save behavior and panel terminology drift; see findings 9–10. |
| Display fonts in controls/data | Pass | Renderer controls use Geist/system sans and monospace for code/data (`src/renderer/index.css:89`). |
| Custom scrollbars | **Fail** | Global WebKit scrollbar styling at `src/renderer/index.css:385`. |
| Heavy saturation on inactive states | Pass | Inactive states use neutral surface/muted tokens; accent is reserved for selected/action states (`src/renderer/index.css:233`, `src/renderer/components/ActivityRail.tsx:30`). |
| Modal as first thought | Not provable as a design-process claim | The Create flow uses one conventional Radix dialog (`src/renderer/components/CreateModal.tsx:64`) with focus/cancel/loading behavior. No violation is asserted without evidence that inline/progressive options were skipped. |

## What is good and should be preserved

1. **Error recovery respects local files.** Canvas refuses to rewrite unreadable
   JSON and points to Source mode (`src/renderer/surfaces/CanvasSurface.tsx:459`);
   frontmatter preserves invalid YAML while giving a direct escape
   (`src/renderer/components/properties/DocumentProperties.tsx:77`). This is
   exactly the reassurance a local-first tool needs.
2. **The core shell is familiar and restrained.** Activity rail, explorer, tabs,
   panels, status, command palette, and layout controls are conventional rather
   than invented (`src/renderer/App.tsx:657`). Density serves the task.
3. **Shared focus and reduced motion are real system primitives.** The global
   focus ring and reduced-motion fallback cover custom controls rather than
   relying on each feature author to remember them
   (`src/renderer/index.css:113`, `src/renderer/index.css:374`).
4. **Graph accessibility is stronger than its custom rendering suggests.** SVG
   nodes have names, tab stops, Enter/Space activation, and a theme-derived focus
   stroke (`src/renderer/components/GraphCanvas.tsx:357`,
   `src/renderer/index.css:300`).
5. **Several empty states teach succinctly.** Notes, tags, graph, and database
   initialization state the next action without a wall of onboarding text
   (`src/renderer/App.tsx:616`, `src/renderer/components/Sidebar.tsx:244`,
   `src/renderer/components/GraphCanvas.tsx:391`,
   `src/renderer/surfaces/DbSurface.tsx:426`).

## Not now

- Do not replace the token system, Radix/shadcn layer, shell layout, or Lucide
  icons. The findings are convergence work, not grounds for a redesign.
- Do not turn this desktop Electron product into a mobile layout. The intentional
  minimum 680×540 shell at `src/renderer/index.css:95` makes sub-44px desktop
  targets a lower-cost issue than keyboard invisibility. Narrow **pane** behavior
  still needs finding 7; a touch-first overhaul does not.
- Do not chase one- or two-pixel radius differences until contrast, keyboard,
  state, and responsive-pane defects are fixed.
- Do not replace the HTML-view spinner with a fake skeleton. The sandbox can host
  arbitrary content, so there is no honest layout to skeletonize
  (`src/renderer/surfaces/HtmxViewSurface.tsx:122`).
- Do not treat the logo’s explicit black/white light/dark treatment as token debt
  (`src/renderer/index.css:444`); it is bounded identity styling.
- Do not raise internal `repository` identifiers as visible terminology debt.
  User-facing copy consistently says “workspace”; only panel/peek wording has a
  real transfer-of-learning cost.

## Verification limits

- The Impeccable detector entrypoint was unavailable: neither the installed
  project helper nor the copied `impeccable-reference/` directory contains the
  required scripts. Manual source scans covered the same ban/token patterns, but
  there is no deterministic detector JSON to cite.
- No browser-control surface was available, and starting the full Electron dev
  process would generate files outside the report’s one-file authorization.
  Therefore pixel alignment, actual tab sequence, modal focus return, horizontal
  clipping, animation smoothness, color-mix computed pixels, zoom at 200%, and
  the four themes as rendered remain manual checks for the reviewer. No live
  visual claim is made in this report.
- Runtime performance, screen-reader announcements, webview focus transfer, and
  real OS scrollbar behavior cannot be proven from source. The report records
  source-guaranteed failures and explicitly does not invent runtime defects.

## Acceptance trace

1. Register verdict and all ten requested dimensions are covered above: ranked
   findings; token health; four-preset contrast; missing interactive states;
   keyboard/focus; empty/loading/error; density/rhythm; consistency; explicit ban
   checks; and positives.
2. Every ranked finding has file/line evidence, user impact, and a concrete fix.
3. Contrast ratios are computed for Graphite, Void, Nord, and Light, with normal,
   large, and placeholder thresholds stated; the two HTMX schemes are also
   measured.
4. Every shared and product ban is marked pass, fail, or explicitly unverifiable.
5. This report is the only authorized write: `docs/design/impeccable-sweep.md`.
   No production, test, dependency, lockfile, `node_modules`, reference, context,
   decision, task-board, or handoff file is required or authorized by these
   acceptance criteria.
