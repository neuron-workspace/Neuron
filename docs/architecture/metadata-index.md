# Metadata index

## Status and decision

This record specifies a derived metadata index for one active workspace. It is
an implementation design, not a description of an API that exists today. There
is currently no metadata-index service, preload method, IPC handler, or view
route.

The index uses **SQLite through the existing `sql.js` runtime dependency**. It
lives at
`<userData>/metadata-index/<sha256(canonical-workspace-root)>/index.sqlite`,
never inside the workspace. Markdown, MDX, and `.db` files remain the only
sources of truth. The index does not own a user-editable value, identifier, or
timestamp and must be safe to delete while Neuron is stopped or running.

The index is useful because it turns cross-file questions into bounded indexed
queries and moves parsing off render paths. It must not become a second storage
model, a generic SQL endpoint, or a permission bypass.

## Verified starting point

The following was verified in this checkout:

- `src/renderer/lib/frontmatter/parse.ts` accepts only a leading delimited YAML
  block, uses the `core` schema, rejects pathological structures, removes
  prototype-polluting keys, and returns an invalid result rather than repairing
  malformed YAML. Its serializer preserves the body byte-for-byte and preserves
  untouched YAML nodes. Indexing is read-only and must reuse those parse
  semantics; it must never serialize a note.
- The frontmatter implementation is framework-free but currently lies under
  the renderer tree. `tsconfig.main.json` has `src/main` as its `rootDir`, so an
  implementation cannot simply import that source from main. The pure parser
  must be moved to a shared location and consumed by both processes; copying it
  would create two definitions of valid frontmatter.
- `src/renderer/lib/db.ts` is the read-only parser for `.db` v1 and v2, preserves
  unknown fields on writes, and caps database files at 2 MiB. It has the same
  renderer-only location problem and must likewise become shared rather than be
  reimplemented in the index.
- `src/main/main.ts` keeps `activeRepoPath` in the `userData` settings store.
  Its chokidar watcher uses `ignoreInitial: true` and currently only sends
  `notes:changed` to the renderer. A workspace switch closes and recreates the
  watcher. `notes:write` uses a temporary file and rename; `notes:delete` uses
  `unlink`.
- Current `/api/v1/search`, `/api/v1/notes`, and `/api/v1/tags` handlers walk
  and read permitted Markdown files for every request. `/api/v1/db` reads one
  path-policy-approved database and is deliberately not a query engine.
- The journal precedent is main-process state under
  `<userData>/journal/<sha256(workspaceRoot)>`, with integrity checks and
  atomic replacement. D20 keeps it out of the view API because an aggregate
  store can reveal files outside a view's path policy. The metadata index has
  the same security property.
- `sql.js` is declared as a runtime dependency, its WASM is unpacked by the
  packaged build, and main already uses it for Chrome cookie import. This
  worktree has no installed `sql.js` module, so its compile options, FTS5
  availability, WASM startup time, and worker-thread packaging could not be
  executed here. This design does not depend on FTS, JSON1, or any optional
  SQLite extension.

## What is indexed

Only `.md`, `.mdx`, and `.db` files participate. Canvas and HTML contents do
not earn a place: none of the required queries use them, and indexing them
would introduce new parsers and security semantics without an outcome.

Every participating file has a `files` row containing normalized
workspace-relative POSIX path, kind, byte size, filesystem `mtime`, SHA-256 of
the bytes last parsed, parse state, safe diagnostic code, and index generation.
Absolute paths and raw parser exception text are not stored in query rows.

For Markdown and MDX, the index stores:

- The derived title: valid frontmatter `title`, otherwise the first level-one
  ATX heading, otherwise the filename stem. It also stores the body after
  frontmatter. The body copy is required for exact unlinked-mention
  verification; it is a cost, not a second source of truth.
- Every valid **top-level** frontmatter scalar and every scalar list element,
  with original key, normalized key, list position, value kind, and typed
  value. Nested maps and lists containing structured values remain visible in
  the source but are not queryable. This earns its place because status boards
  and future property filters must not require a schema migration for every new
  user key. The parser's existing size, depth, key, and array limits remain the
  limits. Invalid frontmatter produces `frontmatter_valid = 0` and no
  frontmatter-derived rows; retaining the previous values would make the index
  lie about the current file.
