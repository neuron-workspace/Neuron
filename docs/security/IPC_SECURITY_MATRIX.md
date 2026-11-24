# IPC security matrix: Neuron desktop

**Reviewed:** `dev` at `3a5917b`
**Scope:** every channel the renderer can call in main: 48 in all. 47 are `ipcMain.handle` channels; `workspace:file-base` is a synchronous `ipcMain.on`. Most are registered in `src/main/main.ts`, and the five `htmx-views:*` channels in `src/main/htmx/index.ts`. Messages from main to the renderer (`terminal:data`, `settings:changed` and so on) are not listed.

## Principles

1. **Sender.** Every channel checks `entryOf(event)`, directly or through a helper built on it:
   - `windowOf` gives the sender's window.
   - `repoOf` gives the window's workspace. The `htmx-views:*` channels receive it as `getRepoRoot`.
   - `resolveInRepo` gives a path inside the workspace that is a real path, with no link outside it.

   A sender that is not the top-level frame of a Neuron window gets nothing, or a failure result.
2. **Preload.** `src/main/preload.ts` exposes one function per channel on `window.electronAPI`. `ipcRenderer` itself is never exposed.
3. **Validation in main.** Arguments are type-checked in the handler, whatever the renderer already checked.
4. **Tests.** `tools/main-guards.test.mjs` names all 48 channels and asserts their sender and argument guards. Feature suites such as `htmx-views`, `secret-storage`, `settings-schema`, `public-network`, `safe-fs`, `save-file` and `journal` test what the channels do.

## Channels

