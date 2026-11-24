# Threat model: Neuron desktop

**Method:** STRIDE, plus attack scenarios
**Reviewed:** `dev` at `3a5917b`, plus the Electron Fuses change
**Scope:** Electron processes, IPC, the filesystem, HTML views, the in-app browser, the network

## Assets

1. **Files outside the workspace:** SSH keys, browser profiles, documents.
2. **Workspace content:** notes, canvases, tables and databases, and the write journal (version history).
3. **Credentials:**
   - AI provider API keys, encrypted with `safeStorage`: DPAPI on Windows, Keychain on macOS, libsecret or kwallet on Linux.
   - Cookies in the in-app browser's `persist:neuron-browser` session, including any imported from Chrome.
4. **The machine:** CPU, memory, terminal shells, network access.
5. **The app itself:** the executable, `app.asar` and update downloads.

## Attackers

- **Document author:** sends crafted Markdown or MDX, canvases or HTML views through a shared repository or cloud sync.
- **Web origin:** a page in the in-app browser, or any site probing the loopback view server.
- **Local process:** an unprivileged process on the same machine, racing filesystem operations or launching the executable with a hostile environment.
- **Dependency:** a compromised npm package.

## Trust boundaries

| | Boundary |
| --- | --- |
| TB-1 | Web content in the in-app browser `<webview>` vs. the app |
| TB-2 | HTML views (loopback server, own partition) vs. the app |
| TB-3 | Renderer page vs. the preload bridge |
| TB-4 | Renderer vs. main process (IPC) |
| TB-5 | Main process vs. the operating system |

## STRIDE

