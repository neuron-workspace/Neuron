# Neuron production-readiness roadmap

Reconciled: 2026-11-24 · Code baseline: `972208d` (v0.5.0), plus the
adversarial/crash tests and bounded fixes in this change.
Original inventory: 2026-07-11, `6b88bab`.

This is a dated implementation inventory and rationale for remaining work,
not a live task board or release certification. **Done** means the described
implementation exists, not that every platform was exercised here.
**Partly done** names the shipped part and the remainder. **Not started** means
the proposed implementation is absent, even where its design exists.

Evidence comes from local code, `git log --oneline -60` and the description of
neuron-workspace/Neuron#94. This includes module-review batches
(`543327e` through `37733ac`), the security sweep (`9b1c0f7`), Sync Phase 0
(`3d32885`, `071392f`) and reliability fixes (`001fc0a`). Electron/E2E execution
was outside this reconciliation; coverage below is not a claim of fresh runs.

Companion docs: `docs/plans/json-canvas-enhancements.md`, `docs/htmx-views.md`,
`docs/architecture/metadata-index.md`, `docs/design/notion-like-ui-roadmap.md`.

---

## 1. Verified repository inventory

| Area | Location / evidence | State |
| --- | --- | --- |
| Main / preload | `src/main/main.ts`, `preload.ts`, `navigation.ts`; `543327e`, `9b1c0f7` | **Done** for current windows, IPC, watcher, PTY and proxy services, sender/argument checks and Electron 45.4.1. |
| HTMX platform | `src/main/htmx/*`; `78a4937`; `tools/htmx-adversarial.test.mjs` | **Done** for plain `.html` views: capabilities, paths, boot/session tokens, content-bound trust, CSP and limits. |
| Shell / surface registry | `App.tsx`, `Workbench.tsx`, `EditorGroup.tsx`, `surfaces/index.ts` | **Partly done**: groups and docks exist; html/db/canvas/mmd/mermaid/csv surfaces and general file-kind routing exist; no recursive split tree. |
| Canvas | `src/renderer/canvas/*`, `tools/canvas-model.test.mjs` | **Done** for current model, history and style extension; enhancements remain in the canvas plan. |
| DB / CSV | `surfaces/DbSurface.tsx`, `components/db/*`, `lib/db.ts`, `lib/csv.ts`; `bd47f97`, `506cd9e` | **Done** for current multi-table DB, CSV and row windowing; Node and Electron specs exist. |
| Markdown / MDX / Live | `MDXPreview.tsx`, `LiveEditing.tsx`, `InsertMenu.tsx`, `lib/sanitize-html.ts` | **Partly done**: sanitized rendering, explicit components and Live editing; constrained parser, not arbitrary MDX compilation. |
| Frontmatter / source editor | `lib/frontmatter/*`, `components/properties/*`, `Editor.tsx` | **Done** for current round-trip properties and CodeMirror source editing. |
| Commands / shortcuts | `lib/palette-commands.ts`, `lib/keybindings.ts`, `App.tsx` | **Partly done**: configurable chords and palette data; no unified scoped registry or versioned multi-binding schema. |
| Layout | `lib/layout.ts`, `lib/tabs.ts`, `LayoutSwitcher.tsx` | **Partly done**: docks, saved arrangements, up to four editor groups in one direction; no recursive tree. |
| Plugins | `plugins/host.tsx`, `plugins/builtin/*`, `docs/architecture/plugin-sandbox.md` | **Partly done**: built-ins are trusted renderer code; custom HTML uses the view sandbox. Folder-app plugins were removed. |
| Search / graph | `lib/search.ts`, `lib/use-text-search.ts`, `lib/knowledge-graph.ts`; `7330b41` | **Partly done**: search UI, lazy text reads and incremental in-memory link graph; no persistent metadata-index service. |
| Settings / secrets | `src/main/settings-file.ts`, `settings-schema.ts`, `secret-storage.ts`; `071392f` | **Done** for current validation/migration, damaged-file preservation, keychain storage and plugin-free Settings window. |
| Theme / design system | `lib/theme.ts`, `components/ui/*`, `index.css`, `tools/contrast.test.mjs` | **Partly done**: tokens, controls and contrast checks; whole-app adoption/accessibility incomplete. |
| Governance | `LICENSE`, `NOTICE`, `.github/CODE_OF_CONDUCT.md`, issue/PR templates | **Done** for these artifacts; license is Apache-2.0, not MIT. |
| CI / tests | `.github/workflows/ci.yml`, `security-scan.yml`, `codeql.yml`, `package.json`, `e2e/*` | **Done** for gate wiring. E2E resumed in `f62c3c3`; security gates precede Windows/Linux, then macOS (`972208d`). |

