# Universal file search: candidate evaluation

An evaluation, not an implementation. The goal is a fast, local-first universal
file search — filenames, paths, full text, metadata, PDFs, Office documents,
source code, archives, OCR for images and scans — bundled with Neuron, exposing
a clean internal API, and able to gain semantic/vector search later *without
replacing the core index*.

**Recommendation: SQLite FTS5 via `better-sqlite3`, with extraction as a
separate layer and `sqlite-vec` as the eventual vector path.**

---

## 1. The two hard gates

Most candidates are eliminated before performance is worth measuring.

**Gate 1 — licence.** Neuron is Apache-2.0. A GPL-family engine linked into the
application would force Neuron's own terms to change. That is disqualifying for
bundling however good the engine is.

**Gate 2 — "fully locally, bundled".** Anything that needs a separate installed
application, a background service, or a running server fails the stated goal,
however fast it is.

| Candidate | Licence (verified) | Shape | Gate |
|---|---|---|---|
| **SQLite FTS5** | Public domain | Embedded library | **passes** |
| **Tantivy** | MIT (README badge) | Embeddable Rust crate, no daemon | **passes** |
| Meilisearch | MIT (Community Edition; Enterprise is BSL 1.1) | Standalone server/daemon | fails gate 2 |
| Typesense | GPL-3.0 | Standalone server — *"we expect users to run it as a separate daemon, and not integrate it with their own code"* | fails both |
| Recoll | GPL | Desktop application, built on Xapian | fails both |
| sist2 | GPL-3.0 | Standalone app + web UI, Elasticsearch or SQLite backend | fails both |
| Everything SDK | Not stated on the SDK page | DLL over IPC — *"Everything is required to run in the background"*; Windows only | fails gate 2, and cross-platform |

Licences were read from each project's own repository or site, not from memory.
Recoll's backend, Xapian, is itself GPL, so the elimination holds one level down.

Everything deserves a specific note because it is the reference point for
"instant": it is Windows-only, it indexes the NTFS Master File Table directly —
which is *why* it is instant, and which has no macOS or Linux equivalent — and
it requires the user to install and run voidtools' own application. It cannot be
bundled. Its speed is not portable.

That leaves **SQLite FTS5** and **Tantivy**.

---

## 2. What is already in the tree, and why it does not work

`sql.js` is already a dependency, used by the `.db` surface. "We already have
SQLite" turned out to be false for this purpose. Measured with
`tools/sqlite-capability-experiment.mjs`:

```
=== sql.js (WebAssembly, already a dependency) ===
sqlite version         3.49.1
FTS5                   NO
FTS4/3                 yes
extensions             DISABLED (OMIT_LOAD_EXTENSION)
fts5 virtual table     refused — no such module: fts5
threading              single-threaded (THREADSAFE=0)
mmap                   unavailable (MAX_MMAP_SIZE=0)
persistence            export() — whole database as bytes
```

Four separate disqualifications for a universal index:

- **No FTS5.** Only FTS3/4, which lack the BM25 ranking, prefix queries and
  columnsize controls that make FTS5 worth using.
- **`OMIT_LOAD_EXTENSION`.** No extension can ever be loaded, so the
  `sqlite-vec` path for vectors is closed on this build — and vectors-later is a
  stated requirement.
- **Single-threaded, no mmap.** Indexing would contend with the `.db` surface on
  the same runtime.
- **`export()` returns the whole database as a byte array.** Persisting means
  serialising and rewriting the entire index on every save. For a workspace-scale
  index that is the wrong shape entirely.

`better-sqlite3`, by contrast, measured on this machine:

```
=== better-sqlite3 (native) ===
sqlite version         3.53.4
fts5                   available — matched 1
loadExtension API      present
OMIT_LOAD_EXTENSION    absent (extensions possible)
persistence            ordinary file, incremental writes
```

FTS5 works end to end, extensions are possible, and persistence is an ordinary
file with incremental writes.

---

## 3. Why SQLite beats Tantivy here

Tantivy is the stronger *search engine*. It is MIT, embeddable, has no daemon,
starts in under 10ms, and is closer to Lucene than anything else that passes the
licence gate. On raw indexing and query throughput it would very likely win a
benchmark.

It loses on three things specific to this project:

**The vector requirement decides it.** The brief asks for semantic search to be
addable later *without replacing the core index*. With SQLite, FTS5 and
`sqlite-vec` live in the same file, under the same transaction, in the same
backup, joined by the same `rowid`. With Tantivy, vectors need a second store
alongside, and "without replacing the core index" quietly becomes "running two
indexes that must be kept consistent". The measured `loadExtension` result above
is what makes the SQLite path real rather than theoretical.

**Packaging cost is paid four times.** Tantivy is Rust: it needs a napi binding
and prebuilt binaries for Windows x64, macOS x64, macOS arm64 and Linux x64, or
a Rust toolchain on the user's machine. `better-sqlite3` ships prebuilds for
major platforms. This project already knows what native modules cost —
`node-pty` needs `asarUnpack` *and* a postinstall `chmod` because its
`spawn-helper` ships without an executable bit (`tools/fix-pty-permissions.mjs`).
That is one native module's worth of scar tissue; a second one in Rust is a
larger bet.

