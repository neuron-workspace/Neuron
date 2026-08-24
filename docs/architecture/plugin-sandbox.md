# Sandboxed third-party plugins

Status: accepted design and minimal workspace implementation for T-030.

## Decision

A third-party plugin is a workspace folder containing a plain HTML entry point:

```text
plugins/
  <plugin-folder>/
    index.html
    neuron.app.json
```

The `plugins/` location is the discovery convention used by the Plugins page.
The folder itself is an existing Neuron folder mini-app: `index.html` is the
entry, and the co-located `neuron.app.json` is exactly the existing view
manifest. There is no plugin-only manifest, loader, JavaScript module format,
or second sandbox. A folder mini-app outside `plugins/` remains a normal view
and is not listed as an installed plugin.

The manifest accepts the existing view fields and validation rules:

```json
{
  "id": "example.recent-notes",
  "name": "Recent notes",
  "version": "1.0.0",
  "description": "Shows recently edited notes.",
  "permissions": ["notes.read"],
  "allowedReadPaths": ["**/*.md", "**/*.mdx"],
  "allowedWritePaths": [],
  "networkPolicy": "none",
  "themeMode": "system"
}
```

`id`, `name`, `version`, `description`, `icon`, and `themeMode` are optional in
the view format. `index.html`, `permissions`, path policies, and
`networkPolicy: "none"` define the security-relevant behavior. Unknown fields
and unknown permissions are rejected by the existing validator. The Plugins
page may display manifest metadata, but it treats it as an untrusted claim: the
workspace-relative entry path is shown as the stable identity, and opening the
entry makes the main process validate and hash the manifest again.

## Execution boundary

Opening a listed plugin uses the ordinary HTML surface. The main process creates
a capability-scoped session and serves the document to a sandboxed webview with:

- no Node, preload, `ipcRenderer`, or `process`;
- a per-session, in-memory webview partition;
- `default-src 'none'`, `connect-src 'self'`, and no remote images, frames,
  objects, forms, scripts, or styles;
- only the loopback view API at the session's own origin;
- a checked capability on every API route and the existing path policy on file
  and note enumeration, reads, writes, creates, deletes, and searches;
- resource ceilings and hash-based conflict checks already used by views.

Inline scripts are allowed under D31. That does not widen their authority:
scripts still have no Electron bridge and cannot connect away from the local
view origin. This design must not add a blanket filesystem grant, widen
`connect-src`, bypass the path policy, or expose a built-in runtime object to the
webview.

The trusted Plugins page uses the existing app bridge only to select the
plugin's `index.html`. It does not activate the folder in the built-in plugin
host and passes no `HostRuntime` into the webview.

## Available capabilities

Sandboxed plugins may request only the existing view capabilities:

| Capability | Access added |
| --- | --- |
| `workspace.files.read` | Read one allowed workspace file through the content API. |
| `workspace.directories.list` | Enumerate files allowed by the read path policy. |
| `workspace.search` | Search allowed Markdown and MDX files. |
| `notes.read` | Read note titles, tags, paths, modification times, and the note content needed to derive that metadata, within the read policy. |
| `tags.read` | Derive tags from notes within the read policy. |
| `variables.read` | Read declared values from `.neuron/variables.json`. |
| `workspace.files.write` | Replace an existing file in the write policy, with conflict checking and journaling. |
| `workspace.files.create` | Create a file in the write policy. |
| `workspace.files.delete` | Delete a file in the write policy, with journaling. |
| `variables.write` | Update only variables declared writable. |

No new capability is needed. The APIs already cover the file, note, tag,
search, and variable operations a sandboxed HTML app can perform. Capabilities
remain independent: `notes.read` does not imply search, and read does not imply
write. `allowedReadPaths` and `allowedWritePaths` narrow the relevant routes;
authors should always declare explicit least-privilege patterns. In the current
view implementation an omitted or empty read pattern list falls back to `**`,
so an app requesting a read-like capability must not rely on omission as a
restriction.

There is deliberately no grant for arbitrary network access, Electron IPC,
settings, the recovery journal, host storage, browser cookies, AI provider
credentials, or PTY/terminal execution. Those are qualitatively greater powers,
not alternate spellings of a file or view operation.

## Installation, approval, and uninstall

Neuron does not establish provenance. A plugin folder may come from a stranger,
a downloaded archive, Git, shared storage, or the user. The minimal install is
an explicit filesystem action: the user copies the folder to
`<workspace>/plugins/<plugin-folder>/`. There is no marketplace, downloader,
signature, package execution, install script, or global plugin directory.

