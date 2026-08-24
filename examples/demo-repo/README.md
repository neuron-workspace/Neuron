# Demo workspace

A ready-made Neuron workspace that demonstrates every feature. It opens automatically the first time you launch the app.

## How to open it

1. Launch Neuron (`npm run dev`) — on first run this workspace opens for you.
2. To reopen it later, use the **Workspaces** page or the workspace switcher in the title bar.
3. The folder lives at `examples/demo-repo`.

Then start at **getting-started** in the sidebar and follow the links.

## Layout

| Folder | Holds |
| --- | --- |
| guides/ | How Neuron works — start with getting-started at the root, then follow its links |
| projects/ | Project notes with frontmatter, matching the projects in `Planner.db` |
| daily/ | A dated journal entry |
| properties/ | Frontmatter examples, including one with deliberately invalid YAML |
| plugins/ | A least-privilege HTML plugin |
| .neuron/ | Workspace config: layout, variables, view manifests, templates, fragments |

## The showcase files

| File | Shows |
| --- | --- |
| getting-started.mdx | The hub — links, tags, a callout, a badge |
| Dashboard.mdx | Layout components, `DbView`, and `Run` buttons wired to the terminal |
| Custom dashboard.html | A scripted HTML view: computed metrics, a status board, quick capture |
| Planner.db | A multi-table database with table, board, and card layouts |
| Idea board.canvas | A JSON Canvas spatial board with groups and labelled connections |
| Snake/ | A folder mini-app — a game that asks for two capabilities and no file access |
| Launch board/ | A folder mini-app built on htmx, with no JavaScript of its own |

## The guides

| Note | Shows |
| --- | --- |
| guides/markdown-basics | Headings, lists, quotes, code blocks, inline styles |
| guides/mdx-components | The live `Badge` and `Callout` components |
| guides/building-htmx-views | The API routes, `.neuron` layout, and permission model |
| guides/wikilinks-and-tags | `[[wikilinks]]`, the graph, and `#tags` |
| guides/sections-and-workspaces | Folders, nesting, and workspaces |
| guides/plugins-and-ai | Enabling Claude, a local model, and Daily Notes |
| guides/monitoring-runbook | A small runbook the daily note works through |

## Try these

- Open **Snake/** — it renders as one app, not a file listing, because the folder holds a `neuron.app.json`. Its high score is the only thing it can write.
- Open **Dashboard.mdx** and press a **Run** button — the command runs in the workspace terminal, and the button shows you exactly what it will run before you click.
- Open **Custom dashboard.html** — it renders in an isolated view tab; use the Source toggle to edit its HTML.
- Open **Idea board.canvas** — Shift-drag to multi-select, right-click for align/z-order/arrows, Ctrl+Z to undo; cards render Markdown.
- Press **Ctrl/Cmd + K** and run **New HTMX view in current folder** to create an `.html` view.
- Click a `#tag` at the bottom of the sidebar to filter.
- Open **Integrations & Plugins** at the bottom of the sidebar and enable a plugin — its panel appears on the right.