**Maintenance surface.** A napi binding to a Rust crate is a component this
project would own and have to keep building. `better-sqlite3` is a widely
deployed Node module doing exactly one thing.

Tantivy becomes the right answer if FTS5 measurably fails to keep up at the
corpus sizes that matter. That is the trigger to revisit — see §7.

---

## 4. Extraction is a separate layer, and that is the point

Content extraction is orthogonal to the index. Whatever indexes the text, the
text has to be produced first, and every good option is permissively licensed:

| Content | Candidate | Licence |
|---|---|---|
| PDF | `pdfjs-dist` | Apache-2.0 |
| DOCX | `mammoth` | BSD-2-Clause |
| XLSX | SheetJS `xlsx` | Apache-2.0 |
| OCR | `tesseract.js` | Apache-2.0 |
| Audio/video metadata | `music-metadata` | MIT |
| Archives | stream through the above per entry | — |

Keeping extraction behind one `extract(path) -> { text, metadata }` interface
means each format is added independently, a format that fails degrades to
filename-and-path search rather than breaking the index, and the engine decision
above does not have to be revisited to add PDF support.

**OCR is the one to stage last.** `tesseract.js` is Apache-2.0 and works, but it
is slow enough that it belongs on an explicit opt-in and a background queue, not
in the default indexing path.

---

## 5. Proposed architecture

**Process.** The index lives in the **main process**, not the renderer. It owns
the filesystem already, it already runs the `chokidar` watcher, and a native
module in the renderer would have to be reachable through the sandbox. Indexing
work goes on a `utilityProcess` so a large re-index cannot block the UI.

**API.** One interface over IPC, deliberately narrow:

```ts
search(query: string, opts?: { limit?; kinds?; paths? }): Promise<SearchHit[]>
indexStatus(): Promise<{ files: number; pending: number; lastRun: Date }>
reindex(scope?: string): Promise<void>
```

`SearchHit` keeps the shape `src/renderer/lib/search.ts` already returns —
`{ path, score, titleMatch, matches: [{ line, text }] }` — so callers do not
learn a new result type.

**Watching.** Reuse the existing `chokidar` watcher rather than adding a second
one. It already respects the workspace's exclusions, including the `.neuron`
exception; a second enumeration would eventually disagree with the first about
what is on disk.

---

## 6. Migration path

`src/renderer/lib/search.ts` is not thrown away. It is in-memory, pure, fast for
loaded notes, covered by 17 tests, and it is what the assistant's context builder
now depends on.

1. **Add alongside.** The SQLite index serves *file* search — everything on disk,
   including binaries and non-note formats. `lib/search.ts` keeps serving the
   loaded-notes case it is good at.
2. **Converge the result shape** so the UI can render either.
3. **Move the note case over only if measurement justifies it.** For a few
   hundred notes already in memory, an in-memory scan will beat a database
   round-trip. The migration is finished when the index is faster, not when it
   exists.

Nothing above requires changing `lib/search.ts`, which is why this evaluation
did not touch it.

---

## 7. Benchmark targets

Not yet measured — see §8. These are the numbers the implementation should be
held to, on a corpus of ~50,000 files including at least 500 PDFs and a mixed
Office set:

| Metric | Target |
|---|---|
| Cold index build | < 5 min, and resumable |
| Incremental update, one changed file | < 100 ms end to end |
| Filename/path query, p50 | < 20 ms |
| Full-text query, p50 | < 100 ms |
| Full-text query, p95 | < 300 ms |
| Index size | < 15% of indexed text volume |
| Resident memory while idle | < 100 MB |

If FTS5 misses the p95 target at that scale, that is the trigger to revisit
Tantivy — with the extraction layer and API already in place, the engine is
replaceable without touching callers.

---

## 8. What this evaluation did NOT establish

Stated plainly, because the gaps matter:

- **No corpus benchmark was run.** The licence gate and the SQLite capability
  probe were measured; throughput and latency were not. The numbers in §7 are
  targets, not results.
- **Tantivy was not built.** Its elimination rests on packaging cost and the
  vector requirement, not on measured performance — and on those grounds it
  could still win if the vector requirement were dropped.
- **`better-sqlite3` prebuild coverage was verified only on Windows x64.** The
  README claims prebuilds for major platforms; macOS arm64 and the Store appx
  path are the two most likely to bite and were not tested.
- **Everything's licence terms are not stated on its SDK page.** It fails on
  platform and daemon grounds regardless, so this was not pursued.
- **`sqlite-vec` itself was not tested**, only that `loadExtension` exists and
  `OMIT_LOAD_EXTENSION` is absent — which is the precondition, not the proof.

Reproduce the measured parts with:

```bash
node tools/sqlite-capability-experiment.mjs
```