### Architectural debt remaining

- **Not started:** central command registry and focus-scoped dispatcher.
  Palette, menus and `App.tsx` keyboard handling retain separate wiring.
- **Partly done:** layout persistence. `SavedLayout` saves shell/panel structure,
  not complete editor sessions; `GroupsState` is a row or column, not a tree.
- **Not started:** persistent metadata index. Its design explicitly describes
  an absent service/API (`docs/architecture/metadata-index.md`).
- **Partly done:** containment/recovery. Handle checks and journal exist;
  `safe-fs.ts` documents the accepted path-based rename/unlink/trash window.
  Default typing fallback remains non-atomic under interruption.

---

## 2. Obsidian comparison (workflow reference)

The July research motivated navigation, linked knowledge, recovery, tab groups,
templates and keyboard workflows. It is historical research, not a current
Obsidian version audit. No code/branding is copied, and another product having
a feature is not by itself a requirement.

Neuron's implemented security distinction is the capability-scoped HTML view
sandbox: no Node/preload, approved workspace paths and `connect-src 'self'`.
This does **not** describe trusted renderer plugins or the PTY's real shell.
Evidence: `src/main/htmx/server.ts`, `plugins/host.tsx`, `src/main/main.ts`.

---

## 3. Feature-parity matrix

Priority: P0 (safety/blocking) → P3 (nice-to-have). “Done” is limited to the
named scope, not a claim that the entire subsystem has no remaining work.

