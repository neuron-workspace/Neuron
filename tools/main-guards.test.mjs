// Exercise the actual main-process helpers and IPC handlers without starting Electron.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const helpers = new Set(['entryOf', 'windowOf', 'repoOf', 'resolveInRepo', 'ownsPty']);
const selected = ast.statements.filter((node) => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((d) => helpers.has(d.name.getText(ast)));
  if (ts.isFunctionDeclaration(node)) return helpers.has(node.name?.text);
  return ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ['ipcMain.handle', 'ipcMain.on'].includes(node.expression.expression.getText(ast));
}).map((node) => node.getText(ast)).join('\n');
const { outputText } = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
const handlers = new Map();
const mainFrame = {};
const sender = { id: 1, mainFrame };
let destroyed = false;
const entry = { window: { webContents: sender, isDestroyed: () => destroyed }, repo: '/workspace', kind: 'workspace' };
const appWindows = new Map([[1, entry]]);
const writes = [];
const removed = [];
let renameFailures = 0;
let attempts = 0;
let failWrite = false;
let failFallback = false;
const context = vm.createContext({
  appWindows, ptyOwner: new Map([[7, 1]]),
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => handlers.set(name, fn) },
  path, process, randomBytes, Date: { now: () => 123 },
  Atomics: { wait: () => {} },
  console: { error: () => {} },
  resolveInside: (root, rel) => path.join(root, rel), realpathInside: () => true,
  textGuard: () => 'free', capturePreImage: () => {},
  settingsSectionOf: () => null,
  fs: {
    existsSync: () => true,
    writeFileSync: (file, content) => {
      writes.push({ file, content });
      if (failWrite || (failFallback && !file.endsWith('.tmp'))) throw new Error('write failed');
    },
    renameSync: () => {
      attempts++;
      if (renameFailures-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    },
    unlinkSync: (file) => removed.push(file),
  },
});
vm.runInContext(outputText + '\nglobalThis.checkEntry = entryOf;', context);
assert.equal(context.checkEntry({ sender, senderFrame: mainFrame }), entry);
for (const event of [
  { sender, senderFrame: {} }, // iframe in the privileged webContents
  { sender, senderFrame: null },
  { sender },
  { sender: { id: 2, mainFrame }, senderFrame: mainFrame }, // view/browser webview
  { sender: { id: 1, mainFrame }, senderFrame: mainFrame }, // identity, not just an id
]) assert.equal(context.checkEntry(event), null);
destroyed = true;
assert.equal(context.checkEntry({ sender, senderFrame: mainFrame }), null);
destroyed = false;

// Missing dependencies intentionally throw if a denied handler reaches privileged work.
let refused = 0;
for (const senderFrame of [{}, null]) {
  for (const [name, handler] of handlers) {
    const event = { sender, senderFrame };
    if (name === 'terminal:spawn') await assert.rejects(async () => handler(event), /only available to app windows/);
    else {
      const result = await handler(event, 7);
      assert.notEqual(result?.success, true, name);
      if (name === 'workspace:file-base') assert.equal(event.returnValue, null);
    }
    refused++;
  }
}
assert.equal(writes.length, 0, 'denied IPC never writes files');

const save = handlers.get('notes:write');
const event = { sender, senderFrame: mainFrame };
await Promise.all([save(event, 'note.md', 'one'), save(event, 'note.md', 'two')]);
assert.equal(writes.length, 2);
assert.notEqual(writes[0].file, writes[1].file, 'same clock tick still gets independent temporary files');
assert.ok(writes.every(({ file }) => /\.\d+\.123\.[a-f0-9]+\.tmp$/.test(file)));
assert.deepEqual(removed, writes.map(({ file }) => file));

failWrite = true;
assert.equal((await save(event, 'note.md', 'partial')).success, false);
assert.equal(removed.at(-1), writes.at(-1).file, 'partial temp is cleaned after write failure');
failWrite = false;
renameFailures = 2;
attempts = 0;
assert.equal((await save(event, 'note.md', 'retry')).success, true);
assert.equal(attempts, 3, 'transient busy errors still retry');
renameFailures = 6;
attempts = 0;
assert.equal((await save(event, 'note.md', 'fallback')).success, true);
assert.equal(attempts, 6);
assert.equal(writes.at(-1).file, path.join('/workspace', 'note.md'));
assert.equal(removed.at(-1), writes.at(-2).file, 'fallback success cleans temp');
renameFailures = 6;
failFallback = true;
assert.equal((await save(event, 'note.md', 'failed fallback')).success, false);
assert.equal(removed.at(-1), writes.at(-2).file, 'fallback failure cleans temp');

console.log(`main-guards: ${refused} handler refusals, 7 sender decisions, 5 save scenarios passed`);
