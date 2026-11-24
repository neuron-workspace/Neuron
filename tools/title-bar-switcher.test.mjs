// Run: node tools/title-bar-switcher.test.mjs
// R1: a workspace shown as "Folder not found" in the title-bar switcher can be
// removed from the list there, through the welcome page's removal
// (useWorkspaceActions: repository.remove, then the list is read again). The
// real RecentWorkspaceItems from TitleBar.tsx, in an open menu, rendered with
// react-dom on a linkedom document against a fake bridge.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

const root = process.cwd();
const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The menu's layers dispatch their own events on the document: they must be the document's kind.
for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'SVGElement',
  'Node', 'Element', 'Text', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver']) {
  if (window[name]) globalThis[name] = window[name];
}
globalThis.NodeFilter ??= window.NodeFilter ?? { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
window.getComputedStyle ??= globalThis.getComputedStyle;
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver ??= globalThis.ResizeObserver;

const removed = [];
window.electronAPI = { platform: 'linux', repository: { remove: async (dir) => { removed.push(dir); return { success: true }; } } };

const outfile = path.join(root, 'tools/.title-bar-switcher.tmp.cjs');
await build({
  stdin: { contents: `export { RecentWorkspaceItems } from './src/renderer/components/TitleBar';\nexport { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './src/renderer/components/ui/dropdown-menu';`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', outfile, logLevel: 'silent', tsconfig: path.join(root, 'tsconfig.json'),
});
let ui;
try { ui = createRequire(import.meta.url)(outfile); } finally { rmSync(outfile, { force: true }); }
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const h = React.createElement;

const recents = [
  { path: '/work/notes', name: 'notes', missing: false },
  { path: '/gone/old', name: 'old', missing: true },
];
let reloads = 0;
const switched = [];
const container = document.createElement('div');
document.body.appendChild(container);
const rootNode = createRoot(container);
await act(async () => {
  rootNode.render(h(ui.DropdownMenu, { open: true, onOpenChange: () => {} },
    h(ui.DropdownMenuTrigger, null, 'Workspace'),
    h(ui.DropdownMenuContent, null, h(ui.RecentWorkspaceItems, { recents, onSwitch: (dir) => switched.push(dir), onReload: () => { reloads++; } }))));
});
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
await settle();

const items = [...document.querySelectorAll('[data-remove-missing]')];
assert.deepEqual(items.map((item) => item.getAttribute('data-remove-missing')), ['/gone/old'], 'only the missing workspace gets Remove from list');
assert.equal(items[0].getAttribute('aria-label'), 'Remove old from list');
assert.match(items[0].textContent, /Remove from list/);
await act(async () => { items[0].dispatchEvent(new window.Event('click', { bubbles: true })); });
await settle();
assert.deepEqual(removed, ['/gone/old'], 'removed through repository.remove, as the welcome page does');
assert.equal(reloads, 1, 'and the list is read again');
assert.deepEqual(switched, [], 'removing does not switch to it');
await act(async () => rootNode.unmount());

// The title bar shows these items and passes the list reload in.
const bar = readFileSync(path.join(root, 'src/renderer/components/TitleBar.tsx'), 'utf8');
assert.match(bar, /<RecentWorkspaceItems recents=\{recents\} onSwitch=\{props\.onSwitchRepo\} onReload=\{props\.onReloadRecents\} \/>/);
assert.match(readFileSync(path.join(root, 'src/renderer/App.tsx'), 'utf8'), /onReloadRecents=\{reloadRepoState\}/);
console.log('title-bar-switcher: 8 checks passed');