| Feature | State | Evidence / remaining scope | Priority / Milestone |
| --- | --- | --- | --- |
| Workspace open / switch / windows | Done | `workspace-windows.ts`, `recentRepos.ts`; `c78ff51`; missing-workspace Remove in `001fc0a` | Existing |
| File / folder operations | Partly done | `workspace-rename.ts`, `FileActionDialog.tsx`; rename/move/link rewrites exist, folder deletion refused (`543327e`) | P1 / M4 |
| Preview tabs / bounded editor groups | Done | `lib/tabs.ts`, `EditorGroup.tsx`, `e2e/editor-groups.spec.ts` | Existing |
| Recursive split tree / complete saved sessions | Not started | Flat `GroupsState`; `SavedLayout` stores arrangements only | P1 / M2 |
| Source / split / reading / Live modes | Done | `EditorGroup.tsx`, `MDXPreview.tsx`, `LiveEditing.tsx` | Existing |
| Markdown / constrained MDX components | Partly done | Sanitizer, explicit page components, `tools/mdx-security.test.mjs`; not a general compiler | P1 / M6 |
| Internal links / rename safety | Done | `lib/wikilinks.ts`, `lib/link-rewrite.ts`, `workspace-rename.ts`; `7b0795d` | Existing |
| Backlinks / unlinked mentions | Not started | Graph references exist; no dedicated panel in `plugins/builtin/*` | P2 / M3 |
| Outgoing links / outline / hover preview | Not started | No corresponding panel in `components/*` or `plugins/builtin/*` | P2 / M3 |
| Tags / properties | Done | `Sidebar.tsx`, `lib/note-tags.ts`, `lib/frontmatter/*` | Existing |
| Global search with persistent index | Partly done | Search UI and lazy reads exist; metadata-index service remains a design | P1 / M5 |
| Quick file switcher | Partly done | Palette selects notes (`CommandPalette.tsx`); no separate quick-switcher command | P2 / M1/M3 |
| Slash insertion | Partly done | `InsertMenu.tsx` on empty Live lines; no general source-editor slash registry | P2 / M6 |
| Canvas / DB / CSV | Done | Models/surfaces, Node tests, `e2e/database*.spec.ts`, `csv-tables.spec.ts` | Existing scope |
| Capability-scoped HTML views | Done | `htmx/*`, `htmx-views.test.mjs`, `htmx-adversarial.test.mjs` | R2 / M6 |
| Central registry / scoped hotkeys | Partly done | Flat bindings/palette data exist; registry, scopes, conflict detection and multi-bindings absent | P1 / M1 |
| Bookmarks | Not started | No bookmark model/settings key in `lib/*` or `settings-schema.ts` | P2 / M3 |
| Workspace / local graph | Done | `SigmaGraph.tsx`, `FloatingGraph.tsx`, `lib/knowledge-graph.ts` (`local(id, depth)`), graph tests | Existing scope |
| Daily notes / templates | Partly done | `plugins/builtin/daily-calendar.tsx`, `templates.ts`, `WorkspaceTemplatesDialog.tsx`; no general note-template expansion engine | P2 / M7 |
| Recovery history | Done | `journal.ts`, `plugins/builtin/version-history.tsx`, `e2e/version-history.spec.ts` | Existing / M4 |
| Note composer (split / merge) | Not started | Canvas-to-note conversion is not a general composer/link-update transaction | P2 / M4 |
| Outside changes / crash recovery | Partly done | `001fc0a`, `save-file.ts`, `FileNotices.tsx`, crash tests; limitations below | P0 / M4 |
| General import / export | Not started | Opening files and Chrome-cookie import are not a note conversion pipeline | P2 / M7 |
| Public CLI | Not started | `workspace-argv.ts` opens workspaces, not a public command/service CLI | P3 / M6 |
| Custom extension sandbox | Partly done | HTML sandbox exists; built-ins remain trusted, no native third-party isolation | P1 / M6 |
| Accessibility | Partly done | Contrast, labels and focus styles; whole-app keyboard/screen-reader/zoom audit outstanding | P1 / M8 |
| Localization | Not started | Strings remain inline in `components/*` and `views/*` | P3 / M8 |
| Updates / packaging / releases | Partly done | `updater.ts`, release workflows, checksum/provenance/smoke tooling; source does not prove signing credentials | P0 / M9 |
| CI test gates | Done | `ci.yml`: typecheck, tests, build, E2E and smoke by branch/change scope | M0 |
| Encrypted BYOI sync | Partly done | Phase 0 prerequisites only; no sync process, encryption/key lifecycle or transport | Separate phases |

---

## 4. Milestones

### M0 — Baseline correctness & cleanup — done

- **Done:** main/renderer typecheck, Node tests and build gate CI (`package.json`,
  `ci.yml`). E2E is wired and resumed. Historical TS errors are not a remaining
  implementation task; each change still needs a fresh check.
- **Done:** README documents plain `.html`; conduct/issue/PR templates exist.
  The old proposed `.vw` → `.nhtml` documentation change is obsolete.

### M1 — Command & keyboard architecture — partly done

- **Done:** configurable single-chord bindings, palette data and split shortcut
  (`lib/keybindings.ts`, `lib/palette-commands.ts`).
- **Not started:** central `{ id, title, scope, when(), run(), defaultKeys[] }`
  registry, focus-aware dispatcher, versioned migration and multiple bindings.
  Exact/prefix, reserved-key and scope-conflict detection remain absent.
- **Not started:** palette/settings/menus consuming that registry and its
  registration/scope/migration tests. Existing keybinding/palette tests cover
  the current narrower implementations.
