# Context pack — frontmatter and properties

## Purpose

YAML frontmatter is how a note carries structured data — title, tags, status,
dates, aliases — while staying a plain Markdown file. The properties panel edits
it without the user touching YAML.

The hard requirement is **round-trip preservation**: editing one property must
not reformat, reorder, or drop the rest. A notes app that rewrites your
frontmatter is a notes app you stop trusting.

## Key files

- `src/renderer/lib/frontmatter/` — parse and serialise with preservation.
- `src/renderer/components/properties/DocumentProperties.tsx` — the editor UI.
- `tools/frontmatter.test.mjs` — 42 assertions, the strictest unit suite here.

## Current status

Complete for current needs. Typed property rows (text, tags, select, date,
checkbox, number, aliases), round-trip preservation, and a visible degraded
state for malformed YAML rather than a silent failure or a destructive rewrite.

`examples/demo-repo/properties/invalid-yaml.md` exists deliberately as a
fixture for that path.

## Decisions

Storage stays Markdown-first (see `.claude/DECISIONS.md`): frontmatter is YAML
in the file, never a sidecar and never a database row. Anything that would make
the note unreadable without Neuron is out.

## Security constraints

- Parsed YAML is untrusted input. No prototype-polluting keys reach an object
  used as a map.
- Property values render as text, never as HTML.
- Malformed YAML **degrades** — warn and leave the file alone. Never
  "repair" by rewriting, which destroys what the user typed.
- `js-yaml` currently carries a high-severity quadratic-CPU advisory reaching
  production deps (T-013). Neuron parses the user's own files, so exposure is
  low, but note that frontmatter is the parse path.

## Test commands

```bash
npm run test:frontmatter
```

## Known bugs

- No E2E coverage of the properties panel — editing a property, adding a tag,
  clearing a value (T-012).
- The invalid-YAML degraded path is unit-tested but never exercised through the
  UI in an automated run.

## Next tasks

T-012 (properties E2E) · T-013 (`js-yaml` advisory) · restructuring
`examples/` so fixtures like `invalid-yaml.md` live under `test-fixtures/`
rather than in the onboarding workspace (roadmap M7).
