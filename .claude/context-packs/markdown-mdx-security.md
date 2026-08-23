# Context pack — Markdown / MDX rendering and its sanitiser

## Purpose

Renders notes for reading and live editing. This is the highest-value security
surface in the app: note content is untrusted (it syncs, it is pasted, it is
imported) and it renders **inside the privileged renderer**, which holds the
preload bridge.

## Key files

- `src/renderer/components/MDXPreview.tsx` — reading view. A hand-rolled line
  parser, **not** a real MDX compiler.
- `src/renderer/components/LiveEditor.tsx` — CodeMirror live view with
  decorations and widgets.
- `src/renderer/components/mdx-components.tsx` — `Badge`, `Callout`.
- `src/renderer/components/DbView.tsx` — the `<DbView />` database embed.
- `src/renderer/lib/sanitize-html.ts` — the allowlist sanitiser.
- `tools/sanitize-html.test.mjs`.

## Current status

Working: headings, lists, tables with alignment, task checkboxes, code blocks,
wiki-links, tags, three components (`Badge`, `Callout`, `DbView`), three view
modes. Markdown opens in **Reading** by default; double-clicking the prose
enters the live editor.

**It is a line parser, not MDX.** `@mdx-js` is a dependency but the preview path
does not use it. Consequences are real: ESM statements had to be skipped by hand
(T-024), and anything relying on real MDX evaluation does not work.

## Decisions

Markdown stays the on-disk source of truth. A block-editor JSON model was
evaluated and rejected — it breaks both Markdown-first storage and MDX
(`docs/design/notion-like-ui-roadmap.md`). Recorded because the conclusion is
negative and would otherwise be re-litigated.

## Security constraints

- **Raw HTML in a note goes through `sanitizeHtmlToReact`, never
  `dangerouslySetInnerHTML`.** This was a live stored-XSS reaching the
  privileged renderer (risk R1). If you add a render path, it uses the sanitiser
  — and add a test that fails without it.
- The sanitiser is an **allowlist**. Drops `script`/`style`/`iframe`, event
  handlers, and `javascript:` / `data:` URLs; `href` and `src` go through
  `safeUrl`.
- Canvas Markdown shares this constraint (`canvas/markdown.tsx`).
- An unregistered component raises a structured error; it must never fall back
  to rendering raw input.

## Test commands

```bash
npm run test:sanitize
npm run test:views       # URL safety, document budget
npm run test:e2e         # app.spec.ts covers the ESM-not-as-prose case
```

## Known bugs

- **Live view still shows MDX `import`/`export` lines as body text.** Reading
  view now skips them (T-024); Live does not. Open as **T-027** — the
  recommendation is to dim them as metadata rather than hide them, since hiding
  makes them uneditable.
- The line parser has no formal grammar and no fuzzing.
- No component-level tests; there is no DOM runner.

## Next tasks

T-027 (live ESM styling) · T-012 (rendering coverage) · a decision on whether to
adopt real MDX compilation, which is currently unowned.