- **Partly done:** real layout actions already exist; integrate them rather
  than adding the originally proposed placeholder palette. Shortcuts: §7.

### M2 — Workspace layout engine — partly done

- **Done:** drag/reorder/split editor groups, preview tabs, movable dock groups,
  saved shell arrangements and shared document writers (`lib/tabs.ts`,
  `lib/layout.ts`, `App.tsx`, `6b4ecc5`).
- **Not started:** recursive mixed-orientation tree, stable layout-node IDs,
  geometric focus navigation, complete saved editor sessions, missing-file
  placeholders and versioned tree migrations. Current `removeMissingAll`
  removes missing tabs; settings validation is not a tree migration.
- **Not started:** registry-backed semantic layout commands. Editor pop-outs
  and linked/stacked views remain deferred; existing workspace windows are a
  different implemented scope (`workspace-windows.ts`).
- **Done:** current group/dock behavior has unit/E2E coverage (`tabs.test.mjs`,
  `layout.test.mjs`, `e2e/editor-groups.spec.ts`, `saved-layouts.spec.ts`).

### M3 — Navigation & linked-knowledge views — partly done

- **Done:** alias/path/heading/block-aware wiki-link resolution, Live completion,
  rename/move rewrites, workspace graph and a local graph around the active
  note with a depth setting (`7b0795d`, `7330b41`, `lib/wikilinks.ts`,
  `components/wiki-completion.tsx`, `KnowledgeGraph.local` in
  `lib/knowledge-graph.ts`, used by `SigmaGraph.tsx`).
- **Partly done:** palette file selection and in-memory reference index.
- **Not started:** dedicated backlinks/unlinked mentions, outgoing links,
  outline, hover preview and bookmarks. `KnowledgeGraph` and the current graph
  components are starting points.

### M4 — Recovery & data integrity — partly done

- **Done:** destructive-write pre-images, retention, integrity-checked restore
  and history UI (`journal.ts`, `plugins/builtin/version-history.tsx`). Store:
  userData, outside the workspace. `.neuron/journal` is ordinary workspace data;
  the actual recovery store has no view API route.
- **Done:** queued nonblocking saves, temp fsync, retries, handle checks and
  outside-change checks before replacement (`3d32885`, `001fc0a`, `save-file.ts`,
  `safe-fs.ts`). Watcher quiet periods and embedded-table conflict notices exist
  (`workspace-watcher.ts`, `FileNotices.tsx`).
- **Done:** disk/write errors, rename races, byte preservation and interruption
  tests (`save-file.test.mjs`, `journal.test.mjs`, `crash-recovery.test.mjs`).
  Pruning now unpublishes metadata before deleting bytes so interruption cannot
  leave a captured entry pointing at a deleted pre-image.
- **Partly done:** crash atomicity. Typing fallback truncates by design after
  blocked renames; its atomicity test is skipped. Sync disables the fallback.
  A crash can also leave an empty conflict-name reservation; a separate failing
  test is skipped pending atomic no-replace publication or reservation recovery.
  Original files remain intact on that conflict path. Orphan random temps can
  survive death; retries prove they do not block later saves, not that a global
  orphan sweeper exists. The accepted path-based race remains in `safe-fs.ts`.
- **Not started:** periodic snapshots beyond pre-images, restore preview/diff,
  and note composer with link updates/undo.

### M5 — Search & metadata scalability — partly done

- **Done:** structured search/filter/ranking helpers, UI, bounded lazy text
  reads, stale-result cancellation and change refresh (`lib/search.ts`,
  `lib/use-text-search.ts`, `7330b41`).
- **Done:** scale/graph benchmark tools and large-table row windowing
  (`tools/scale-benchmark.mjs`, `graph-benchmark.mjs`, `lib/row-window.ts`).
- **Not started:** persistent SQLite metadata index/API described in
  `docs/architecture/metadata-index.md`. Existing benchmark tools do not prove
  every 100k-file workload meets a production latency target.

