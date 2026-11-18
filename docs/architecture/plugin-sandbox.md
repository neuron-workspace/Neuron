# Sandboxed third-party plugins (removed)

Workspace apps, folders under `plugins/` or elsewhere that held an `index.html`
and a `neuron.app.json`, were removed in favour of plain `.html` views. An old
app folder is now an ordinary folder and its files are listed like any other.

A custom HTML view does the same job, with the same isolation: no Node, no
preload bridge, no network, and only the capabilities its manifest asks for and
you approve. See [htmx-views.md](../htmx-views.md) for the view format,
permissions and threat model. The demo workspace's `Snake.html` is a view that
needs no permissions and therefore has no manifest.

Built-in plugins remain first-party renderer code, enabled per workspace.