- First-class normalized columns for `title`, `type`, `status`, `due`,
  `project`, `priority`, `completed`/`done`, `created`, and `updated`, plus
  `tags`/`tag` and `aliases`/`alias`. These earn columns because they appear in
  the required queries or define task/project identity. A due date is queryable
  only when it is exactly `YYYY-MM-DD`; an unrecognized value remains in the
  generic frontmatter table but is not silently coerced.
- Tags from valid `tags`/`tag` frontmatter and inline `#tag` occurrences outside
  frontmatter and fenced code. Each row records its origin. The display spelling
  is preserved and a JavaScript-normalized comparison key is stored; query
  correctness must not depend on SQLite's ASCII-only `NOCASE` behavior.
- Wiki-links outside fenced code, with source location, raw target, normalized
  target, and resolved path when one exists. Resolution follows the convention
  already documented in the demo workspace: an exact workspace-relative path
  without `.md`/`.mdx`. Unresolved and ambiguous links remain rows. Alias,
  `#heading`, and display-text navigation semantics are not established by the
  current product and are not invented here; their raw text is retained for a
  later navigation decision.
- ATX headings outside fenced code: ordinal, level, text, line, and a derived
  anchor. They earn their small marginal cost because backlink results need
  useful context and future heading-target resolution must not rescan the note.
  The anchor is not a navigation promise until the renderer's slug behavior is
  specified and tested.
- GitHub-style list checkboxes (`- [ ]`, `* [x]`, or `+ [X]`) outside fenced
  code: checked state, text, line, character offset, and occurrence. Headings,
  links, tags, checkboxes, and body terms must come from one bounded body scan,
  not four regex passes over the file.
- Distinct normalized body terms, used only to narrow unlinked-mention
  candidates before the stored body is checked for an exact, boundary-aware
  phrase outside code and explicit wiki-link spans. This avoids relying on
  unverified FTS support and avoids a body scan of every note for every target.

For `.db`, the shared v1/v2 parser supplies validated tables and rows. The index
does not mirror arbitrary database cells. It projects only task and project
rows described below. A malformed or oversized database keeps a `files` row
with a diagnostic and contributes no stale entities.

## Relational shape

The exact migration DDL belongs with implementation tests, but the storage
contract is fixed by these relations:

```text
meta(key primary key, value)
files(path primary key, kind, size_bytes, mtime_ms, sha256,
      parse_state, diagnostic_code, generation)
notes(path primary key -> files, title, body_text, frontmatter_valid,
      type_norm, status, status_norm, due_day, project_ref,
      priority, completed, has_task_metadata, source_mtime_ms)
frontmatter_values(path -> notes, key, key_norm, ordinal,
                   value_kind, text_value, number_value, boolean_value)
tags(path -> notes, tag, tag_norm, origin, ordinal)
headings(path -> notes, ordinal, level, text, anchor, line)
wiki_links(source_path -> notes, ordinal, raw_target, target_key,
           resolved_path, line, start_offset, end_offset)
note_names(path -> notes, name, name_norm, origin)
body_terms(path -> notes, term)
tasks(task_id primary key, source_kind, source_path -> files, source_local_id,
      title, status, status_norm, due_day, project_ref, project_key,
      priority, completed, last_touched_ms, line)
projects(project_id primary key, source_kind, source_path -> files,
         source_local_id, name, project_key, status, status_norm,
         last_touched_ms)
task_project_links(task_id -> tasks, project_id -> projects)
```

Foreign keys are enabled and source-derived child rows cascade from `files`.
Indexes cover normalized frontmatter key/value, tag, wiki-link resolved target,
body term, task completion/due/project/status/touched time, and project key and
status. All writes for one source file occur in one SQLite transaction, so a
query sees either the old complete projection or the new complete projection,
never half of each.

`meta` contains at least the schema version, parser version, canonical root,
build state, completed generation, and last persisted generation. `PRAGMA
user_version` duplicates the schema version as an early compatibility check.

## One task concept, three source kinds

The index **does unify** task notes, checkboxes, and task rows into `tasks`.
They share query fields but retain provenance; identical text never causes
deduplication.

1. A note is a task when valid frontmatter has a string `type` equal to `task`
   after trim and case normalization. Its local id is `note`, and its task id is
   `note:<source-path>`. Title and task fields come from its canonical
   frontmatter columns.