### M6 — Extensibility & security — partly done

- **Done:** capability-based HTML, content-bound approval and adversarial Node
  server tests (`htmx/*`, `htmx-adversarial.test.mjs`): outside/journal paths,
  prototype keys, sessions, trust races, capability gates and resource limits.
  Fixes those tests exposed: a write whose session is revoked while its body is
  still arriving is refused (401); request bodies with `__proto__`,
  `constructor` or `prototype` keys, or nested deeper than 64 levels, are
  refused (400) instead of being persisted or failing with a 500.
- **Done:** constrained MDX/sanitization and malicious-content tests
  (`tools/mdx-security.test.mjs`, `sanitize-html.test.mjs`).
- **Done:** security sweep, Electron 45 and scanners (`9b1c0f7`,
  `security-scan.yml`, `codeql.yml`). Controls are not proof of no vulnerabilities.
- **Partly done:** extension isolation. HTML replaces removed folder apps;
  first-party plugins and terminal remain trusted. Slash insertion exists in
  Live, not as a general source-editor command registry.
- **Not started:** public command CLI and unified restricted/safe mode across
  all execution surfaces.

### M7 — Examples & onboarding — partly done

- **Done:** coherent planner/page/HTML reference workspace and relative demo
  dates (`examples/demo-repo`, `tools/demo-data.test.mjs`, `templates.ts`).
  Workspace onboarding and template selection exist (`RepositoryOnboarding.tsx`,
  `WorkspaceTemplatesDialog.tsx`).
- **Partly done:** beginner guidance; feature/development/distribution docs
  exist, but a guided first-run tour and connector setup remain absent.
- **Not started:** example/fixture split and learning sequence (§8), general
  note import/export.

### M8 — Accessibility, localization, UX polish — partly done

- **Done:** preset contrast assertions, shared focus/control tokens
  (`tools/contrast.test.mjs`, `index.css`).
- **Partly done:** keyboard labels/actions and reduced-motion styles; complete
  keyboard-only, screen-reader, 200% zoom and color-independent-state audits
  are not demonstrated by these checks. Component adoption: §12.
- **Not started:** localization infrastructure/catalogs; strings remain inline.

### M9 — Packaging, CI, releases, governance — partly done

- **Done:** builds, updates, checksums/attestations, smoke tooling and publish
  gates (`release.yml`, `ci.yml`, `tools/smoke-packaged.mjs`,
  `publish-gate.test.mjs`, `docs/distribution.md`).
- **Done:** scanners and least-privilege declarations; security-scan actions
  are SHA-pinned. **Partly done:** repository-wide immutable action pinning;
  `ci.yml` still uses version tags for several actions.
- **Partly done:** signing/notarization wiring and release guidance. Source
  does not prove signing credentials, signed releases, Store submission or
  Flathub delivery. Clean-install/platform/signing/rollback evidence remains a
  requirement for each release.

### Sync prerequisites and remaining phases — partly done

- **Done (Phase 0):** guarded durable saves, required unattended capture,
  separate retention budget, conflict copies/trash deletes, settings validation
  and migration, portable paths and plugin-free Settings (`3d32885`, `071392f`,
  `journal.ts`, `portable-path.ts`, `settings-schema.ts`).
- **Not started (transport):** utility-process sync, encrypted manifests/chunks,
  key lifecycle, selective sync and local-folder/cloud/P2P/server backends.
  There is no sync runtime under `src/main`; prerequisites are not shipped sync.
  Independent security review remains a gate before enabling it.

---

## 5. Risk register

