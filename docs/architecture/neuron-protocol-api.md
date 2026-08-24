# Neuron view transport and API decision

**Status:** Decision record for T-008  
**Target:** Electron `42.4.1`, htmx `2.0.10`  
**Decision:** **C — hybrid.** Ship `neuron://` as the production transport,
retain the loopback adapter only behind a development-only flag, and put both
behind one transport-neutral dispatcher.

This is a migration decision, not authorization to implement it. The protocol
must not become the shipping default until the Electron end-to-end gate in
section 11 passes every verb, header, status, isolation, and CSP case. If that
gate exposes any loss of normal XMLHttpRequest/fetch semantics that cannot be
fixed without `bypassCSP`, disabling web security, putting a secret in authored
content, or maintaining a second dispatcher, the decision falls back to
**B — loopback only**. That fallback is a successful outcome, not a reason to
weaken the existing platform.

## Why C

Three findings drive the decision:

1. Electron 42's documented protocol API is capable in principle. A standard,
   secure scheme with Fetch support resolves relative URLs, sends a web-standard
   `Request` (including method, headers, and body) to `protocol.handle`, and
   accepts a web-standard `Response`. There is no documentation-level blocker
   for htmx's GET/POST/PUT request model.
2. A handler is registered to an Electron `Session`, not globally across every
   partition. Neuron already gives each view an isolated in-memory partition.
   A partition-specific handler can therefore be the primary proof that a
   request came from the view to which that handler is bound, while the
   dispatcher still checks the session id on every request.
3. The existing implementation's strongest controls are reusable, but they are
   not yet separated from HTTP. `src/main/htmx/server.ts` combines an
   `http.Server`, cookie and Host/Origin authentication, route matching,
   validation, filesystem/note operations, presentation, and response writing.
   Extracting one dispatcher first is mandatory. A direct protocol rewrite
   would create two security implementations and is rejected.

Option A is not selected because keeping a development-only loopback adapter
preserves cheap Node integration tests and provides an immediate rollback
transport while the protocol path matures. The loopback adapter must be
impossible to enable in a production package. Option B is not selected now
because Electron 42 documents the request primitives htmx needs and the protocol
removes the TCP listener, Host-header, DNS-rebinding, and local-process attack
surface. B remains the explicit fail-closed result if the browser gate fails.

## 1. Current state

### File-by-file transport boundary

| File | Transport-specific today | Reusable application/security logic |
| --- | --- | --- |
| `src/main/htmx/index.ts` | Lazy loopback lifecycle, `serverOrigin`, `htmxJsPath`, document URL containing a boot token, and the cookie-oriented `SessionManager` setup. | View recognition, `.neuron` scaffold, manifest discovery/validation, manifest-hash approval, effective grants, path-policy compilation, workspace-switch revocation, and IPC lifecycle shape. These need extraction from module globals but not redesign. |
| `src/main/htmx/server.ts` | `http.Server`; `IncomingMessage`/`ServerResponse`; Host, Origin, and cookie parsing; stream body collection; URL base; `writeHead`; HTTP route matching; `Set-Cookie`. | Resource ceilings, rate limiting call, capability checks, path-policy checks, body schemas, directory walking, variables, search, notes/tags, fragment rendering, MIME choices, optimistic hashes, atomic writes, JSON/HTML representation choice, and safe errors. These are reusable only after they stop accepting or writing Node HTTP objects. |
| `src/main/htmx/sessions.ts` | One-time boot token, cookie token, cookie parsing contract, constant-time token comparison. | Session id, TTL, capability and compiled-policy storage, revocation, lookup, and token-bucket rate limiting. The target record needs more identity and binding fields. |
| `src/main/htmx/html.ts` | `wrapDocument` builds HTTP paths (`/views/<sid>/...`). | Escaping, limited interpolation, document structure, safe error fragments, and fragment presenters. URL generation must be injected rather than constructed here. |
| `src/main/htmx/theme.ts` | None except that `server.ts` currently serves its string. | The design-system CSS is an app-owned runtime asset. |
| `src/main/htmx/manifest.ts` | None. | Strict manifest/variable schemas, known capabilities, unknown-key rejection, effective grants. New semantic note capabilities would be a versioned schema addition, not a transport concern. |
| `src/main/htmx/pathPolicy.ts` | None. | Workspace-relative normalization, glob policy, canonical containment, and symlink/junction escape checks. This remains the single path gate. |
| `src/main/htmx/appPaths.ts` | None. | `.nhtml`, `.ndash`, and `neuron.app` recognition; manifest location; script-policy selection; display names. |
| `src/main/main.ts` | `getViewServerOrigin()`, string-prefix origin checks, HTTP dev origin assumptions, and the loopback-oriented navigation pin. | `web-contents-created`, `will-attach-webview`, no preload/Node, context isolation, sandbox, popup denial, permission denial, and session revocation hooks. `WORKSPACE_FILE` already recognizes `.nhtml`, `.ndash`, `neuron.app`/manifest files, and `.neuron` JSON/HTML/CSS, so its reload notifications are transport-neutral. The guards must change from “same loopback origin” to an exact route allowlist tied to the registered view. |
| `src/main/preload.ts` | None beyond returning a transport-produced URL/partition through `htmxViews.open`. | The narrow open/approve/close/reset IPC surface. No view preload or `ipcRenderer` bridge is introduced. |
| `src/renderer/surfaces/HtmxViewSurface.tsx` | Comments and the URL received from main mention loopback. | Approval UI, isolated `<webview>`, per-view partition, crash isolation, close/revoke, and reload-on-save. Opening a fresh session on relevant file changes is transport-neutral. |
| `tools/htmx-views.test.mjs` | Live `http` server, cookies, Host spoofing, raw TCP port, HTTP fetch helper, HTTP document URL. | Path/manifest/session/escaping tests and most route behavior assertions. These become dispatcher contract tests; separate adapter tests cover HTTP and protocol. |
| `docs/htmx-views.md`, `docs/custom-views.md`, `skills/neuron-mini-apps/SKILL.md` | Loopback, cookie, and root-absolute `/api/v1/...` authoring guidance. | Threat model, capability model, view formats, semantic API concepts, and local-first authoring model. |
| Demo `.nhtml`, `.ndash`, `neuron.app`, templates | Root-absolute `/api/v1/...` and `fetch('/api/v1' + p)`. | The three required view kinds and their real read/write scenarios. They are the migration fixtures. |
| `tools/copy-htmx.mjs`, `package.json` | The runtime is copied beside the main bundle so the HTTP server can read it. | Offline packaging remains correct. `dist/**/*` places the copied runtime in the ASAR; `asarUnpack` is intentionally limited to `node-pty` and `sql.js`, and `extraResources` covers examples/icon rather than htmx. The target asset registry points to the known packaged runtime; no URL becomes a filesystem path and no new unpack rule is needed. |