The Plugins page reads JSON metadata to list folders that have both
`neuron.app.json` and `index.html`; listing does not load or execute the HTML.
Before opening, the row shows the real workspace-relative entry path and the
requested capability names. Manifest names and descriptions are author claims,
not trust signals.

On open, the main process validates the manifest. A plugin requesting any
capability does not receive a webview session yet. The existing prompt names the
real entry path (`“plugins/<folder>/index.html” requests workspace access`),
describes each requested capability, warns the user to trust the file and its
source, and offers `Allow once` or `Allow for this view`. The prompt wording is
part of the security boundary: it must continue to name the path and concrete
authority, never just the self-declared plugin name or a vague “safe” badge.
The approval is bound to the exact manifest hash, so any manifest edit asks
again. A once approval lives only in the current Neuron process; an always
approval is stored per workspace and entry path.

If the user refuses by closing or leaving the prompt, no session or webview is
created, so plugin HTML and scripts do not run and no capability is granted. A
zero-capability plugin opens after the user presses `Open isolated app` without
a second prompt; it can render and run sandboxed script but cannot read the
workspace or reach Node or the network.

The current minimal path has no uninstall button. Removing the plugin folder is
the uninstall operation and removes its executable HTML and manifest. Any
stored approval becomes inert because the entry no longer exists;
it cannot authorize another manifest hash. A future uninstall action should
first call the existing `htmxViews.resetApproval(entry)` operation and then
remove the folder, so the inert approval is removed as well. It must show the
exact folder it will delete and must not delete data outside that folder.

## Functional cost versus built-ins

This boundary is a real product trade-off. A built-in plugin is trusted React
code running in the renderer. It can register native side or bottom panels,
commands, and MDX components; share shell components and state; react directly
to the active note; open or create notes; use namespaced settings storage; and
reach the privileged AI, network, and terminal bridges.

A sandboxed plugin renders one HTML app in a webview. It cannot contribute a
React panel, command-palette action, MDX component, toolbar control, native drag
target, or shell-level keyboard shortcut. It does not receive live renderer
state or component-library objects, and its focus, accessibility tree, styling,
and lifecycle cross a webview boundary. It can approximate some workflows with
the view API and Neuron's injected HTML styles, but it will not feel as tightly
integrated and cannot perform tasks for which no least-privilege view API exists.
That loss is intentional. Revisit SES only if untrusted code must render native
React UI inside the main renderer, as D33 specifies.

## What remains first-party

Built-in plugins remain first-party, in-renderer modules. In particular, AI
providers and the terminal remain first-party. AI credentials and provider
bridges must not be exposed to sandboxed plugins. The terminal can execute
arbitrary commands in the workspace and therefore cannot be represented as a
sandbox capability. Neither privilege is available indirectly through the view
API.

## Worked example

`examples/demo-repo/Snake/` is a folder app on this path. Its manifest requests
only `variables.read` and `variables.write`, with both `allowedReadPaths` and
`allowedWritePaths` empty, so a document running arbitrary JavaScript in the
sandbox cannot reach a single note -- the one thing it persists is a high score
in a declared workspace variable. It requests no file, search, tag, terminal, AI
or network authority and contains no remote asset.

Neuron discovers the folder from its `neuron.app.json` and opens
`Snake/index.html`. The standard HTML surface then owns approval, session
creation, rendering, and teardown. No main-process change is required for this
minimal path.

The demo workspace previously carried a `plugins/recent-notes/` example on the
same path; it was removed when the workspace was made generic, and Snake covers
the same ground with a tighter manifest.

## Explicit non-solutions and follow-up work

This design contains third-party plugin code; it does not make every extension
surface trusted or harmless:

- Built-in plugins are still unsandboxed first-party renderer code. Auditing and
  narrowing that host remains T-021 work.
- The PTY still starts a real shell with the workspace as its current directory
  and inherits the full process environment. This design does not contain it.
- An approved plugin can intentionally or accidentally read or mutate everything
  covered by its grants and path patterns. The journal improves recovery but is
  not authorization and is never exposed to the plugin.
- There is no signature, publisher identity, update mechanism, vulnerability
  revocation, marketplace review, dependency scan, or safe archive extraction.
- This reuses the Chromium/webview boundary; it does not defend against a
  Chromium or Electron sandbox escape.
- The Plugins page performs lightweight workspace discovery. A production
  installer/uninstaller would require a separate main-process task for validated
  archive extraction or folder import, collision handling, atomic installation,
  approval cleanup, and recoverable deletion. That task must preserve the same
  manifest validator and view sandbox rather than introduce a second loader.

Therefore T-030 supplies a sandboxed path for untrusted third-party HTML apps,
but it does not close the broader T-021 risk around privileged built-ins and the
PTY.