2. Every checkbox is a task. It inherits `status`, `due`, `project`, and
   `priority` from valid containing-note frontmatter when present; the checkbox
   syntax alone decides completion. Its local id is the first 16 hex characters
   of SHA-256 over normalized checkbox text plus the occurrence number among
   identical normalized checkboxes. Its id is
   `checkbox:<source-path>#<local-id>`. Moving a checkbox without changing its
   text preserves it; editing its text changes it. This is deliberate: without
   writing a hidden id into Markdown, a checkbox has no durable identity.
3. In v2 `.db` files, a table whose id normalizes exactly to `tasks` contributes
   rows. A v1 file contributes tasks only when its filename stem normalizes to
   `tasks`. The recognized property ids are `title`, `status`, `due`, `project`,
   `priority`, and `done`/`completed`; the stored option id is the value. A row's
   local id is `<table-id>/<row.id>` and its task id is
   `db:<source-path>#<local-id>`. Neuron does not infer that an arbitrary table
   is tasks merely because some columns look familiar.

Completion for note and database tasks is true when a boolean
`completed`/`done` is true, otherwise when normalized status is `done` or
`completed`. Active-task queries use `completed = 0`, not a hard-coded list of
all possible user statuses. `last_touched_ms` is the source file's filesystem
mtime. For a `.db` task this is necessarily file-level: the current `.db` format
has no row modification timestamp, so editing any row makes every row in that
file look recently touched. Row-level staleness is not claimed.

Projects are unified similarly from notes with `type: project` and a v2 table
whose id normalizes to `projects` (or a v1 file named `Projects.db`). A project
keeps its source identity, while `project_key` is a normalized name used for
matching a task's textual `project` value. If exactly one project has that key,
a link is materialized. No match and multiple matches remain respectively
unresolved and ambiguous rather than guessing. “Task with no project” means an
empty project reference; unresolved and ambiguous references are separate
diagnostics. “Project with no active task” uses only unambiguous materialized
links.

All identities above are derived locators. Renaming a source path changes its
entity ids. Durable identity across renames or checkbox-text edits would
require persistent ids in the source formats and is outside this cache design.

## Storage decision

`sql.js` wins because the required work is relational: joins between tasks and
projects, range predicates over dates and mtimes, reverse lookup of links,
grouping by status, and several secondary indexes. SQLite supplies transactions,
constraints, query planning, schema versioning, and integrity checks. It is
already a packaged dependency, so this decision adds no runtime package and
does not reopen D8.

This is specifically `sql.js`, not native file-backed SQLite. The WASM database
is loaded into memory, and persistence exports a complete binary snapshot.
After committed changes, export is debounced; the bytes are written to a new
file in the same store directory, flushed, and atomically replace the previous
snapshot. Failure to export leaves the previous coherent snapshot and never
blocks a workspace write. Startup reconciliation recovers the missing index
updates.

The costs are material:

- The file is opaque and can corrupt. Detection and discard/rebuild are part of
  the design, not an operational afterthought.
- `sql.js` loads the database whole and duplicates indexed content in WASM
  memory. Export briefly needs another full-size byte array. The full note body
  copy is the dominant disk and memory cost.
- WASM initialization and complete-snapshot export cost CPU. Exports must be
  coalesced and run away from the Electron UI event loop.

A JSON document was rejected. Its benefits are genuine: trivial inspection,
simple atomic replacement, no binary decoder, and no query runtime. It is still
loaded whole, rewrites the whole document on persistence, and would require
hand-built secondary indexes, joins, range filtering, uniqueness checks,
schema migration code, and transaction-like staging. At 10,000 notes, every
new dashboard would either scan JavaScript objects again or add another custom
index that must remain consistent. JSON saves one recoverable binary-cache risk
by creating an ongoing query-engine maintenance burden.

## Build, update, and workspace switching

Indexing is owned by a main-process metadata service. CPU-heavy parsing and the
`sql.js` database run in a dedicated Node worker so a 10,000-note build cannot
freeze the Electron main event loop. `worker_threads` is Node standard library,
not a dependency. The existing packaged `sql.js` loader works in main, but the
worker/WASM packaged path is explicitly an implementation test because it was
not runnable in this worktree.

Opening a workspace is hybrid rather than “full scan every time” or “watcher
only”:

1. Canonicalize the real workspace root, derive its store key, close the prior
   workspace worker, and start chokidar with the existing ignore policy. Wait
   for chokidar's `ready` boundary and queue subsequent supported-file events.
   A watcher event is a hint, never proof of current contents.
2. Try the persisted index. If it passes all validation, expose its last
   complete generation immediately with state `reconciling`. Enumerate
   `.md`, `.mdx`, and `.db` paths and stats in the worker. New paths, missing
   paths, or paths whose size/mtime differ are staged for add, delete, or
   reparse. Unchanged size/mtime paths are trusted on warm open; a same-size edit
   that deliberately preserves mtime is a known blind spot and is repaired by
   manual/full rebuild.
3. If no valid index exists, create a separate in-memory database with state
   `building`, enumerate all supported files, and parse in bounded batches. Do
   not expose partial query results as complete. Progress is `(files indexed,
   files discovered, skipped/invalid count)`.
4. Reads use `fs.promises`; parsing work stays in the worker. A file is accepted
   only when its before/after stat is stable. If it changes while being read,
   retry it from the event queue. Apply a warm reconciliation as one generation
   transaction; publish a cold database only after its full scan is complete.
5. Replay queued watcher events against the completed scan, coalescing repeated
   events per path but preserving the last observed operation. Only then mark
   the generation `ready` and schedule an atomic export.

After readiness, add/change events read and replace one file projection in one
transaction. Unlink removes its `files` row and cascades. Chokidar does not
promise a rename event, so a rename is intentionally delete-old plus add-new;
identity is not preserved. External edits take exactly the same path. Internal
`notes:write`/delete operations may enqueue the known path after success for
lower latency, but they must not await the derived index or fail because it is
unavailable; the watcher remains the recovery path and duplicate events are
coalesced.

When a parser rejects a current file, the transaction removes its old derived
rows and records a safe invalid/too-large state. Keeping old metadata after a
bad external edit would present stale tasks as current. When the file becomes
valid, the next change replaces that diagnostic normally.

The performance budgets are release gates, not measured claims:

- Opening the app and trusted renderer must not wait for the index. No indexing
  slice may block the Electron main event loop for more than 50 ms.
- On reference release hardware with a local SSD, a warm 10,000-note workspace
  with no changes should reconcile in 2 seconds at p95; a cold 10,000-note,
  100-MiB workspace should become query-ready in 10 seconds at p95.
- If either budget is missed, the implementation is not allowed to hide it with
  an infinite spinner or partial results. It reports progress and remains
  usable for direct file editing; profiling decides whether worker batching,
  schema size, or the budget must be revisited.

These budgets and memory numbers remain unverified until the implementation
benchmark task runs on Windows, macOS, and Linux.

## Staleness, corruption, and recovery

The final snapshot is accepted only when all of these hold:

- SQLite opens, its standard quick integrity check returns `ok`, foreign-key
  checking is clean, and all required tables/indexes exist.
- `PRAGMA user_version`, the `meta` schema version, and parser version are the
  exact supported values.
- Stored canonical root equals the active canonical root, build state is
  `complete`, and the persisted generation is internally consistent.

A failed check, unknown schema version, parser-version change, truncated file,
or leftover temporary export causes the cache to be closed and deleted and a
new cold build to start. There is no index migration: reparsing source is both
safer and simpler because the database is derived. Temporary files are never
opened as a final index. A crash during a build leaves the previous snapshot or
no snapshot; a crash between an in-memory commit and export loses only cached
work and is repaired by reconciliation.

The service exposes an explicit full-rebuild action to the trusted renderer.
It closes and deletes only the resolved store for the active workspace, then
rebuilds from source. Rebuild never writes the workspace, never invokes the
journal, and never changes a note or `.db` byte. Therefore corruption recovery,
schema replacement, and manual repair are always data-safe.

## Query surface and the path-policy boundary

The trusted renderer gets a narrow proposed preload namespace, backed by IPC:

```ts
metadataIndex.status(): Promise<IndexStatus>
metadataIndex.query(request: MetadataQueryV1): Promise<MetadataResultV1>
metadataIndex.rebuild(): Promise<{ accepted: true }>
metadataIndex.onChanged(callback: (generation: number) => void): () => void
```