### What extraction actually costs

This is not a thin replacement of `server.listen()` with `protocol.handle()`.
Most of `server.ts` must be separated along these boundaries:

```text
HTTP IncomingMessage ─┐
                      ├─> TransportRequest ─> dispatcher ─> service ─> TransportResponse
Electron Request ─────┘                                      │
                                                            ├─ directoryService
                                                            ├─ fileContentService
                                                            ├─ noteService
                                                            ├─ fragmentService
                                                            └─ runtimeAssetService
```

The dispatcher owns route and method matching, session/capability enforcement,
schema validation, rate/size limits, representation selection, and safe error
mapping exactly once. Adapters only normalize a request, supply a trusted
transport binding, and serialize the returned response. Services do not know
about HTTP, Electron, htmx, cookies, or `Response`.

The existing `apiNotes` and note search helpers currently scan files directly,
and file mutation writes directly with `fs`. The target `/notes` mutations must
use Neuron's editor-aware note service so dirty state, autosave, indexing,
conflict handling, and metadata stay coherent. Directory metadata and generic
file content remain separate services. That service boundary is more work than
the protocol adapter itself and must not be hidden inside a transport change.

## 2. Electron 42 protocol findings

Primary versioned sources:

- Electron [`v42.4.1` protocol API](https://github.com/electron/electron/blob/v42.4.1/docs/api/protocol.md)
- Electron [`v42.4.1` `CustomScheme`](https://github.com/electron/electron/blob/v42.4.1/docs/api/structures/custom-scheme.md)
- Electron [`v42.4.1` session API](https://github.com/electron/electron/blob/v42.4.1/docs/api/session.md)
- Electron [`v42.4.1` web contents API](https://github.com/electron/electron/blob/v42.4.1/docs/api/web-contents.md)
- Electron [`v42.4.1` web request API](https://github.com/electron/electron/blob/v42.4.1/docs/api/web-request.md)
- Electron [`v42.4.1` webview API](https://github.com/electron/electron/blob/v42.4.1/docs/api/webview-tag.md)
- Official [Electron 42.4.1 release record](https://releases.electronjs.org/release/v42.4.1)

### Registration and partitions

`protocol.registerSchemesAsPrivileged(...)` must run synchronously before the
app `ready` event and can be called only once. It registers the scheme's
privilege classification for the application. `protocol.handle(...)` normally
runs after `ready`.

Handlers are different: Electron documents that a protocol handler belongs to
a specific `Session`. Registering on the top-level `protocol` object covers the
default session only. A webview with a custom partition uses a different
session and needs `session.fromPartition(partition).protocol.handle(...)`.

Therefore the answer is **both, for different purposes**:

- Register the `neuron` scheme and its privileges once, globally, before
  `app.whenReady()`.
- Install the `neuron` handler on every view's unique in-memory `Session`
  before the webview attaches. Do not install it on the default session or the
  browser partition because those surfaces do not need view access.

The same rule applies to a `persist:` partition, but Neuron should keep
non-persistent `view-<opaque-id>` partitions. Electron documents that partitions
without `persist:` are in memory and that pages sharing a partition share the
same session. Neuron must prevent partition reuse, not merely rely on an opaque
name.

### Required privilege set

```ts
protocol.registerSchemesAsPrivileged([{
  scheme: 'neuron',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    bypassCSP: false,
    allowServiceWorkers: false,
    stream: false,
    codeCache: false,
    allowExtensions: false,
  },
}])
```

| Privilege | Electron 42 finding | Neuron decision |
| --- | --- | --- |
| `standard` | Electron says this enables generic URI parsing and correct relative/absolute resource resolution. Non-standard schemes cannot resolve relative resources; web storage APIs are disabled for non-standard schemes. | **True.** Required for `./api/...`, CSS, scripts, and assets. This does not authorize the FileSystem API; Neuron exposes no file handles and its handler has an explicit route table. |
| `secure` | Listed by Electron as an opt-in scheme privilege. | **True.** Local app content should be treated as secure. The exact set of Chromium secure-context features it enables is not enumerated in Electron's page and is not relied on for authorization. |
| `supportFetchAPI` | Listed as enabling Fetch API support; `protocol.handle` receives a global `Request`. | **True.** Required by `.ndash` `fetch` and by Chromium request plumbing used by htmx/XHR. |
| `stream` | Electron says stream protocols should enable it for audio/video streaming behavior. | **False.** Current documents, CSS, JS, JSON, fragments, and bounded files are finite bodies. Revisit only with a separately tested media route. |
| `bypassCSP` | Allows resources to bypass CSP. | **False, non-negotiable.** If protocol mode needs it, escalate and select B. |
| `allowServiceWorkers` | Allows ServiceWorker registration. | **False.** Offline/network interception is not part of the view platform and would create another persistent execution/control plane. |
| `corsEnabled` | Listed as the CORS privilege; default false. | **False.** All authored document/API/runtime routes are deliberately same-origin under `neuron://view`. Remote and cross-origin requests must remain blocked. Exact Chromium behavior with custom-scheme XHR is an E2E gate below. |
| `codeCache` | V8 code cache; only works with `standard`. | **False.** Not needed for the small bundled runtime. |
| `allowExtensions` | Allows Chrome extensions on the scheme. | **False.** |

`protocol.handle` receives a web-standard `Request` and returns a web-standard
`Response`. Electron's versioned example explicitly forwards `req.method`,
`req.headers`, and `req.body`, and constructs responses with status, headers,
and body. Deprecated `register*Protocol` and `intercept*Protocol` APIs are not
part of this design.

### Sandboxed webview behavior

The protocol is available inside the sandboxed webview because it is installed
on that webview partition's `Session`; sandboxing does not make the default
session's handler cross partitions. The view remains a separate guest
`WebContents` with no preload, Node integration off, context isolation on, and
the Chromium sandbox on. Electron warns that `<webview>` itself has stability
costs and recommends considering alternatives. Replacing it is outside T-008;
the migration preserves the current isolation boundary.

`protocol.handle`'s documented `Request` does not expose a `webContents` id.
Electron's session-scoped `webRequest` details can expose optional
`webContentsId`, `webContents`, and frame fields, but whether all custom-scheme
resource/XHR requests populate those fields in Electron 42.4.1 is **unverified
and must be proven by E2E**. Partition binding is mandatory; webContents binding
is an additional check wherever Electron supplies it.

## 3. HTMX compatibility plan and verdict

The htmx 2 documentation states that htmx uses AJAX requests, sends
`HX-Request: true`, defaults `selfRequestsOnly` to true, uses URL parameters for
GET and DELETE, and normally uses form encoding for other form requests. It
also documents configurable status handling and that non-success responses do
not swap by default. Sources:

- [htmx 2 documentation](https://htmx.org/docs/)
- [`hx-get`](https://htmx.org/attributes/hx-get/)
- [`hx-encoding`](https://htmx.org/attributes/hx-encoding/)
- [request/response header reference](https://htmx.org/reference/)
- [htmx events and non-200 behavior](https://htmx.org/events/)
- [`HX-Redirect`](https://htmx.org/headers/hx-redirect/)

No browser scenario was executed in this worktree. The verdicts below distinguish
what the versioned Electron API establishes from what must still be measured.

| Feature | What must hold | Documentation verdict | Required Electron test |
| --- | --- | --- | --- |
| `hx-get` | XHR reaches the handler as GET; query parameters and `HX-Request` survive; HTML response swaps. | **Supported in principle.** Standard URL resolution plus Request/Response covers it. | Click and load-trigger cases using `./api/v1/context` and search parameters; assert handler input and final DOM. |
| `hx-post` | POST method, urlencoded body, content type, and htmx headers survive. | **Supported in principle; runtime proof required.** Electron explicitly exposes method/headers/body. | Submit inputs containing spaces, Unicode, duplicate names, empty values, and encoded delimiters; verify bytes and parsed schema. |
| `hx-put` | PUT method and body survive without method coercion. | **Supported in principle; runtime proof required.** | Update a writable variable and a file; assert PUT at dispatcher and 200 fragment/JSON. |
| Form submission | htmx-enhanced forms preserve normal successful controls and encoding; native same-origin forms do not escape the route allowlist. | **HTMX form supported in principle. Native custom-scheme POST unverified.** | Test htmx GET/POST/PUT forms and a native POST form. Native forms are not a required authoring primitive; block or document them if Chromium does not preserve semantics. |
| Query strings | `URL.searchParams` preserves repeated keys, empty values, Unicode, and encoded characters without double decoding. | **Supported by standard URL parsing; normalization rules still need tests.** | Table-driven parser and Electron requests, including `%2e%2e`, `%252e%252e`, `%2f`, `+`, and repeated keys. |
| Request bodies | Bounded bytes remain readable once; JSON and urlencoded parsing are explicit; unsupported MIME returns 415. | **Supported in principle via `Request.body`/`arrayBuffer()`.** | Empty, 1-byte, at-limit, over-limit, malformed JSON, urlencoded, and multipart rejection. |
| `HX-Request` | Header arrives exactly as `true` and selects HTML presentation. | **Supported in principle via `Request.headers`.** | Compare same route with and without the header; assert HTML vs JSON and `Vary: HX-Request`. |
| Response headers | `Content-Type`, CSP, `HX-*`, `Location`, `Cache-Control`, and security headers reach Chromium. | **Supported in principle via `Response`; individual Chromium behavior unverified.** | Observe handler output and renderer-visible headers. Assert CSP enforcement, MIME/nosniff, and htmx response headers. |
| 403/404/409/429 | Status is preserved, safe body is readable, correct htmx error event fires, and the page does not treat it as success. | **Supported as a `Response` status. htmx does not swap 4xx by default.** | Assert status/event/body for each. Inject a trusted htmx meta configuration or external runtime listener only if product UX requires swapping error fragments; never turn an error into 200 merely to force a swap. |
| Redirects | External, cross-session, and non-route redirects are denied. Internal htmx navigation uses an allowlisted `HX-Location`/`HX-Redirect` on 2xx, not an unchecked 3xx. | **Raw Response redirect behavior is unverified and not needed.** htmx documents that response headers are not processed on 3xx. | Dispatcher rejects redirect intents except exact same-session document routes; navigation guard blocks crafted `Location`, `HX-Location`, and `HX-Redirect` targets. |
| Relative URLs | `./api/v1/...`, `./style`, `./asset/...`, and injected runtime URLs resolve inside the current session. | **Documented supported when `standard: true`.** | Resolve from the real document URL, from swapped fragments, and after history/hash changes. |
| Asset loading | Same-origin script/style/image requests reach the correct route and preserve MIME/CSP. | **Supported in principle.** | Load bundled htmx, Neuron CSS, registered component CSS, allowed view style, and registered workspace asset; reject unknown ids and bad MIME. |
| CSS | Local CSS loads; `@import`, remote/protocol-relative URLs, and unregistered asset URLs fail. | **Protocol transport neutral; browser CSP behavior must be measured.** | Verify strict CSP, CSS scanner, nested encodings, comments/whitespace, `url(data:)` policy, and no remote requests. |
| Bundled `htmx.js` | Exact packaged bytes load offline under `script-src 'self'` with `nosniff`. | **Supported in principle.** | Packaged-app E2E with network disabled; assert version and no fallback to `node_modules` or CDN. |
| Fragment swaps | Returned HTML is parsed and swapped; newly inserted htmx attributes are processed; scripts do not execute. | **Normal htmx behavior; transport-independent.** | Load, click, nested fragment, out-of-band attempt, `<script>` attempt, and escaped untrusted values. |
| Error fragments | `HX-Request` gets safe HTML and non-htmx gets structured JSON; no stack/path/token leaks. | **Dispatcher behavior, not a protocol limitation.** Default htmx 2 does not swap 4xx. | Assert safe bodies and explicit error target/event UX for all required statuses. |
| Reload-on-save | Old session is revoked; a fresh partition/handler/session re-reads source, manifest, and grants; variables do not trigger destructive reloads. | **Transport-independent.** | Modify `.nhtml`, `.ndash`, `neuron.app`, manifest, fragment, style, and config; assert old URL fails and new DOM loads. |
| `.ndash` fetch | Same-origin GET/PUT with JSON works under the narrowed scripting CSP; remote fetch fails. | **Supported in principle via `supportFetchAPI`.** | Run the existing dashboard, update the variable, and attempt HTTP/HTTPS, websocket, image, beacon, and navigation exfiltration. |

**HTMX verdict:** **provisionally compatible feature by feature; no documented
semantic blocker.** Migration may proceed only as C's gated phases. A failure
of method/body/header/status behavior, same-origin enforcement, or strict CSP in
the actual Electron webview ends the protocol recommendation and selects B.

## 4. Target API and route table

### URL shape

Use one document origin so `'self'` remains meaningful:

```text
neuron://view/<sid>/document
neuron://view/<sid>/runtime/htmx.js
neuron://view/<sid>/runtime/neuron.css
neuron://view/<sid>/runtime/components/<id>.css
neuron://view/<sid>/style
neuron://view/<sid>/asset/<assetId>

neuron://view/<sid>/api/v1/...
```

This deliberately adapts the candidate `neuron://runtime/...` host. A separate
`runtime` host is a separate origin and would force broader CSP/CORS rules. The
session-scoped runtime aliases still resolve through an app-owned explicit
registry and never expose a workspace path.

All JSON success responses have `{ data: ..., meta?: ... }`. All JSON errors
have `{ error: { code, message, requestId, details?: safeFields } }`. An
`HX-Request: true` receives an HTML fragment where the route defines one;
otherwise it receives JSON. Responses that vary use `Vary: HX-Request`.

`noteId` and `assetId` are opaque ids issued by Neuron. They are not paths.
Unknown ids are 404. Schemas reject unknown fields.

| Method | Canonical path | Capability | Request schema | Success response |
| --- | --- | --- | --- | --- |
| GET | `/runtime/htmx.js` | session only | No query/body | Registered `htmx-2.0.10` bytes, JS MIME |
| GET | `/runtime/neuron.css` | session only | No query/body | Registered design-system CSS |
| GET | `/runtime/components/:id.css` | session only | `id` from compile-time registry | Registered component CSS |
| GET | `/document` | session only | No body; optional safe theme selection comes from session, not query | Full HTML with strict CSP |
| GET | `/style` | session + manifest/path policy | No body | Auto style selected from the view identity; CSS MIME |
| GET | `/asset/:assetId` | route-specific read grant + manifest asset declaration | Opaque id only | Bounded bytes with registry-derived MIME |
| GET | `/api/v1/context` | session only | No body | JSON context; htmx gets a context summary fragment |
| GET | `/api/v1/variables` | `variables.read` | Optional `keys` list, bounded | Definitions/values; htmx definition list |
| GET | `/api/v1/variables/:key` | `variables.read` | Valid variable key | Variable definition/value; htmx value fragment |
| PUT | `/api/v1/variables/:key` | `variables.write` and variable `writable` | JSON or urlencoded `{ value }` | Updated value; htmx confirmation fragment |
| GET | `/api/v1/fs/tree` | `workspace.directories.list` | `path` workspace-relative directory, `depth` integer 0..8, `limit` 1..500 | Bounded directory tree metadata; htmx nested list |
| GET | `/api/v1/fs/list` | `workspace.directories.list` | `path`, optional validated `glob`, `limit` 1..500, opaque `cursor` | Direct children metadata; htmx list |
| GET | `/api/v1/fs/file-count` | `workspace.directories.list` | `path`, optional validated `glob`, bounded walk | `{ count, truncated }`; htmx metric |
| GET | `/api/v1/fs/stat` | `workspace.directories.list` | `path` | Safe metadata only: kind, size, modified, opaque id; never absolute path |
| GET | `/api/v1/files/content` | `workspace.files.read` | `path` | `{ path, content, hash, modified }`; htmx escaped/preformatted fragment only when explicitly requested |
| POST | `/api/v1/files/create` | `workspace.files.create` | `{ path, content, expectedMissing: true }` | 201 `{ path, hash }`; htmx created fragment |
| PUT | `/api/v1/files/update` | `workspace.files.write` | `{ path, content, baseHash }`; `baseHash` required | `{ path, hash }`; htmx saved fragment |
| DELETE | `/api/v1/files/delete` | `workspace.files.delete` | JSON `{ path, baseHash, confirm: true }`; no destructive query-string action | `{ path, deleted: true }`; htmx deleted fragment |
| GET | `/api/v1/search` | `workspace.search` | `q` max 256, optional safe folder/tag filters, `limit` 1..50 | Search rows; htmx results fragment |
| GET | `/api/v1/notes` | `notes.read` | Optional folder/tag, `limit` 1..200, opaque cursor | Note summaries; htmx table/list |
| POST | `/api/v1/notes` | **new** `notes.create` | `{ parentPath, title, content, expectedMissing: true }` | 201 note summary/id; htmx created fragment |
| GET | `/api/v1/notes/:noteId` | `notes.read` | Opaque note id | Note DTO from `noteService`; htmx safe note fragment |
| PUT | `/api/v1/notes/:noteId` | **new** `notes.write` | `{ content, baseRevision }`; revision required | Updated note/revision; htmx saved fragment |
| DELETE | `/api/v1/notes/:noteId` | **new** `notes.delete` | `{ baseRevision, confirm: true }` | Tombstone/result from `noteService`; htmx deleted fragment |
| GET | `/api/v1/tags` | `tags.read` | Optional bounded prefix/count filters | Tag DTOs; htmx badges |
| GET | `/api/v1/fragments/:fragmentId` | session; `variables.read` only if variable interpolation is requested | Id `[A-Za-z0-9_-]{1,64}` and bounded scalar params | Escaped/interpolated HTML fragment; JSON callers get `{ html }` |

Common errors are 400 `invalid_request`/`invalid_path`, 401 `session_invalid`,
403 `missing_capability`/`path_not_allowed`/`binding_mismatch`, 404
`not_found`, 405 `method_not_allowed`, 409 `conflict`/`already_exists`, 413
`too_large`, 415 `unsupported_media_type`, 422 `unsafe_css`/`invalid_config`,
429 `rate_limited`, and 500 `internal`. A 500 never contains an exception.

The new note capabilities are intentionally distinct. Existing
`workspace.files.write/create/delete` grants do not silently gain the power to
mutate an open note. Manifests that need semantic note mutation must request
the versioned note capabilities and receive approval. `fileContentService`
rejects create/update/delete requests targeting `.md`, `.mdx`, or any path
recognized as a Neuron note and returns a safe 409 directing the caller to the
semantic `/notes` route. A caller cannot bypass `noteService` by choosing the
generic file-content API.

There is no `/fs/readFile`, `/fs/writeFile`, `/fs/readdir`, `/fs/unlink`,
`/fs/call`, `/execute`, `/ipc`, `/command`, generic `neuron://fs/<path>`, or
`neuron://file/<path>`.

## 5. Authoring model

Authors write:

```html
<section hx-get="./api/v1/context" hx-trigger="load">Loading…</section>
<section hx-get="./api/v1/fs/file-count?path=Projects" hx-trigger="load">…</section>
```

They never write `neuron://`, a session id, a token, or a partition. The served
document is `neuron://view/<sid>/document`; standard URL resolution treats
`./api/v1/context` as `neuron://view/<sid>/api/v1/context`. Swapped fragments
resolve against the unchanged document URL.

No `<base>` tag is needed or recommended. Keeping `base-uri 'none'` prevents an
authored base from retargeting relative resources. Injecting a base would require
weakening that directive, ordering Neuron's base ahead of authored markup, and
testing fragment/history behavior for no gain.

Existing workspaces use root-absolute `/api/v1/...`. During migration only, the
protocol adapter may accept `neuron://view/api/v1/...` and normalize it to the
session bound to that partition. This is a non-public compatibility alias; it
never bypasses the dispatcher and cannot choose a session. New examples,
templates, docs, and skills use `./api/v1/...`. The alias is removed only in a
major release after a workspace audit; Neuron never rewrites user files.

Injected runtime URLs are generated by the document service. Custom styles use
`./style`; manifest-declared assets use `./asset/<opaque-id>`. Authors cannot
turn a local path into a URL.

## 6. Session and authorization model

`neuron://` is routing, not authentication.

```ts
interface ViewSession {
  id: string;                         // 256-bit random, opaque
  workspaceRoot: string;              // internal absolute canonical root
  entryFile: string;                  // normalized workspace-relative path
  manifestIdentity: string;            // id or canonical manifest location
  manifestHash: string;
  capabilities: ReadonlySet<Capability>;
  readPolicy: CompiledPathPolicy;
  writePolicy: CompiledPathPolicy;
  partition: string;                  // unique in-memory partition
  webContentsId: number | null;       // bound on attach where obtainable
  createdAt: number;
  lastAccessAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revocationReason: string | null;
  theme: 'light' | 'dark';
  allowScripts: boolean;
  rateBucket: RateBucket;
  assetRegistry: ReadonlyMap<string, RegisteredAsset>;
}
```

Every request performs, in order:

1. The adapter parses once, rejects credentials, ports, unexpected host/scheme,
   malformed escapes, encoded separators, duplicate structural segments, and
   unsupported methods/content types.
2. The adapter supplies a trusted binding: the Electron `Session`/partition for
   which its handler was installed and, where Electron provides it, the
   requesting webContents/frame id.
3. The dispatcher extracts the canonical `sid`, looks up a live, unexpired,
   non-revoked record, and requires the adapter partition to equal the record.
4. If `webContentsId` is bound and the request exposes an id, it must match.
   A missing id never substitutes for a mismatched one; coverage is measured by
   resource type in E2E.
5. The dispatcher matches one method and route, rate-limits, enforces body/work
   ceilings, validates the full schema, checks the capability, then applies the
   compiled path policy and canonical containment before calling a service.
6. The response mapper emits only allowlisted headers and safe bodies and
   updates `lastAccessAt`.

Opening a view reserves a never-reused partition, creates its session record,
installs a handler closure on `session.fromPartition(partition)`, then permits
exactly one webview attachment whose `params.src` and partition match that
record. `did-attach-webview` binds the guest `webContents.id`. A second attach,
another src, partition reuse, or a destroyed/revoked record is denied. Closing,
workspace switching, manifest/source reload, guest destruction, TTL expiry, or
permission reset revokes the record and unregisters or fail-closes its handler.

### Boot token and cookie decision

**They do not survive in protocol mode.** The loopback adapter retains its
one-time boot token and HttpOnly cookie while it exists; the protocol adapter
does not depend on custom-scheme cookies. Electron's docs say cookies are
disabled for non-standard schemes but do not promise complete cookie behavior
for standard custom schemes. Electron also has an open official issue reporting
custom-protocol cookie behavior even with `standard: true`
([electron/electron#27981](https://github.com/electron/electron/issues/27981)).
Exact Electron 42.4.1 cookie behavior is **unverified**, so cookies are excluded
from the security proof.

The protocol proof is:

- A handler exists only on the unique in-memory partition assigned to one view.
- Its closure supplies that partition identity and one expected sid.
- A request for another sid reaches the current partition's handler and fails
  `sid`/partition binding.
- A copied URL loaded from another view, app window, browser partition, or
  default session has either no handler or a handler bound to a different
  session and fails.
- Main validates `src` and partition before attach, permits one guest, binds its
  id after attach, and denies popups/navigation.
- User-authored content cannot create an Electron webview, choose a partition,
  access IPC, or install a handler.

An htmx extension that injects a secret header is rejected as the primary
design: it would not cover CSS/scripts/images or `.ndash`'s direct `fetch`, and
any JavaScript-visible secret would be readable by the deliberately scripting
capable dashboard. If Electron E2E cannot prove the partition binding above,
the permitted fallback is B. A possible defense-in-depth experiment is a
main-process, partition-scoped `webRequest` header added only to `neuron://view`
requests, never a value stored in HTML or JavaScript; its custom-protocol
coverage is currently **unverified** and it is not part of the decision.

No long-lived secret appears in user HTML, `.neuron`, logs, query strings,
settings, or URLs. The sid is an opaque routing id and is still checked as if it
were public.

## 7. Preserved security behavior

All three view kinds—`.nhtml`, `.ndash`, and `neuron.app`—use the same
dispatcher, session model, capability checks, manifest hash/approval, schema
validation, path policy, rate limits, and size/work ceilings. `.ndash` changes
only `script-src` by adding `'unsafe-inline'`; `connect-src` remains `'self'`.
`bypassCSP` and disabled web security are forbidden.

Workspace paths remain relative and reject absolute paths, drive letters, UNC,
`~`, null bytes, raw or encoded traversal, `..`, encoded separators,
double-decoding tricks, symlink/junction escapes, case-normalization bypasses,
and out-of-policy targets. The canonical root and deepest existing ancestor are
checked. Walkers do not follow links. Writes are atomic and require a base hash
or revision; conflicts are 409. Deletes have separate capabilities, explicit
confirmation, and conflict checks.

Runtime assets use an immutable registry:

```text
htmx-2.0.10 -> packaged app-owned htmx.min.js
neuron.css  -> app-owned theme asset
component id -> compile-time known app-owned CSS
```

The registry maps stable ids to known files/bytes. No part of a URL is appended
to a packaged filesystem directory. Workspace styles/assets are separate,
session-scoped registry entries created from the validated manifest and path
policy. CSS is size-capped; `@import`, remote/protocol-relative URLs, and
unregistered URLs are rejected.

The custom protocol is a request interface, not a privilege bridge. The view
still has no preload, Node, `ipcRenderer`, `process`, shell, raw filesystem,
network capability, or uncontrolled window. It cannot call the main renderer's
`electronAPI`.

Navigation hardening changes from a string-prefix origin test to parsed,
session-aware allowlists:

- main-frame navigation: only that session's `/document` (and same-document
  fragments if desired);
- subresources/XHR: only its canonical runtime, style, asset, and API routes;
- no other host, scheme, sid, port, credentials, or unrecognized path;
- all `window.open` denied; all permissions denied;
- `will-frame-navigate` covers subframes and rejects every frame route because
  CSP has `frame-src 'none'`;
- redirects are parsed and checked before following; dispatcher-generated
  redirects are internal and allowlisted only.

## 8. Request and response semantics

The internal contract is transport-neutral:

```ts
interface TransportRequest {
  requestId: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: URL;
  headers: ReadonlyHeaders;
  body: Uint8Array | null;
  binding: { transport: 'protocol' | 'loopback'; partition?: string; webContentsId?: number };
}

type ResponseBody =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'bytes'; bytes: Uint8Array };

interface TransportResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: ResponseBody;
  representation: 'json' | 'html-fragment' | 'document' | 'css' | 'javascript' | 'binary';
  mime: string;
  redirect: { denied: true; reason: string } | { internalPath: string } | null;
}
```

Adapters enforce request byte limits before dispatch. The protocol adapter reads
the `Request` body once and returns a `Response`; the HTTP adapter reads its
stream once and writes status/headers/body. Neither catches a domain exception
and exposes its message. Domain errors map to stable public codes.

`HX-Request: true` selects an HTML presenter only for routes with an HTML
contract; other callers get JSON. Safe fragments escape every untrusted value.
Security headers include CSP on documents, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and
`Vary: HX-Request` where applicable. Header names/values are allowlisted and
newline-free.

Responses never contain stack traces, absolute roots, tokens, partition names,
environment variables, process ids, raw exceptions, arbitrary filenames from
registry internals, or host platform details.

## 9. Naming

Use `route`, `capability`, `dispatcher`, `workspaceService`,
`fileContentService`, `directoryService`, `noteService`, `fragmentService`,
`runtimeAssetService`, `viewDocumentService`, `sessionBinding`, and
`pathPolicy`.

Do not introduce `fsFunction`, `callFs`, `rawFs`, `execute`, `operationName`,
`nodeMethod`, or other names that model the public platform as a wrapper around
Node `fs`. Public names describe Neuron product semantics.

## 10. Implementation and migration plan

Each phase is independently reviewable and retains one dispatcher.

1. **Extract dispatcher while loopback behavior is unchanged.** Add
   `src/main/htmx/request.ts`, `response.ts`, `dispatcher.ts`, `routes.ts`, and
   service modules under `src/main/htmx/services/`. Modify `server.ts`,
   `sessions.ts`, `html.ts`, and `tools/htmx-views.test.mjs`. Convert the live
   route assertions into dispatcher contract tests plus HTTP adapter tests.
   No protocol code yet.
2. **Protocol feasibility adapter and binding gate.** Add
   `src/main/htmx/protocol.ts`; modify `src/main/main.ts` to register scheme
   privileges before ready and `src/main/htmx/index.ts` to install a handler per
   in-memory partition. Harden `will-attach-webview`,
   `did-attach-webview`, `will-frame-navigate`, redirect, popup, permission, and
   partition-reuse checks. Add Electron E2E infrastructure/tests. Do not change
   the shipping default until the entire matrix passes.
3. **Runtime asset registry.** Add
   `src/main/htmx/services/runtimeAssetService.ts` and an explicit registry;
   modify `tools/copy-htmx.mjs` only if the stable packaged location must move,
   plus build/package tests. Keep assets app-owned and offline.
4. **View documents and workspace assets.** Move wrapping/CSP/URL generation
   into `viewDocumentService`; modify `html.ts`, `theme.ts`, `index.ts`, and
   session registry construction. Cover `.nhtml`, `.ndash`, `neuron.app`,
   auto-style, declared assets, interpolation, and legacy absolute URL alias.
5. **HTMX/API routes.** Move each current route through the dispatcher and
   named services. Add directory tree/list/count/stat and semantic note routes.
   Modify `manifest.ts` only for explicitly approved new note capabilities.
   No route lands without schema, cap, path, limit, JSON, HTML, and error tests.
6. **Migrate first-party authoring material.** Modify demo `.nhtml`, `.ndash`,
   `neuron.app`, `.neuron/templates`, relevant manifests, `docs/htmx-views.md`,
   `docs/custom-views.md`, and `skills/neuron-mini-apps/SKILL.md` to use
   `./api/v1/...`. Never rewrite user workspaces.
7. **Ship protocol; dev-flag loopback.** Production builds hard-disable the
   listener. Development may opt into loopback for adapter tests/manual
   debugging, but both transports call the same dispatcher. Add a packaged E2E
   assertion that no local TCP port listens in protocol mode. After a release
   proves rollback is unnecessary, removal of the dev adapter is a separate
   decision, not part of this migration.

## 11. Test plan and required trace

### Unit

- URL parsing/canonicalization, route matching, methods, compatibility alias,
  query repetition/encoding, malformed custom URLs, and unknown routes.
- HTTP and Electron normalization to identical `TransportRequest` fixtures.
- `TransportResponse` serialization, MIME, `Vary`, CSP, `HX-*`, security
  headers, byte/text bodies, unsupported headers, and redirect denial.
- Session lookup, expiry/revocation, manifest hash, cross-session sid,
  partition mismatch, webContents mismatch/presence coverage, and duplicate
  partition/attach rejection.
- Immutable runtime asset registry, unknown ids, MIME, packaged path
  confinement, workspace asset ids, CSS policy, and size limits.
- Existing path policy plus encoded/double-encoded traversal, symlink/junction,
  case, UNC/drive/home/null/absolute, non-existing ancestors, and policy edges.
- Every capability, new note-cap separation, schema unknown keys, body limits,
  rate limits, walk/search limits, atomic writes, conflicts, and delete
  confirmation.
- JSON/HTML representation, escaping, error fragments, and absence of sensitive
  strings in every error class.

### Integration against the shared dispatcher

- Document, htmx runtime, Neuron CSS, component CSS, view style, and declared
  asset load for all three view kinds.
- GET/POST/PUT/DELETE normalization, forms, JSON, query strings, `HX-Request`,
  HTML vs JSON, and safe 403/404/409/429 behavior.
- Fragment swaps, newly inserted htmx controls, error events/targets, internal
  redirect headers, blocked redirects, and reload-on-save revocation.
- Run the same dispatcher contract through protocol and development HTTP
  adapters; assert equivalent status, headers, and body for transport-neutral
  cases.

### Electron E2E security gate

- No Node, preload, `ipcRenderer`, `process`, shell, raw filesystem, or permission
  access from `.nhtml`, `.ndash`, or `neuron.app`.
- No navigation outside exact session routes, subframes, popups, downloads,
  service workers, remote network, local services, websocket, beacon, or
  protocol escape.
- Another view's sid, a copied URL in another view/window/partition, duplicate
  partition attachment, and stale/revoked URLs all fail.
- `neuron://fs`, `neuron://file`, malformed/encoded URLs, unknown runtime ids,
  and registry path tricks never reach a filesystem service.
- **No local TCP listener in protocol mode.** DNS rebinding and Host-header
  attacks become inapplicable because no HTTP server exists; the dev adapter
  still rejects them when explicitly enabled.
- CSP remains enforced without `bypassCSP`; `.ndash` gains only inline script
  and still cannot exfiltrate.
- Instrument requests by resource type and prove partition and, where Electron
  supplies it, webContents binding. Record any missing `webContentsId` coverage.
- Run in development and a packaged build on Windows, macOS, and Linux because
  custom-scheme Chromium behavior is the central migration risk.

### Required end-to-end trace

For:

```html
<section hx-get="./api/v1/context" hx-trigger="load">Loading…</section>
```

1. Chromium resolves the standard relative URL from
   `neuron://view/<sid>/document` to
   `neuron://view/<sid>/api/v1/context`.
2. htmx 2 sends GET with `HX-Request: true`.
3. The handler installed on that view's in-memory Electron `Session` converts
   the `Request` to `TransportRequest` and supplies its partition binding.
4. The dispatcher parses the sid, finds a live record, requires matching
   partition and bound webContents where available, rate-limits, matches
   `GET context`, and rejects a body.
5. `context` requires no extra capability but returns only the session's safe
   view/workspace name, theme, API version, and sorted granted capabilities.
6. The HTML presenter escapes values and returns a context fragment with 200,
   HTML MIME, `Vary: HX-Request`, no-store, nosniff, and no internal paths.
7. The protocol adapter creates the Electron `Response`; htmx swaps the fragment
   into the section.
8. The test repeats the copied URL from another partition and asserts
   `binding_mismatch`/failure with no context data.

## 12. Risks, rollback, and limitations

### Principal risks

1. **Partition identity is the authentication boundary in protocol mode.**
   Electron documents session-scoped handlers, but complete webContents-id
   visibility for custom-scheme subresources/XHR is unverified. The E2E proof is
   the release gate; failure selects B.
2. **Chromium custom-scheme behavior can differ from HTTP at edges** despite the
   Request/Response API: native forms, redirects, CORS classification, response
   header exposure, cookies, and CSP must be measured on all platforms.
3. **Legacy authoring uses `/api/v1/...`.** Without the bounded adapter alias,
   existing views resolve outside their sid path. First-party files migrate,
   user files are never rewritten, and rollback keeps the old transport.
4. **Service extraction can change semantics.** Route-by-route golden contract
   tests must be green before the protocol adapter is added. In particular,
   note writes cannot remain raw file writes.
5. **`<webview>` is itself a documented Electron stability risk.** This decision
   preserves it; moving to `WebContentsView` or another host is separate work.

Rollback is a release/configuration change, not a workspace conversion:

- Keep the shared dispatcher and reselect the loopback adapter.
- Re-enable boot-token + HttpOnly/SameSite cookie authentication, exact Host and
  Origin validation, ephemeral `127.0.0.1`, and the existing isolated
  partitions.
- Keep relative authoring: `./api/v1/...` also resolves correctly under a
  loopback document at `/views/<sid>/document`.
- Do not revert extracted services, route schemas, semantic naming, or tests.
- Revoke all protocol sessions during the switch; never carry protocol binding
  state into HTTP sessions.

### Current concerns observed but not changed

- `src/main/main.ts` pins a view with string
  `url.startsWith(origin)`. Security navigation checks should compare parsed
  scheme, hostname, port, and route, not a string prefix.
- `apiFragment` in `server.ts` loads and interpolates variables even when the
  session lacks `variables.read`; document interpolation correctly checks that
  capability. The dispatcher extraction must close this inconsistency.
- Current note/search/tag routes read workspace files directly rather than
  using editor/index services, and file routes can mutate a note as generic
  content. The target semantic split is required to avoid dirty-state and
  conflict bugs.
- Current browser tests assert returned error fragments but do not prove that
  htmx displays them; htmx 2 does not swap 4xx by default.

No item above was modified by T-008.

## Verification status and open facts

The Electron API signatures, registration timing, standard relative-resource
behavior, Request/Response model, per-session handler rule, partition
persistence semantics, and privilege names/defaults were verified against the
official `v42.4.1` source linked above.

The following remain explicitly unverified until implementation E2E:

- Electron 42.4.1 custom-scheme cookie behavior; the design does not rely on it.
- Exact custom-scheme XHR/native-form behavior for every method, body, header,
  status, and redirect case.
- Whether session `webRequest` supplies `webContentsId` for every custom-scheme
  document, runtime asset, stylesheet, XHR, and fetch request.
- The precise Chromium consequences of `secure` and `corsEnabled: false` beyond
  Electron's documented privilege labels.
- Cross-platform and packaged-app equivalence.

Those are gates, not assumptions. None justifies `bypassCSP`, a generic
filesystem protocol, a token in authored content, or a second authorization
implementation.
