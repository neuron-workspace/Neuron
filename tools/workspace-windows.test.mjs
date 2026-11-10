// Run: node tools/workspace-windows.test.mjs
//
// Which window a workspace opens in, and whose terminal a session name belongs to.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main/workspace-windows.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { decideOpen, ptyKey, ownsPtyKey } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

const key = (dir) => dir.toLowerCase().replace(/[\\/]+$/, '');
const notes = { id: 1, kind: 'workspace', repo: 'C:\\Notes' };
const work = { id: 2, kind: 'workspace', repo: 'C:\\Work' };
const empty = { id: 3, kind: 'workspace', repo: null };
const manager = { id: 4, kind: 'workspaces', repo: null };
const settings = { id: 5, kind: 'settings', repo: null };

// A folder already on screen is brought forward, however its path is spelled.
assert.deepEqual(decideOpen('c:\\notes\\', [notes, work], 2, key), { action: 'focus', id: 1 });
assert.deepEqual(decideOpen('C:\\Notes', [notes], 1, key), { action: 'focus', id: 1 }, 'reopening your own workspace');
// Asking from a window that has a workspace never replaces it.
assert.deepEqual(decideOpen('C:\\Other', [notes, work], 1, key), { action: 'new' });
// An empty first-run window takes the folder itself.
assert.deepEqual(decideOpen('C:\\Other', [empty], 3, key), { action: 'adopt', id: 3 });
// The manager and Settings are not workspace windows: they never adopt one.
assert.deepEqual(decideOpen('C:\\Other', [notes, manager], 4, key), { action: 'new' });
assert.deepEqual(decideOpen('C:\\Other', [settings], 5, key), { action: 'new' });
// Being already open wins over adopting.
assert.deepEqual(decideOpen('C:\\Work', [work, empty], 3, key), { action: 'focus', id: 2 });
// No asking window (a second launch with a folder argument).
assert.deepEqual(decideOpen('C:\\Other', [notes], null, key), { action: 'new' });
assert.deepEqual(decideOpen('C:\\Other', [], null, key), { action: 'new' });
// A sender that is not one of our windows.
assert.deepEqual(decideOpen('C:\\Other', [notes], 99, key), { action: 'new' });

// Terminal session names are private to the window that made them.
assert.equal(ptyKey(7, 'panel'), '7:panel');
assert.equal(ownsPtyKey(7, ptyKey(7, 'panel')), true);
assert.equal(ownsPtyKey(7, ptyKey(71, 'panel')), false, 'window 7 does not own window 71');
assert.equal(ownsPtyKey(71, ptyKey(7, '1:panel')), false);

console.log('workspace windows: all checks passed');