`MetadataQueryV1` is a closed discriminated union of the query kinds below,
with validated dates, integer limits, and workspace-relative paths. It is not
SQL, does not accept column names, expressions, or arbitrary order clauses, and
always returns an envelope containing index state and generation. A renderer
can show `building`/`reconciling` rather than treating partial or last-known
results as current. These methods do not exist today; their addition requires
the normal preload and renderer declaration changes in the implementation
task.

**A sandboxed HTML view gets no index method and no index HTTP route in these
phases.** This is the concrete leak prevention:

- The binary is outside the workspace, so `resolveInWorkspace` cannot reach it.
- The webview has no preload or `ipcRenderer`, so it cannot call trusted-renderer
  IPC.
- The loopback view server receives no reference to the metadata service and
  registers no `/api/v1/index`, task, project, backlink, or aggregate route.
- Existing `/api/v1/notes`, `/tags`, `/search`, and `/db` retain their current
  capabilities and per-path checks; this record does not silently switch them
  to unfiltered aggregate data.

This means renderer-owned dashboards ship first. If indexed queries are later
offered to views, that is a separate security task. Its minimum design is to
reuse an existing capability appropriate to the source, derive the allowed
source-path set with the existing compiled `readPolicy`, restrict **every input
row before joins, grouping, counts, or absence queries**, and test mixed allowed
and forbidden fixtures. Filtering returned rows after calculating totals is
still a leak: “three overdue tasks” reveals forbidden files even if their names
are removed. A generic metadata capability, raw SQL route, or filter-after-
aggregate implementation is prohibited.

## Concrete queries

The examples show the fixed semantics. Implementations use bound parameters and
fixed statements/query builders; snippets are abbreviated only for projection
columns and limits.

### Notes with unchecked TODOs but no task metadata

`has_task_metadata` is true when valid frontmatter contains `type: task` or any
of `status`, `due`, `project`, `priority`, `completed`, or `done`.

```sql
SELECT n.path, n.title, COUNT(*) AS unchecked_count
FROM notes n
JOIN tasks t ON t.source_path = n.path
            AND t.source_kind = 'checkbox'
WHERE n.has_task_metadata = 0 AND t.completed = 0
GROUP BY n.path, n.title
ORDER BY n.path
LIMIT :limit;
```

### Tasks with no project; unresolved project references

```sql
SELECT task_id, source_kind, source_path, title, status, due_day
FROM tasks
WHERE completed = 0
  AND (project_ref IS NULL OR trim(project_ref) = '')
ORDER BY due_day IS NULL, due_day, source_path
LIMIT :limit;
```

Unresolved or ambiguous non-empty references use a separate query: left join
`task_project_links`, select tasks with a non-empty `project_ref` and no link,
and return match state. They are not mislabeled “no project.”

### Active projects with no active task

```sql
SELECT p.project_id, p.source_path, p.name, p.status
FROM projects p
WHERE p.status_norm = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM task_project_links l
    JOIN tasks t ON t.task_id = l.task_id
    WHERE l.project_id = p.project_id AND t.completed = 0
  )
ORDER BY p.name, p.source_path
LIMIT :limit;
```

### Due this week, overdue, and without a due date

The renderer supplies local-calendar `YYYY-MM-DD` boundaries; the index does
not guess locale or week start. `:end_exclusive` is the day after the visible
week.

```sql
-- This week
SELECT * FROM tasks
WHERE completed = 0 AND due_day >= :start_day AND due_day < :end_exclusive
ORDER BY due_day, source_path LIMIT :limit;

-- Overdue
SELECT * FROM tasks
WHERE completed = 0 AND due_day < :today
ORDER BY due_day, source_path LIMIT :limit;

-- No valid due date
SELECT * FROM tasks
WHERE completed = 0 AND due_day IS NULL
ORDER BY last_touched_ms, source_path LIMIT :limit;
```

### Kanban across notes with `status:`

This is intentionally a note query, not a task query. It includes any valid
frontmatter `status`, whether or not `type: task` is present.

```sql
SELECT path, title, status, status_norm, due_day, project_ref
FROM notes
WHERE status IS NOT NULL AND trim(status) <> ''
ORDER BY status_norm, title, path
LIMIT :limit;
```

Grouping and column order happen in the trusted renderer from the bounded row
set; no user string becomes SQL.

### Stale tasks

