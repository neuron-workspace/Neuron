// Run: node tools/template-dialog.test.mjs
// R1: the template dialog keeps itself and its error on a failure. The real
// WorkspaceTemplatesDialog and useWorkspaceTemplates, rendered with react-dom
// on a linkedom document against a fake bridge: a failed create leaves the
// dialog open with the message under the list, a dismissed folder picker
// leaves it open with no message, and only a created workspace closes it.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

const root = process.cwd();
const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The dialog's layers dispatch their own events on the document: they must be the document's kind.
for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'SVGElement',
  'Node', 'Element', 'Text', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver']) {
  if (window[name]) globalThis[name] = window[name];
}
globalThis.NodeFilter ??= window.NodeFilter ?? { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
window.getComputedStyle ??= globalThis.getComputedStyle;
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

let answer = null;
window.electronAPI = {
  templates: {
    list: async () => [{ id: 'starter', name: 'Starter', description: 'A first workspace', noteCount: 3 }],
    create: async () => answer,
  },
};

const outfile = path.join(root, 'tools/.template-dialog.tmp.cjs');
await build({
  stdin: { contents: `export { default as WorkspaceTemplatesDialog } from './src/renderer/components/WorkspaceTemplatesDialog';\nexport { useWorkspaceTemplates } from './src/renderer/lib/useWorkspaceTemplates';`, resolveDir: root, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', outfile, logLevel: 'silent', tsconfig: path.join(root, 'tsconfig.json'),
});
let modules;
try { modules = createRequire(import.meta.url)(outfile); } finally { rmSync(outfile, { force: true }); }
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

let open = true;
const closes = [];
function Host() {
  const templates = modules.useWorkspaceTemplates();
  const [isOpen, setOpen] = React.useState(true);
  open = isOpen;
  return React.createElement(modules.WorkspaceTemplatesDialog, { open: isOpen, onOpenChange: (next) => { if (!next) closes.push(true); setOpen(next); }, ...templates });
}
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const container = document.createElement('div');
document.body.appendChild(container);
const rootNode = createRoot(container);
await act(async () => { rootNode.render(React.createElement(Host)); });
await settle();
const button = () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Starter'));
const message = () => document.querySelector('[data-template-error]')?.textContent ?? null;
const click = async () => { await act(async () => { button().dispatchEvent(new window.Event('click', { bubbles: true })); }); await settle(); };

assert.ok(button(), 'the dialog lists the template');
answer = { error: 'That folder already contains notes. Choose an empty folder, or open it directly instead.' };
await click();
assert.equal(open, true, 'a failure keeps the dialog open');
assert.equal(closes.length, 0);
assert.equal(message(), answer.error, 'the error is shown under the list');
assert.ok(button(), 'the template list is still there to pick again');

answer = null; // the folder picker was dismissed
await click();
assert.equal(open, true, 'a dismissed picker leaves the dialog open');
assert.equal(message(), null, 'and is no error');

answer = { repository: { path: '/new', name: 'new' } };
await click();
assert.equal(open, false, 'a created workspace closes it');
assert.equal(closes.length, 1);
await act(async () => rootNode.unmount());
console.log('template-dialog: 7 checks passed');
