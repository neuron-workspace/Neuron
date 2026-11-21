// Exercise the actual main-process helpers and IPC handlers without starting Electron.
import assert from 'node:assert/strict';
import * as realFs from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  export * from './src/main/repoPath';
  export * from './src/main/htmx/pathPolicy';
  export { folderKey, withName } from './src/main/recentRepos';
  export { settingsSectionOf } from './src/main/workspace-windows';
  export { createSaveQueue, saveKey, writeAtomically } from './src/main/save-file';
  export { NOTE_READ_LIMIT, TOO_LARGE_TO_OPEN, TOO_LARGE_TO_SAVE } from './src/main/file-limits';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const policy = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const source = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const helpers = new Set(['entryOf', 'windowOf', 'repoOf', 'resolveInRepo', 'ownsPty', 'safeSettingsKey', 'isRecord', 'SECRETS_KEY', 'saveQueue']);
// Walk every nesting level. A new handler cannot silently fall outside this test.
function registrations(ast) {
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ['ipcMain.handle', 'ipcMain.on'].includes(node.expression.getText(ast))) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}
const selected = ast.statements.filter((node) => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((d) => helpers.has(d.name.getText(ast)));
  if (ts.isFunctionDeclaration(node)) return helpers.has(node.name?.text);
  return false;
}).map((node) => node.getText(ast)).join('\n');
const htmxSource = readFileSync(new URL('../src/main/htmx/index.ts', import.meta.url), 'utf8');
const htmxAst = ts.createSourceFile('index.ts', htmxSource, ts.ScriptTarget.Latest, true);
const calls = [...registrations(ast), ...registrations(htmxAst)];
const handlerSource = calls.map((node) => node.getText() + ';').join('\n');
const { outputText } = ts.transpileModule(selected + '\n' + handlerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
const handlers = new Map();
const mainFrame = {};
const sender = { id: 1, mainFrame, send: () => {} };
let destroyed = false;
const entry = { window: { webContents: sender, isDestroyed: () => destroyed }, repo: '/workspace', kind: 'workspace' };
const appWindows = new Map([[1, entry]]);
const writes = [];
const removed = [];
let renameFailures = 0;
let attempts = 0;
let failWrite = false;
let failFallback = false;
let checkRealPaths = false;
let stat = { size: 1, isFile: () => true, isDirectory: () => false };
let missing = false;
let lstatError = null;
const effects = [];
const effect = (name) => (...args) => { effects.push([name, ...args]); };
let settings = { repositories: { current: '/current', recent: ['/recent'] } };
const revealed = [];
let captures = 0;
const context = vm.createContext({
  appWindows, ptyOwner: new Map([[7, 1]]),
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => handlers.set(name, fn) },
  path, process, randomBytes, Object, Date: { now: () => 123 },
  Buffer,
  createSaveQueue: policy.createSaveQueue, saveKey: policy.saveKey,
  NOTE_READ_LIMIT: policy.NOTE_READ_LIMIT, TOO_LARGE_TO_OPEN: policy.TOO_LARGE_TO_OPEN, TOO_LARGE_TO_SAVE: policy.TOO_LARGE_TO_SAVE,
  // The real save helper over this file system, with no waits between renames.
  writeAtomically: (fullPath, content, tmp) => policy.writeAtomically(fullPath, content, tmp, {
    writeFile: async (file, text) => {
      writes.push({ file, content: text });
      if (failWrite || (failFallback && !file.endsWith('.tmp'))) throw new Error('write failed');
    },
    rename: async () => {
      attempts++;
      if (renameFailures-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    },
    unlink: async (file) => { removed.push(file); },
  }, async () => {}),
  console: { error: () => {} },
  resolveInside: policy.resolveInside,
  realpathInside: (...args) => !checkRealPaths || policy.realpathInside(...args),
  resolveInWorkspace: policy.resolveInWorkspace,
  textGuard: () => 'free', capturePreImage: () => { captures++; },
  settingsSectionOf: policy.settingsSectionOf,
  folderKey: policy.folderKey, withName: policy.withName,
  readSettings: () => settings,
  writeSettings: (...args) => { effect('settings')(...args); return true; },
  secretCodec: () => ({ available: true }), encodeSecret: (value) => `encrypted:${value}`,
  rendererSettingsValue: (_key, value) => value,
  VIEW_TRUST_KEY: 'htmxViewApprovals',
  readSecret: effect('readSecret'),
  listJournalEntries: effect('journal'), restoreJournalEntry: effect('restore'),
  diagnostics: { write: effect('diagnostics') },
  requestPublic: effect('network'),
  ptys: new Map([[7, { write: effect('ptyWrite'), resize: effect('ptyResize'), kill: effect('ptyKill') }]]),
  ptyHistory: new Map([[7, 'history']]),
  shell: { showItemInFolder: (dir) => revealed.push(dir) },
  repoInfo: (dir) => ({ path: dir }),
  sessions: { get: effect('sessionGet'), revoke: effect('revoke') },
  fs: {
    existsSync: () => !missing,
    mkdirSync: effect('mkdir'),
    promises: { readFile: async (...args) => { effect('read')(...args); return '# Note'; }, stat: async () => stat },
    statSync: () => stat,
    lstatSync: () => { if (lstatError) throw lstatError; return stat; },
    readFileSync: () => { effects.push(['imageRead']); return Buffer.from('image'); },
    unlinkSync: (file) => removed.push(file),
  },
});
context.deps = { getRepoRoot: (event) => context.checkEntry(event)?.repo ?? null };
vm.runInContext(outputText + '\nglobalThis.checkEntry = entryOf;', context);
assert.equal(handlers.size, calls.length, 'every registration has a unique tested channel');
// Valid argument specimens, including explicit no-argument contracts. Adding a
// channel requires choosing its contract here, even if it happens to fail closed.
const contracts = {
  'window:chrome-state': [], 'window:toggle-fullscreen': [], 'window:open-page': ['appearance'],
  'window:opener-workspace': [], 'window:set-overlay-colors': [{ color: '#ffffff', symbolColor: '#000000' }],
  'settings:get': ['test'], 'settings:set': ['test', 'value'],
  'settings:set-secret': ['provider', 'apiKey', 'secret'], 'settings:has-secret': ['provider', 'apiKey'],
  'repository:get-current': [], 'repository:list-recent': [], 'repository:create': [], 'repository:open': [],
  'repository:switch': ['/workspace'], 'repository:set-name': ['/workspace', 'Name'],
  'repository:remove': ['/workspace'], 'repository:reveal': ['/workspace'],
  'templates:list': [], 'templates:create': ['starter'],
  'notes:list': [], 'workspace:entries': [], 'workspace:file-base': [], 'workspace:reveal': ['note.md'],
  'notes:read': ['note.md'], 'notes:write': ['note.md', 'content'], 'notes:delete': ['note.md'],
  'journal:list': ['note.md'], 'journal:restore': ['123-entry'], 'notes:create-section': ['folder'], 'notes:get-dir': [],
  'cookies:import-chrome': ['example.com'],
  'terminal:spawn': [{ key: 'default', cols: 80, rows: 24 }], 'terminal:history': [7],
  'terminal:write': [7, 'text'], 'terminal:resize': [7, 80, 24], 'terminal:windows-pty': [], 'terminal:kill': [7],
  'ai:complete': [{ provider: 'openai', model: 'test', system: 'test', messages: [{ role: 'user', content: 'hello' }] }],
  'plugin:net-request': [{ url: 'https://example.com', method: 'GET', headers: { accept: 'text/plain' }, body: '' }],
  'notes:log-error': [{ phase: 'test', error_message: 'test', stack_trace: '', remediation_step: '' }],
  'diagnostics:open-logs': [],
  'htmx-views:open': ['view.html', 'dark'], 'htmx-views:approve': ['view.html', 'a'.repeat(64)],
  'htmx-views:close': ['session-id'], 'htmx-views:reset-approval': ['view.html'], 'htmx-views:list-trusted': [],
};
assert.deepEqual([...handlers.keys()].sort(), Object.keys(contracts).sort(), 'new handlers need a security contract');
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
for (const event of [
  { sender, senderFrame: {} }, { sender, senderFrame: null }, { sender },
  { sender: { id: 2, mainFrame }, senderFrame: mainFrame },
  { sender: { id: 1, mainFrame }, senderFrame: mainFrame },
]) {
  for (const [name, handler] of handlers) {
    if (name === 'terminal:spawn') await assert.rejects(async () => handler(event, ...contracts[name]), /only available to app windows/);
    else {
      const result = await handler(event, ...contracts[name]);
      assert.notEqual(result?.success, true, name);
      if (name === 'workspace:file-base') assert.equal(event.returnValue, null);
    }
    refused++;
  }
}
assert.equal(writes.length, 0, 'denied IPC never writes files');
assert.equal(removed.length, 0, 'denied IPC never deletes files');
assert.equal(captures, 0, 'denied IPC never journals files');
assert.equal(effects.length, 0, 'denied IPC never reaches privileged dependencies');
assert.equal(revealed.length, 0);

const save = handlers.get('notes:write');
const event = { sender, senderFrame: mainFrame };
// A second legitimate app window passes entryOf, but cannot use our pty id.
const otherFrame = {};
const otherSender = { id: 2, mainFrame: otherFrame };
appWindows.set(2, { window: { webContents: otherSender, isDestroyed: () => false }, repo: '/other', kind: 'workspace' });
const otherEvent = { sender: otherSender, senderFrame: otherFrame };
assert.ok(context.checkEntry(otherEvent));
for (const name of ['terminal:write', 'terminal:resize', 'terminal:kill', 'terminal:history']) {
  const before = effects.length;
  const result = await handlers.get(name)(otherEvent, ...contracts[name]);
  assert.equal(result, name === 'terminal:history' ? '' : undefined, name);
  assert.equal(effects.length, before, `${name}: another window cannot touch the pty`);
  assert.ok(context.ptys.has(7), `${name}: the owner's pty survives`);
}
assert.equal(await handlers.get('terminal:history')(event, 7), 'history');
await handlers.get('terminal:write')(event, 7, 'owned');
await handlers.get('terminal:resize')(event, 7, 90, 30);
assert.deepEqual(effects.splice(0), [['ptyWrite', 'owned'], ['ptyResize', 90, 30]]);
appWindows.delete(2);
const assertFailure = (name, result) => {
  if (name === 'settings:get') assert.equal(result, null, name);
  else if (name === 'settings:has-secret') assert.equal(result, false, name);
  else if (name === 'terminal:history') assert.equal(result, '', name);
  else if (['window:set-overlay-colors', 'terminal:write', 'terminal:resize', 'terminal:kill'].includes(name)) assert.equal(result, undefined, name);
  else if (name === 'notes:read') assert.match(result, /^Error:/, name);
  else if (name === 'journal:list') assert.equal(result.length, 0, name);
  else if (name === 'templates:create') assert.equal(typeof result.error, 'string', name);
  else if (name === 'htmx-views:open') assert.equal(result.status, 'error', name);
  else assert.equal(result?.success, false, name);
};
let badTypes = 0;
async function rejectArgs(name, args) {
  const before = [writes.length, removed.length, effects.length, revealed.length, captures, JSON.stringify(settings)];
  if (name === 'terminal:spawn') await assert.rejects(async () => handlers.get(name)(event, ...args), /Invalid terminal options/);
  else assertFailure(name, await handlers.get(name)(event, ...args));
  assert.deepEqual([writes.length, removed.length, effects.length, revealed.length, captures, JSON.stringify(settings)], before, `${name}: no side effects`);
  badTypes++;
}
const wrongTypes = [null, undefined, 42, true, {}, [], ['text'], new Date(), new Uint8Array([1])];
for (const [name, args] of Object.entries(contracts)) {
  for (let index = 0; index < args.length; index++) {
    if (name === 'settings:set' && index === 1) continue; // value is intentionally unknown, not a string contract
    for (const bad of wrongTypes) {
      if (typeof args[index] === 'number' && typeof bad === 'number') continue;
      if (typeof args[index] === 'object' && bad && !Array.isArray(bad) && Object.getPrototypeOf(bad) === Object.prototype) continue;
      if (bad === undefined && ['terminal:spawn', 'journal:list'].includes(name)) continue;
      if (bad === undefined && name === 'htmx-views:open' && index === 1) continue;
      const invalid = [...args]; invalid[index] = bad;
      await rejectArgs(name, invalid);
    }
    if (typeof args[index] === 'object' || typeof args[index] === 'number') {
      const invalid = [...args]; invalid[index] = 'wrong';
      await rejectArgs(name, invalid);
    }
  }
}
for (const name of ['window:set-overlay-colors', 'ai:complete', 'plugin:net-request', 'notes:log-error']) await rejectArgs(name, [{}]);
for (const bad of [NaN, Infinity, '80', null]) {
  await rejectArgs('terminal:spawn', [{ cols: bad }]);
  await rejectArgs('terminal:resize', [7, bad, 24]);
}
// Object members must also be validated before side effects, not silently dropped.
for (const name of ['window:set-overlay-colors', 'terminal:spawn', 'ai:complete', 'plugin:net-request', 'notes:log-error']) {
  const valid = contracts[name][0];
  for (const key of Object.keys(valid)) {
    await rejectArgs(name, [{ ...valid, [key]: null }]);
    if (key !== 'headers') await rejectArgs(name, [{ ...valid, [key]: {} }]);
  }
}
await rejectArgs('plugin:net-request', [{ ...contracts['plugin:net-request'][0], headers: { accept: 42 } }]);
await rejectArgs('ai:complete', [{ ...contracts['ai:complete'][0], messages: [{ role: 'user', content: 42 }] }]);
for (const key of ['__proto__', 'constructor', 'prototype']) {
  for (const [name, args] of [
    ['settings:get', [key]], ['settings:set', [key, 'value']],
    ['settings:set-secret', [key, 'apiKey', 'value']], ['settings:set-secret', ['provider', key, 'value']],
    ['settings:has-secret', [key, 'apiKey']], ['settings:has-secret', ['provider', key]],
    ['repository:set-name', [key, 'Name']],
  ]) await rejectArgs(name, args);
}

// All workspace-relative handlers exercise the real lexical AND realpath policy.
const pathHandlers = ['workspace:reveal', 'notes:read', 'notes:write', 'notes:delete', 'notes:create-section',
  'journal:list', 'htmx-views:open', 'htmx-views:approve', 'htmx-views:reset-approval'];
const temp = realFs.mkdtempSync(path.join(tmpdir(), 'neuron-main-guards-'));
try {
  const repo = path.join(temp, 'workspace');
  const outside = path.join(temp, 'outside');
  realFs.mkdirSync(repo); realFs.mkdirSync(outside);
  realFs.mkdirSync(path.join(repo, '.git'));
  const hostile = ['../outside/note.md', 'sub/../note.md', '/etc/passwd', '.git/config', '.GIT\\hooks\\pre-commit', '.git. /config'];
  // Drive, UNC and device-name rules are Windows rules; elsewhere those are legal names.
  if (process.platform === 'win32') {
    hostile.push('C:\\outside\\note.md', '\\\\server\\share\\note.md', 'CON', 'NUL', 'COM1', 'aux.txt', 'file.md:stream', 'file.md.', 'dir /file.md');
  }
  for (const [name, target] of [['escape', outside], ['gitlink', path.join(repo, '.git')]]) {
    realFs.symlinkSync(target, path.join(repo, name), process.platform === 'win32' ? 'junction' : 'dir');
    hostile.push(`${name}/file.md`, `${name}/new/file.md`);
  }
  entry.repo = repo;
  checkRealPaths = true;
  for (const name of pathHandlers) {
    for (const bad of hostile) await rejectArgs(name, [bad, ...contracts[name].slice(1)]);
  }
} finally {
  entry.repo = '/workspace'; checkRealPaths = false;
  realFs.rmSync(temp, { recursive: true, force: true });
}

// Reveal accepts only existing current/recent/open workspaces, including aliases.
for (const dir of ['/current', '/recent', '/workspace', '/workspace/']) {
  assert.equal((await handlers.get('repository:reveal')(event, dir)).success, true);
  assert.equal(revealed.at(-1), dir);
}
await rejectArgs('repository:reveal', ['/unrelated']);
missing = true;
await rejectArgs('repository:reveal', ['/recent']);
missing = false;

// Notes and documents are statted before reading: exactly 25 MiB is read, one
// byte over is refused unread (2A).
const LIMIT = policy.NOTE_READ_LIMIT;
assert.equal(LIMIT, 25 * 1024 * 1024);
stat = { size: LIMIT + 1, isFile: () => true };
let before = effects.length;
assert.equal(await handlers.get('notes:read')(event, 'big.md'), policy.TOO_LARGE_TO_OPEN);
assert.equal(policy.TOO_LARGE_TO_OPEN, 'Error: This file is too large to open in Neuron (over 25 MB).');
assert.equal(effects.length, before, 'a note over the limit is not read');
stat = { size: LIMIT, isFile: () => true };
assert.equal(await handlers.get('notes:read')(event, 'big.md'), '# Note');
assert.equal(effects.at(-1)[0], 'read');
// Nothing over the limit is written, and nothing is written over a file past it.
before = writes.length;
const huge = 'x'.repeat(LIMIT + 1);
const refusedSave = (result) => result.success === false && result.error === policy.TOO_LARGE_TO_SAVE;
assert.ok(refusedSave(await handlers.get('notes:write')(event, 'big.md', huge)));
assert.ok(refusedSave(await handlers.get('notes:write')(event, 'big.md', 'é'.repeat(LIMIT / 2 + 1))), 'counted in UTF-8 bytes');
stat = { size: LIMIT + 1, isFile: () => true };
assert.equal((await handlers.get('notes:write')(event, 'big.md', 'small')).success, false);
assert.equal(writes.length, before);
assert.equal(captures, 0, 'a refused save is not journaled');
stat = { size: 1, isFile: () => true, isDirectory: () => false };
assert.equal(await handlers.get('settings:get')(event, 'toString'), null, 'inherited settings are not exposed');

// Folder deletion neither journals nor unlinks; missing remains successful.
stat = { isDirectory: () => true };
await rejectArgs('notes:delete', ['folder']);
assert.equal((await handlers.get('notes:delete')(event, 'folder')).error, 'Use the folder delete for folders.');
stat = { isDirectory: () => false, isFile: () => true };
assert.equal((await handlers.get('notes:delete')(event, 'note.md')).success, true);
assert.equal(captures, 1);
assert.equal(removed.pop(), path.resolve('/workspace', 'note.md'));
lstatError = Object.assign(new Error('missing'), { code: 'ENOENT' });
assert.equal((await handlers.get('notes:delete')(event, 'missing.md')).success, true);
assert.equal(captures, 1);
lstatError = Object.assign(new Error('denied'), { code: 'EACCES' });
await rejectArgs('notes:delete', ['note.md']);
lstatError = null;
// Valid calls still reach their existing contracts after the type checks.
assert.equal((await handlers.get('settings:set')(event, 'example', { enabled: true })).success, true);
assert.equal(settings.example.enabled, true);
// Which HTML views are trusted is main's to write (7B): a renderer cannot trust a view nobody saw.
await rejectArgs('settings:set', ['htmxViewApprovals', { '/workspace::view.html': { contentHash: 'a'.repeat(64), grantedAt: 'now' } }]);
assert.equal((await handlers.get('settings:set-secret')(event, 'provider', 'apiKey', 'value')).success, true);
assert.equal(settings.__secrets.provider.apiKey, 'encrypted:value');
assert.equal((await handlers.get('settings:set-secret')(event, 'provider', 'apiKey', '')).success, true);
assert.equal(Object.hasOwn(settings.__secrets.provider, 'apiKey'), false, 'empty string still clears a secret');
assert.equal((await handlers.get('repository:set-name')(event, '/workspace', '  Work  ')).success, true);
// Kept by folder identity (3C), so another spelling of the folder finds it.
assert.deepEqual(settings.repositories.names, { [policy.folderKey('/workspace')]: 'Work' });
assert.equal((await handlers.get('repository:set-name')(event, '/workspace/', 'Field')).success, true);
assert.deepEqual(settings.repositories.names, { [policy.folderKey('/workspace')]: 'Field' }, 'one name per folder, however it is spelled');
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
assert.equal(writes.at(-1).file, path.resolve('/workspace', 'note.md'));
assert.equal(removed.at(-1), writes.at(-2).file, 'fallback success cleans temp');
renameFailures = 6;
failFallback = true;
assert.equal((await save(event, 'note.md', 'failed fallback')).success, false);
assert.equal(removed.at(-1), writes.at(-2).file, 'fallback failure cleans temp');

console.log(`main-guards: ${handlers.size} handlers, ${refused} sender refusals, ${badTypes} argument/path refusals; reveal, 25 MB limit, delete and 5 save scenarios passed`);