```sql
SELECT task_id, source_kind, source_path, title, status, last_touched_ms
FROM tasks
WHERE completed = 0 AND last_touched_ms < :cutoff_ms
ORDER BY last_touched_ms, source_path
LIMIT :limit;
```

The caller computes `cutoff_ms = now - N days`; `N` is a validated positive
integer with a product-defined upper bound.

### Backlinks

```sql
SELECT l.source_path, n.title, l.line, l.raw_target
FROM wiki_links l
JOIN notes n ON n.path = l.source_path
WHERE l.resolved_path = :target_path
ORDER BY l.source_path, l.ordinal
LIMIT :limit;
```

### Unlinked mentions

For each title, filename stem, path-without-extension, and valid frontmatter
alias of the target, first select candidate notes sharing the name's normalized
terms. The fixed query builder creates one bound placeholder per term and
requires all of them:

```sql
SELECT n.path, n.title, n.body_text
FROM notes n
JOIN body_terms bt ON bt.path = n.path
WHERE bt.term IN (:term_1, :term_2 /* ... */)
  AND n.path <> :target_path
  AND NOT EXISTS (
    SELECT 1 FROM wiki_links l
    WHERE l.source_path = n.path AND l.resolved_path = :target_path
  )
GROUP BY n.path, n.title, n.body_text
HAVING COUNT(DISTINCT bt.term) = :term_count
LIMIT :candidate_limit;
```

The worker then verifies an exact normalized name with Unicode-aware boundaries
in stored `body_text`, excluding fenced/inline code and wiki-link spans recorded
by the body scan. SQL term matching is only a candidate accelerator. Results are
therefore mentions, not arbitrary substrings such as `art` inside `partial`.
Candidate and returned-result limits are mandatory.

## Phased delivery as task rows

These names are intended to become rows in `SHARED_TASKS.md` before
implementation; this architecture document does not assign their owner or
status.

1. **T-041A — Note metadata index and first renderer board.** Move the pure
   frontmatter/DB read models to shared code, add the worker-owned SQLite store,
   validation/rebuild, watcher reconciliation, status/progress IPC, and index
   notes, frontmatter, tags, headings, links, terms, and checkboxes. Ship a
   renderer kanban for notes with `status:` and replace at least one existing
   renderer full-note scan (tag collection is the smallest candidate). This is
   useful alone and must meet the cold/warm and corruption gates.
2. **T-041B — Unified task and project queries.** Add task-note, checkbox, and
   `.db` task/project projections, deterministic identities, link resolution,
   no-project/no-active-task, due, and stale queries, plus renderer dashboards.
3. **T-041C — Backlinks and unlinked mentions.** Add the exact body scanner,
   term candidate index, resolution diagnostics, backlink/mention renderer UI,
   and adversarial limits. It reuses the store and query envelope; it does not
   add a view route.
4. **T-041D — Scale and recovery gate.** Run packaged cross-platform 5,000- and
   10,000-note benchmarks, burst/external-edit/rename tests, memory and export
   measurements, corrupt/truncated/schema-mismatch recovery, and prove the
   documented budgets. Corrections remain in this phase; declaring the budgets
   “unverified but acceptable” is not completion.

T-041A deliberately ships first because frontmatter status/tag queries are
valuable without task unification or mention detection. Security, atomicity,
recovery, progress reporting, and watcher reconciliation are foundation work,
not later hardening.

## Required implementation tests

No tests are added by this design-only task. Implementation needs at least:

- Parser contract tests proving main and renderer share exactly the current
  valid/invalid frontmatter behavior, BOM/EOL handling, limits, dangerous-key
  removal, and byte-identical source preservation; shared `.db` v1/v2 parsing,
  2-MiB limit, unknown fields, and malformed input.
- Body scanner tests for fenced and inline code, headings, inline/frontmatter
  tags, wiki-links, aliases, duplicate checkbox text, checked variants,
  Unicode boundaries, false substring mentions, and input/work limits.
- Storage/query tests for every SQL result above, typed frontmatter values,
  invalid due dates, ambiguous projects, duplicate names, completion precedence,
  `.db` table-recognition rules, cascade deletion, bound limits, and no raw SQL
  or dynamic identifier input.
- Recovery tests for empty/missing/truncated/random-byte indexes, failed quick
  check, wrong schema/parser/root, incomplete build, leftover temp export,
  failed export, crash-before-export simulation, and delete/rebuild without any
  workspace write.