| ID | Risk | Controls | Evidence | Remaining exposure |
| --- | --- | --- | --- | --- |
| R1 | Stored XSS / rendered content | Partly done | `sanitize-html.ts`, `mdx-security.test.mjs`, `csp.test.mjs` | New render paths need tests. The reliability batch's “R1” save race is a separate use of this label. |
| R2 | View token/capability escalation | Done for current controls/tests | `htmx-adversarial.test.mjs`, `htmx-views.test.mjs`, `e2e/view-trust.spec.ts` | Node server tests cannot certify Electron sandbox behavior. |
| R3 | Trusted plugin / PTY execution | Partly done | `plugins/host.tsx`, `main.ts`, `docs/architecture/plugin-sandbox.md` | Built-ins remain privileged; PTY runs a real shell. |
| R4 | Save/watch/crash data loss | Partly done | `001fc0a`, `save-file.ts`, `journal.ts`, `crash-recovery.test.mjs` | Typing fallback, empty conflict reservations, orphan temps and accepted path race; see M4. |
| R5 | Unsigned artifact/update trust | Partly done | `updater.ts`, `release.yml` | Checksums/provenance and signing wiring exist; signing credentials/results require separate evidence. |
| R6 | Settings/layout corruption | Partly done | `settings-file.ts`, `settings-schema.ts`, `lib/layout.ts` and tests | Settings preservation/migration exist; future tree layout needs its own migration. |
| R7 | CI without regression gates | Done for wiring | `ci.yml`, `972208d`, `f62c3c3` | Docs-only skips/affected E2E are intentional; runtime results must pass. |
| R8 | Prototype keys / pathological JSON/YAML | Partly done | Frontmatter validation, `settings-schema.test.mjs`, bounded view-body validation and adversarial tests | Targeted cases are not comprehensive parser fuzzing. |

---

## 6. Testing master plan

- **Done — Node/type gates:** `npm test` runs the package.json scripts, including
  live server and injected-fs tests; no longer four suites. `test:templates`
  builds main as a prerequisite. `npm run typecheck` checks main and renderer.
- **Done — Electron harness/CI wiring:** `npm run test:e2e`, `e2e/*`. Full scope
  for test/main; affected specs for dev; packaged smoke in full scope. E2E is
  resumed. These tests were not executed during this reconciliation.
- **Partly done — component/integration:** Node/DOM and Electron specs exist;
  no comprehensive separate component runner. Future registry/tree reducers
  and migrations still need tests.
- **Partly done — security:** malicious rendering/URLs/paths/sessions/prototype
  keys/races and scanners exist; not comprehensive fuzzing, archive-bomb tests
  or independent penetration review.
- **Partly done — crash recovery:** latched failures cover temp creation,
  partial writes, fsync, rename, cleanup, journal publication/pruning, restore,
  outside changes and unattended writes. Two explicit skips: typing fallback
  and empty conflict reservation. These simulate process interruptions, not
  power-loss/filesystem durability certification.
- **Partly done — a11y/performance/platform/release:** contrast, benchmark,
  cross-platform CI and smoke tools exist; complete manual visual/accessibility
  audits and measured release-specific budgets remain outstanding.

Do not invent `test:security`, `test:all` or other commands not in package.json.
Wire new tests into `npm test`, state skips, and prove critical assertions fail
when the guarded behavior is removed.

---

## 7. `Ctrl/Cmd+L` decision (for M1)