| Channel | Sender check | Input checks | Effect | Notable controls |
| :--- | :--- | :--- | :--- | :--- |
| `window:chrome-state` | `windowOf` | none | none | Returns `{ fullScreen }` |
| `window:toggle-fullscreen` | `windowOf` | none | Toggles full screen | Sender's own window only |
| `window:open-page` | `entryOf` | Section name against a fixed list | Opens or focuses Settings | Unknown sections refused |
| `window:opener-workspace` | `entryOf`, Settings window only | none | none | Name and folder of the opener, while still open |
| `window:set-overlay-colors` | `windowOf` | Plain object, `#rrggbb` colours | Title-bar overlay colours | Windows and Linux only |
| `settings:get` | `entryOf` | Key not `__proto__`/`constructor`/`prototype` | Reads `settings.json` | `__secrets` never returned; API keys redacted |
| `settings:set` | `entryOf` | Per-key schema and byte limit (`settings-schema.ts`) | Writes `settings.json` | Reserved keys (`__secrets`, view trust) refused; any `apiKey` refused |
| `settings:set-secret` | `entryOf` | Scope and field names, string value | Writes encrypted value | `safeStorage`; refuses Linux `basic_text` |
| `settings:has-secret` | `entryOf` | Scope and field names | none | Answers from the stored shape, never decrypts |
| `repository:get-current` | `repoOf` | none | none | Name and path of the window's workspace |
| `repository:list-recent` | `entryOf` | none | Reads settings | Install folder filtered out; missing folders marked |
| `repository:create` | `windowOf` | Native folder picker | Seeds a welcome note, opens the folder | Install folder refused |
| `repository:open` | `windowOf` | Native folder picker | Opens the folder | Install folder refused |
| `repository:switch` | `entryOf` | String, existing directory | Opens the folder | Install folder refused |
| `repository:set-name` | `entryOf` | String folder and name | Writes settings | |
| `repository:remove` | `entryOf` | String folder | Removes from recents | Deletes nothing on disk |
| `repository:reveal` | `entryOf` | String folder | `shell.showItemInFolder` | Folder must be known (current, recent or open) and exist |
| `templates:list` | `entryOf` | none | Reads bundled templates | Read-only |
| `templates:create` | `windowOf` | Known template id, folder picker | Copies a template into the chosen folder | Refuses a folder that already has notes, and the install folder |
| `notes:list` | `repoOf` | none | Walks the workspace | Dot-folders skipped (except `.neuron`); links outside the workspace skipped |
| `workspace:entries` | `repoOf` | none | Walks the workspace, sniffs unknown files | Entry limit; at most 2,000 files sniffed |
| `workspace:file-base` (`on`) | `entryOf`, workspace windows only | none | none | Returns the window's tokenised `neuron-file://` base |
| `workspace:reveal` | `resolveInRepo` | Relative path | `shell.showItemInFolder` | Shows the file; never opens it |
| `notes:read` | `resolveInRepo` | Relative path, file kind | Reads a file | `openSafe`; programs and media refused; 25 MB note limit; text files over 5 MB open read-only |
| `notes:write` | `resolveInRepo` | Relative path, string, optional 64-hex base hash | Atomic write | Journal pre-image; conflict if changed outside Neuron; size limits; per-file queue |
| `notes:delete` | `resolveInRepo` | Relative path | Unlinks a file | Journal pre-image; folders refused |
| `workspace:rename` | `resolveInRepo` (both paths) | Two relative paths | Renames or moves | No overwrite; not into itself; links and programs refused |
| `notes:write-links` | `repoOf`, `resolveInRepo` per file | Array of `{ path, content }`, at most 10,000 | Rewrites links in notes | `.md`/`.mdx` only; 25 MB each; journalled |
| `journal:list` | `repoOf` | Optional relative path | Reads the write journal | Main-process only; not reachable from views |
| `journal:restore` | `repoOf` | Entry id string | Restores a pre-image | Writes through `safe-fs` |
| `notes:create-section` | `resolveInRepo` | Relative path | Creates a folder | Path resolved inside the workspace (plain `mkdirSync`, not `mkdirSafeSync`) |
| `notes:get-dir` | `repoOf` | none | none | Path of the window's workspace |
| `cookies:import-chrome` | `entryOf` | Hostname (`normalizeCookieDomain`) | Imports cookies into `persist:neuron-browser` | Windows only; DPAPI key; AES-256-GCM with a full 16-byte tag |
| `terminal:spawn` | `entryOf` | Integer `cols`/`rows`, string key | Starts a shell (node-pty) | Starts in the workspace folder; keyed per window |
| `terminal:history` | `entryOf` + `ownsPty` | PTY id | Returns scrollback | Own terminals only |
| `terminal:write` | `entryOf` + `ownsPty` | PTY id, string | Writes to the shell | Own terminals only |
| `terminal:resize` | `entryOf` + `ownsPty` | Integer id, cols, rows | Resizes | Own terminals only |
| `terminal:windows-pty` | `entryOf` | none | none | Windows build number for xterm's ConPTY mode |
| `terminal:kill` | `entryOf` + `ownsPty` | PTY id | Ends the shell | Own terminals only |
| `ai:complete` | `entryOf` | Plain object; known provider; string model/system; `user`/`assistant` messages | Calls the provider | Key and endpoint read in main; key scrubbed from errors |
| `plugin:net-request` | `entryOf` | Plain object; string url, method, body; string headers | Outbound HTTP(S) | Public addresses only, DNS-pinned, 10 MB caps, 30 s idle / 60 s total, 5 redirects |
| `notes:log-error` | `entryOf` | Four string fields | Appends to the local diagnostic log | Local only |
| `diagnostics:open-logs` | `entryOf` | none | `shell.openPath` on the app's log folder | Fixed folder |
| `htmx-views:open` | `repoOf` | View path, `light`/`dark` | Starts a view session | Must be approved for its current content hash; one-time boot token |
| `htmx-views:approve` | `repoOf` | View path, 64-hex hash | Stores approval | Hash must match the files now |
| `htmx-views:close` | `repoOf` | Session id | Revokes the session | Session must belong to the window's workspace |
| `htmx-views:reset-approval` | `repoOf` | View path | Deletes approval, revokes session | |
| `htmx-views:list-trusted` | `repoOf` | none | Reads approvals | Current workspace only |

## Highest-risk channels

- **`terminal:write`** runs whatever it is sent in a shell. It is limited to the sending window's own terminals. Run buttons pass commands through `isRunnableCommand()`, which refuses newlines, control, zero-width and bidi characters, and the command is typed into the visible terminal.
- **`notes:write`** can destroy data. It resolves the path inside the workspace, writes through handles whose identity is checked (`safe-fs`), captures a pre-image in the journal first, and refuses to overwrite a version that changed outside Neuron.
- **`plugin:net-request`** is the SSRF surface. It allows public addresses only, pins DNS, caps body size and time, and limits redirects.