| Category | Threat | Control |
| :--- | :--- | :--- |
| Spoofing | A subframe or webview sends IPC as if it were the app | `entryOf` accepts only the main frame of Neuron's own windows |
| Tampering | A folder is swapped for a link between the path check and the write | Handle-based I/O with a post-open `dev`/`ino` check (`safe-fs`). The path-based rename/unlink/trash window is residual. |
| Tampering | Loose app code next to, or instead of, `app.asar` | Fuses: `OnlyLoadAppFromAsar`, plus ASAR integrity validation on Windows and macOS |
| Tampering | `NODE_OPTIONS` or `--inspect` used to inject code into the main process | Fuses: both disabled in packaged builds |
| Repudiation | An edit or delete leaves no trace | The write journal captures a pre-image before each overwrite or delete (decision D19 in the project's decision log). It is kept in the app's data folder, outside the workspace. |
| Information disclosure | Renderer or plugin code reads API keys | Write-only secret store: `settings:get` never returns `__secrets` and redacts keys; `ai:complete` reads keys in main |
| Information disclosure | An HTML view reads version history | The journal is main-process only and is never reachable from the view API (decision D20) |
| Information disclosure | Cookies read from disk by another process | Fuse: `EnableCookieEncryption` |
| Denial of service | A huge response, or a locked file, freezes the app | 10 MB caps and a 60 s deadline on plugin requests; save retries wait on a timer instead of blocking |
| Elevation of privilege | Renderer code reaches Node.js | `sandbox`, `contextIsolation`, no `nodeIntegration`; webview preloads stripped |

## Scenarios

### A. Malicious repository
**Attack:** links pointing outside the workspace, a hostile `.neuron/layout.json`, or scripts dressed up as notes.
**Controls:**
- `resolveInRepo` checks that a path stays inside the workspace, both lexically and after resolving to its real path.
- `openSafe` refuses a handle whose identity does not match the checked path.
- The workspace walk skips links that resolve outside the workspace, and links to folders. A link to a file inside the workspace is listed.
- `fileKind` classes programs and scripts as `blocked`. `notes:read` and `notes:write` refuse them, and they are never opened or renamed by Neuron.

**Tests:** `tools/safe-fs.test.mjs`, `tools/workspace-walk.test.mjs`, `tools/file-kinds.test.mjs`.

### B. Crafted Markdown, MDX or canvas
**Attack:** `javascript:` links, raw `<script>` or event handlers, hostile SVGs, malformed canvas JSON.
**Controls:**
- The MDX preview neutralises `javascript:`, `vbscript:` and `data:text/html` links and does not render raw HTML.
- Component props are checked against fixed token sets.
- SVGs served over `neuron-file://` carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and `nosniff`.

**Tests:** `tools/mdx-security.test.mjs`, `tools/canvas-model.test.mjs`, `tools/file-kinds.test.mjs`.

### C. Hostile HTML view
**Attack:** a view tries to read or write files it should not, run commands or exfiltrate notes.
**Controls:**
- A view runs only after the user approves it for an exact content hash. Any change asks again and revokes the running session.
- File access needs manifest capabilities and is limited to the manifest's path globs.
- The view server is loopback-only and checks `Host` and `Origin`.
- Popups are denied, and navigation is pinned to the view server.

**Tests:** `tools/htmx-views.test.mjs`.

### D. Compromised renderer
**Attack:** script injected into the renderer calls the bridge or tries to reach Node.js.
**Controls:**
- The sandbox and context isolation keep Node.js out of reach.
- The bridge exposes fixed functions only.
- Main re-validates every argument.

**Limit:** a compromised renderer can do anything the bridge allows: read and write workspace files, and type into terminals. Plugins share this position, because they are not sandboxed.

**Tests:** `tools/main-guards.test.mjs`, `tools/settings-schema.test.mjs`.

### E. Local filesystem race
**Attack:** a local process swaps folders for links during a save or rename.
**Controls:**
- Bytes move only through identity-checked handles.
- Saves are atomic (temp file, `fsync`, rename), and a version changed outside Neuron is refused.

**Residual:** rename, unlink and trash take paths. A swap in the instant before the call is followed. The owner accepted this window (D43.2); see `src/main/safe-fs.ts`.

**Tests:** `tools/safe-fs.test.mjs`, `tools/save-file.test.mjs`.

### F. Web page attacking local services
**Attack:** a site, in a normal browser or the in-app one, probes the view server or tries to read `neuron-file://`.
**Controls:**
- The view server rejects a non-matching `Host`, which defeats DNS rebinding, and rejects foreign `Origin`s.
- Documents need a one-time boot token, then an `HttpOnly; SameSite=Strict` session cookie.
- `neuron-file://` needs the window's random token, compared in constant time. Fetch and CORS are disabled for the scheme.

**Tests:** `tools/htmx-views.test.mjs`, `tools/file-kinds.test.mjs`.

### G. Local process abusing the executable
**Attack:** launch Neuron's signed executable with `NODE_OPTIONS`, `--inspect` or `ELECTRON_RUN_AS_NODE` to run code under its identity.
**Controls:**
- Fuses disable `NODE_OPTIONS` and `--inspect`. On a packaged Windows build both were ignored and the app started normally.

**Residual:** `ELECTRON_RUN_AS_NODE` is still honoured. The `RunAsNode` fuse stays on because node-pty's Windows terminal kill needs `child_process.fork()`. Turning it off needs a terminal backend that does not fork; node-pty's `useConptyDll` path is one.

### H. Compromised dependency
**Controls:**
- Weekly and per-change scans: OSV-Scanner, CodeQL, Semgrep and Gitleaks.
- The production CSP has no `unsafe-eval`.
- `npm test` includes `test:deps`, which checks that every main-process import is a declared dependency.

**Limit:** none of these stops malicious code inside a dependency that is already trusted.

### I. Prompt injection through documents
**Attack:** a note instructs an AI model to do something harmful.
**Controls:**
- `ai:complete` returns text only. It runs no tools and changes no files.
- Run buttons and terminal commands need a user click.
- Keys stay in main and are scrubbed from errors.

### J. Tampered update
**Controls:**
- electron-updater downloads from GitHub Releases over HTTPS and checks the SHA-512 in `latest*.yml`.
- `src/main/updater.ts` does not offer updates to Microsoft Store builds, which the Store updates, or to macOS builds without a real code signature, which Squirrel.Mac cannot install.

**Tests:** `tools/updater.test.mjs`.