**Done — decision:** `mod+l` is intended to focus search; `mod+\` is the
split-editor/layout binding (maintainer decision D26). This supersedes July's
layout-palette proposal. `mod+l` stays in the global scope only, since editors
and webviews use `Ctrl+L` themselves.

**Partly done — implementation:** `lib/keybindings.ts` binds
`split-editor-right` to `mod+\` but does not declare focus-search yet. Implement
that scoped command with M1 and verify editor/webview/native shortcut behavior.

---

## 8. Example-folder restructuring plan (M7)

**Partly done:** `examples/demo-repo/` is the shipped, tested reference
workspace. The physical split below is **not started**; it remains a proposal.

```
examples/getting-started/   welcome, navigation, links, tags, properties, tasks
examples/canvas/            interop and style/foreign-field preservation
examples/databases/         typed DB views
examples/htmx-views/        read-only examples before writable ones
examples/properties/        happy-path properties
test-fixtures/             malformed data and denied permissions
docs/tutorials/            learning-sequence index
```

**Not started:** per-example README/exercise sequence for that split. Keep
least-privilege manifests and tests during any reorganization. Generate large
fixtures with `tools/scale-fixture.mjs`; do not commit benchmark vaults.

---

## 9. Non-goals (explicit)

No generic filesystem proxy, raw renderer `ipcRenderer`, unsafe template eval,
unrestricted third-party Node plugins, destructive config cleanup without
migration/backup, or product cloning. No speculative stylistic rewrites of
stable subsystems. The trusted PTY/Run path deliberately executes shell
commands; a non-goal must not falsely imply that functionality is absent.

---

## 10. Definition of “production ready” (release gate)

**Partly done:** gate implementations exist; acceptance still requires blocking
suites green, no unexplained type errors, schema migrations, current docs and
changelog, signed/verifiable artifacts, clean-install smoke and rollback
evidence. See `docs/distribution.md` and CI. A passing build or this inventory
does not certify a release.

---

## 11. Reconciliation scope

**Done:** remove contradicted July claims about missing CI, recovery, search,
groups, graph, tests, license, obsolete view extensions and MDX dependencies.
Record module review, Electron 45/security sweep, Phase 0 and reliability work
without claiming sync transport or complete layout/security architecture.
The original sanitizer slice remains in `lib/sanitize-html.ts` and its tests.

**Not started:** remaining registry/scoped-dispatcher implementation. The old
“exact next task: make CI run tests” direction is obsolete; this document does
not allocate or reorder the live backlog.

---

## 12. Notion-like UI & design-system backlog

Rationale: `docs/design/notion-like-ui-roadmap.md`. No new editor/UI dependency
is implied; storage remains Markdown-first.

| Original item | State | Evidence / remainder |
| --- | --- | --- |
| Shared spacing/type scales | Partly done | `index.css` has scales/control heights; full adoption/visual verification remains. |
| Shared Toolbar across editor/canvas/db | Not started | Headers remain local; `components/db/table-kit.tsx` shares table styling, not a global Toolbar. |
| PropertyRow / EmptyState / PermissionPrompt | Partly done | Local `PropertyRow` in `DocumentProperties.tsx`; no shared three-component vocabulary. |
| Remove unused shadcn sidebar | Done | `ui/sidebar.tsx` and `hooks/use-mobile.tsx` absent; `components/Sidebar.tsx` is active. |
| Settings Field/Input/Card consistency | Partly done | Primitives exist; `SettingsPage.tsx` still mixes field patterns. |
| Shared IconButton / shell audit | Partly done | Local `IconButton` in `TitleBar.tsx`, not app-wide primitive/audit. |
| Slash menu | Partly done | `InsertMenu.tsx` works in Live; general CodeMirror snippet insertion remains. |
| Move/duplicate/delete Markdown blocks | Partly done | Live/page block editing in `LiveEditing.tsx`, `mdx-layout.tsx`; no uniform plain-line toolbar. |
| General “Turn into” menu | Not started | Specific callout-kind editing exists (`lib/callout-kind.ts`), not a generic transform menu. |
| Shortcut hints / friendly tab labels / icons | Done for behavior | `CommandPalette.tsx` uses native `kbd`; `NoteTabs.tsx`, `OtherFileIcon.tsx` supply labels/icons. Shared `Kbd` adoption is optional. |
| Toolbar headers / read-only DataTable embeds | Partly done | `ui/data-table.tsx` exists; `DbView.tsx` and headers retain specialized behavior. |
| Empty/loading/error vocabulary | Partly done | `FileNotices.tsx` shares file notices; other surface states remain local. |
| Alternate WYSIWYG editor | Not started / gated | No need established; only evaluate behind a Markdown serializer if required. No JSON-block storage migration implied. |