- Watcher integration tests for add, burst change, atomic save, external edit,
  unlink, rename-as-unlink/add, invalid-to-valid transition, edit during cold
  scan, workspace switch, queued-event replay, and no stale old projection.
- Security tests showing a sandboxed view has no IPC method or index route, the
  index path fails workspace resolution, and existing view routes still filter
  mixed allowed/forbidden paths before responding.
- Packaged worker/WASM startup tests and measured cold/warm time, peak WASM plus
  export memory, disk size, and event-loop delay for generated 5,000- and
  10,000-note workspaces on all release platforms.

## Required end-to-end scenario

This scenario is specified for implementation; it was not executed here.

1. With no cache for the workspace, the user opens a 5,000-note workspace.
   Neuron starts the watcher, waits for its ready boundary, starts a separate
   cold database in the metadata worker, and immediately opens the normal
   workspace UI. `metadataIndex.status()` reports `building`, indexed/discovered
   counts, and zero complete generation. The dashboard shows “Building index”
   with progress and does not present a partial zero-task result as truth.
2. The worker enumerates only `.md`, `.mdx`, and `.db`, parses stable file
   snapshots in bounded batches, records invalid/oversized counts, and commits
   one complete generation. It replays watcher events that arrived during the
   scan, marks the generation ready, exports atomically under the workspace hash,
   and emits one generation-changed notification. The dashboard issues its
   closed query and shows results from that generation.
3. The user creates `inbox.md` containing only
   `- [ ] Call the supplier\n`. The file write remains successful even if the
   index is unavailable. The known internal path and/or chokidar `add` event is
   queued and deduplicated. The worker verifies stable bytes, parses one
   unchecked checkbox, creates a checkbox task, sets
   `has_task_metadata = 0`, and commits that file projection in one transaction.
4. After the generation notification, the dashboard re-runs “unchecked TODOs
   without task metadata.” `inbox.md` appears once with count 1. It also appears
   as an active task with no project and no due date. It does not appear in the
   note-status kanban because it has no `status:`. Reloading the app loads the
   coherent snapshot, reconciles stats, and returns the same result without a
   full content scan.

## What this does not solve and what it costs

This index does not write metadata, provide task editing, choose a canonical
task workflow, enforce `.db` relations, make wiki-links navigable, assign
durable checkbox ids, preserve entity ids across file renames, infer task tables
from arbitrary schemas, or provide row-level `.db` modification time. It is not
full Markdown/MDX compilation, a universal search engine, semantic/embedding
search, OCR, attachment indexing, sync, or a backup. The write journal remains
the recovery feature; the index is disposable.

It also does not expose cross-workspace data or answer view queries. Only the
active workspace worker is queryable by trusted IPC; switching workspaces
terminates it and changes the store key.

Disk cost is the SQLite structure plus duplicated note bodies, terms, and
metadata. Memory cost is at least the whole SQLite image in WASM plus SQLite
working pages and, during export, another image-sized byte array. A reasonable
planning estimate is source body bytes plus relational/index overhead on disk
and again in memory, but no multiplier is asserted until T-041D measures real
fixtures. The first cold scan costs one read and parse of every participating
file; the user waits for cross-file dashboards, not for the ability to open and
edit a note.

## Unverified facts and implementation gates

- The installed `sql.js` build's FTS/JSON compile options and quick-check
  behavior were not executable because this worktree has no installed module.
  Optional extensions are not used; integrity behavior still needs a test.
- `sql.js` worker-thread WASM location in packaged Windows, macOS, and Linux
  builds is unverified even though main-process loading and WASM unpacking are
  present in source.
- The 50-ms event-loop, 2-second warm, and 10-second cold budgets, peak memory,
  index-to-source size ratio, and export time are targets, not measurements.
- Exact chokidar event sequences for Neuron's atomic rename and external editor
  saves vary by OS and editor. The design relies on reconciliation plus
  final-state reads, not a particular rename event; the matrix still needs to be
  observed.
- Same-size external changes that preserve filesystem mtime are not detected by
  warm stat reconciliation. A full rebuild detects them. Whether a periodic
  content audit is worth its I/O requires measurement rather than an assertion.
- Current wiki-link navigation, alias, and heading-fragment resolution semantics
  are not implemented. The index stores enough raw information but does not
  claim those product decisions.
