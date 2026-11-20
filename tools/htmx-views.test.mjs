// Runnable checks for the HTMX view platform (src/main/htmx/*): path policy,
// manifest validation, token/session lifecycle, HTML escaping, and a live
// integration pass against the loopback view server. No test framework —
// bundle with vite's esbuild, then assert. Run: node tools/htmx-views.test.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'tools', '.htmx-views.tmp.mjs');

await build({
  stdin: {
    contents: `
      export * from './src/main/htmx/pathPolicy';
      export * from './src/main/htmx/manifest';
      export * from './src/main/htmx/appPaths';
      export * from './src/main/htmx/sessions';
      export * from './src/main/htmx/html';
      export * from './src/main/htmx/server';
      export * from './src/main/htmx/neuronJs';
      export { configureWriteJournal, listJournalEntries } from './src/main/journal';
      export { initHtmxViews } from './src/main/htmx/index';
      export { ipcHandlers } from 'electron';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  plugins: [{ name: 'mock-electron', setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
      export const ipcHandlers = new Map();
      export const ipcMain = { handle: (name, fn) => ipcHandlers.set(name, fn) };
    ` }));
  } }],
});

const m = await import(pathToFileURL(outfile));
rmSync(outfile);

// --- glob compilation --------------------------------------------------------
assert.ok(m.compileGlob('Projects/**').test('Projects/a/b.md'));
assert.ok(!m.compileGlob('Projects/**').test('Other/a.md'));
assert.ok(m.compileGlob('*.md').test('a.md'));
assert.ok(!m.compileGlob('*.md').test('sub/a.md'));
assert.ok(m.compileGlob('**/*.md').test('sub/deep/a.md'));
assert.ok(m.compileGlob('**/*.md').test('a.md'));
assert.ok(m.compileGlob('data/?.csv').test('data/a.csv'));
assert.ok(!m.compileGlob('data/?.csv').test('data/ab.csv'));
assert.ok(!m.compileGlob('a+b/*').test('axb/x')); // regex specials escaped
{
  const started = performance.now();
  assert.ok(m.compileGlob('?*'.repeat(250)).test('a'.repeat(4096)));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `500-character glob took ${elapsed.toFixed(1)} ms (limit 100 ms)`);
  console.log(`htmx glob: 500-character pattern / 4096-character path in ${elapsed.toFixed(1)} ms`);
}

// --- relative path normalization ----------------------------------------------
assert.equal(m.normalizeRel('notes/a.md'), 'notes/a.md');
assert.equal(m.normalizeRel('.\\notes\\a.md'), 'notes/a.md');
for (const bad of ['..', '../x', 'a/../../x', '/etc/passwd', 'C:/Windows', 'C:\\x', '\\\\server\\share', '~/secrets', 'a\0b', 'a%00b', '', 42, null]) {
  assert.equal(m.normalizeRel(bad), null, `normalizeRel should reject: ${String(bad)}`);
}
// Device names, streams and trailing dots/spaces are Windows rules; legal elsewhere.
for (const name of ['CON', 'NUL', 'COM1', 'aux.txt', 'file.md:stream', 'note.md.', 'dir /note.md', 'dir./note.md', 'Meeting 10:30.md']) {
  if (process.platform === 'win32') assert.equal(m.normalizeRel(name), null, `normalizeRel should reject on Windows: ${name}`);
  else assert.equal(m.normalizeRel(name), name.replace(/\\/g, '/'), `normalizeRel should allow: ${name}`);
}
assert.equal(m.normalizeRelDir(''), '');
assert.equal(m.normalizeRelDir('..'), null);

// --- workspace resolution + symlink escapes ------------------------------------
const ws = mkdtempSync(join(tmpdir(), 'neuron-htmx-ws-'));
const outside = mkdtempSync(join(tmpdir(), 'neuron-htmx-out-'));
m.configureWriteJournal(outside);
mkdirSync(join(ws, 'notes'), { recursive: true });
writeFileSync(join(ws, 'notes', 'hello.md'), '# Hello world\n\nA note with #alpha and #beta tags. Searchable needle here.\n');
writeFileSync(join(ws, 'notes', 'other.md'), '# Other\n\n#alpha only.\n');
writeFileSync(join(outside, 'secret.txt'), 'top secret');

assert.ok(m.resolveInWorkspace(ws, 'notes/hello.md'));
assert.ok(m.resolveInWorkspace(ws, '..hidden/note.md'), 'ordinary dot-prefixed names are not traversal');
assert.equal(m.resolveInWorkspace(join(ws, 'missing-root'), 'note.md'), null, 'missing roots fail closed');
assert.equal(m.resolveInWorkspace(ws, '../secret.txt'), null);
assert.equal(m.resolveInWorkspace(ws, 'C:/Windows/system32'), null);
let symlinksWork = true;
try {
  symlinkSync(outside, join(ws, 'escape'), 'junction');
} catch {
  symlinksWork = false; // no symlink privilege on this machine — skip
}
if (symlinksWork) {
  assert.equal(m.resolveInWorkspace(ws, 'escape/secret.txt'), null, 'symlink escape must be rejected');
}
// A view never reaches a repository's internals, however the path is spelled.
mkdirSync(join(ws, '.git', 'hooks'), { recursive: true });
for (const bad of ['.git/config', '.git/hooks/pre-commit', 'a/../.git/x', '.GIT\\config', 'sub/.git/x', '.git']) {
  assert.equal(m.resolveInWorkspace(ws, bad), null, `resolveInWorkspace must refuse ${bad}`);
  assert.equal(m.normalizeRel(bad), null, `normalizeRel must refuse ${bad}`);
}
assert.equal(m.resolveInWorkspace(ws, '.git', { allowRootDir: true }), null, 'not even as a directory to list');
assert.ok(m.resolveInWorkspace(ws, '.gitignore'), '.gitignore is an ordinary file');
if (symlinksWork) {
  symlinkSync(join(ws, '.git'), join(ws, 'gitlink'), 'junction');
  assert.equal(m.resolveInWorkspace(ws, 'gitlink/config'), null, 'a link into .git is refused by its real path');
  mkdirSync(join(outside, 'gone'));
  symlinkSync(join(outside, 'gone'), join(ws, 'broken'), process.platform === 'win32' ? 'junction' : 'dir');
  rmSync(join(outside, 'gone'), { recursive: true });
  assert.equal(m.resolveInWorkspace(ws, 'broken/new.md'), null, 'broken links fail closed');
}

// --- manifest validation --------------------------------------------------------
const good = m.validateManifest({ name: 'Test', permissions: ['workspace.files.read', 'workspace.files.write'], allowedReadPaths: ['notes/**'], allowedWritePaths: ['data/out.json'] });
assert.ok(good.ok, good.errors.join('; '));
assert.ok(!m.validateManifest({ exfiltrate: true }).ok, 'unknown fields rejected');
assert.ok(!m.validateManifest({ permissions: ['commands.execute.anything'] }).ok, 'unknown permission rejected');
assert.ok(!m.validateManifest({ networkPolicy: 'open' }).ok, 'network access not grantable');
assert.ok(!m.validateManifest({ allowedReadPaths: ['../outside/**'] }).ok, 'traversal in patterns rejected');
const grants = m.effectiveGrants(good.value);
assert.ok(grants.needsApproval, 'write permissions require approval');
const readOnlyManifest = m.validateManifest({ permissions: ['workspace.files.read'], allowedReadPaths: ['notes/**'] });
assert.ok(readOnlyManifest.ok, readOnlyManifest.errors.join('; '));
assert.ok(m.effectiveGrants(readOnlyManifest.value).needsApproval, 'every requested capability requires approval');
for (const allowedReadPaths of [undefined, [], ['notes/**']]) {
  const manifest = m.validateManifest({ permissions: ['workspace.files.read'], allowedReadPaths }).value;
  const effective = m.effectiveGrants(manifest);
  assert.deepEqual(effective.readPatterns, allowedReadPaths?.length ? allowedReadPaths : ['**']);
  assert.ok(effective.caps.has('workspace.files.read'));
  assert.ok(effective.needsApproval, 'full-workspace reads must be approved too');
}
const noManifestGrants = m.effectiveGrants(null);
assert.deepEqual([...noManifestGrants.caps], [], 'an unmanifested view gets no capabilities');
assert.deepEqual(noManifestGrants.readPatterns, [], 'an unmanifested view gets no readable paths');
assert.ok(!noManifestGrants.needsApproval, 'an unmanifested view renders without an empty prompt');

// The IPC prompt carries the very same effective scope used to create sessions.
writeFileSync(join(ws, 'approval.html'), '<p>Approval</p>');
mkdirSync(join(ws, '.neuron', 'manifests'), { recursive: true });
m.initHtmxViews({ getRepoRoot: (event) => event.trusted ? ws : null, getSetting: () => ({}), setSetting: () => {} });
for (const allowedReadPaths of [undefined, [], ['notes/**']]) {
  writeFileSync(join(ws, '.neuron', 'manifests', 'approval.json'), JSON.stringify({ permissions: ['workspace.files.read'], allowedReadPaths }));
  const result = await m.ipcHandlers.get('htmx-views:open')({ trusted: true }, 'approval.html');
  assert.equal(result.status, 'needs-approval');
  assert.deepEqual(result.readPaths, allowedReadPaths?.length ? allowedReadPaths : ['**']);
}
assert.equal(m.ipcHandlers.get('htmx-views:close')({ trusted: false }, 'some-session').success, false);
// Opening a view must not scaffold through a .neuron junction outside the workspace.
if (symlinksWork) {
  const linkedWs = join(ws, 'linked-workspace');
  const scaffoldTarget = join(outside, 'scaffold-target');
  mkdirSync(linkedWs); mkdirSync(scaffoldTarget);
  writeFileSync(join(linkedWs, 'view.html'), '<p>View</p>');
  symlinkSync(scaffoldTarget, join(linkedWs, '.neuron'), process.platform === 'win32' ? 'junction' : 'dir');
  m.initHtmxViews({ getRepoRoot: () => linkedWs, getSetting: () => ({}), setSetting: () => {} });
  // Stop before server startup, after the actual scaffold runs, with an invalid legacy manifest.
  writeFileSync(join(linkedWs, 'view.neuron.json'), '{bad json');
  const result = await m.ipcHandlers.get('htmx-views:open')({}, 'view.html');
  assert.equal(result.status, 'error');
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(scaffoldTarget), [], 'scaffolding never writes outside the workspace');
}
rmSync(join(ws, 'approval.html'));
rmSync(join(ws, '.neuron', 'manifests', 'approval.json'));

// --- view + manifest paths -----------------------------------------------------
assert.ok(m.isViewPath('report.html'), 'plain .html opens as a view');
assert.ok(m.isViewPath('Snake.html'), 'a plain HTML file is a view');
assert.ok(!m.isViewPath('notes/readme.md'), 'plain notes are not views');
assert.ok(!m.isViewPath('notes/readme.htm'), 'only the .html extension is a view');
assert.equal(typeof m.appManifestPathFor, 'undefined', 'folder apps are gone');
// View manifests mirror their path under .neuron/manifests:
assert.equal(m.manifestPathFor('projects/tracker.html'), '.neuron/manifests/projects/tracker.json');
assert.equal(m.manifestPathFor('projects/index.html'), '.neuron/manifests/projects/index.json');
assert.equal(m.legacyManifestPathFor('projects/tracker.html'), 'projects/tracker.neuron.json');
assert.equal(m.defaultViewName('a/b/Report.html'), 'Report', 'a view is named for its file');

// --- variables validation ---------------------------------------------------------
const vars = m.validateVariablesFile({ version: 1, variables: { status: { type: 'string', value: 'active', writable: true } } });
assert.ok(vars.ok);
assert.ok(!m.validateVariablesFile({ version: 1, variables: { s: { type: 'string', value: 42 } } }).ok, 'type mismatch rejected');
assert.ok(!m.validateVariablesFile({ version: 1, variables: { 'bad name!': { type: 'string', value: '' } } }).ok);

// --- HTML escaping + interpolation ---------------------------------------------
assert.equal(m.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(m.interpolate('Hi {{ params.name }}', { params: { name: '<b>x</b>' } }), 'Hi &lt;b&gt;x&lt;/b&gt;');
assert.equal(m.interpolate('{{ params.__proto__ }}', { params: {} }), '');
assert.equal(m.interpolate('{{ variables.constructor.name }}', { variables: {} }), '');
assert.equal(m.interpolate('{{ nope.x }}', { params: {} }), '');

// --- full documents vs fragments -------------------------------------------------
{
  const S = m.DOCUMENT_SCRIPTS.neuron + m.DOCUMENT_SCRIPTS.htmx;
  assert.equal(S, '<script src="neuron.js"></script><script src="htmx.js" defer></script>', 'the exact added bytes');

  // Detection
  for (const full of [
    '<!doctype html><html><head></head></html>',
    '<!DOCTYPE HTML>\n<html>',
    '<HTML lang="en"><HEAD></HEAD></HTML>',
    '﻿<!doctype html><html>',
    '\n  <!-- a comment -->\n<!-- another --> <!doctype html><html>',
    '<html>',
  ]) assert.ok(m.isFullDocument(full), `full document: ${JSON.stringify(full)}`);
  for (const fragment of [
    '<h1>Hi</h1>',
    '<style>p{}</style><p>x</p>',
    '<!-- <html> -->\n<p>x</p>',
    '<script>const s = "<html>";</script>',
    '<p><html></p>',
    '<htmlx>',
    '<!-- unterminated <html>',
    '',
  ]) assert.ok(!m.isFullDocument(fragment), `fragment: ${JSON.stringify(fragment)}`);
  assert.equal(m.prepareFullDocument('<!-- <html> -->\n<p>x</p>', 'dark'), null, 'a fragment is never prepared as a document');

  // With a head: scripts go right after <head ...>, data-theme onto <html>.
  assert.equal(
    m.prepareFullDocument('<!doctype html>\n<html lang="fr">\n<head>\n<title>T</title></head><body></body></html>', 'dark'),
    `<!doctype html>\n<html lang="fr" data-theme="dark">\n<head>${S}\n<title>T</title></head><body></body></html>`,
  );
  // Without a head: one is inserted right after <html ...>.
  assert.equal(
    m.prepareFullDocument('<!doctype html><html lang="en"><body><p>x</p></body></html>', 'light'),
    `<!doctype html><html lang="en" data-theme="light"><head>${S}<body><p>x</p></body></html>`,
  );
  // Doctype and a head but no <html> tag: nothing to put data-theme on.
  assert.equal(m.prepareFullDocument('<!doctype html><head></head><p>x</p>', 'dark'), `<!doctype html><head>${S}</head><p>x</p>`);
  // Doctype with neither tag is not something to place tags in: a fragment.
  assert.equal(m.prepareFullDocument('<!doctype html><title>x</title><p>y</p>', 'dark'), null);
  // A ">" inside a quoted attribute does not end the tag.
  assert.equal(
    m.prepareFullDocument('<html data-x="a>b"><head data-note="1 > 0" class=\'x>y\'><title>t</title></head></html>', 'dark'),
    `<html data-x="a>b" data-theme="dark"><head data-note="1 > 0" class='x>y'>${S}<title>t</title></head></html>`,
  );
  // A <head> inside a comment, a script or a style is not the head.
  assert.equal(
    m.prepareFullDocument('<html><!-- <head> --><script>"<head>"</script><style>/* <head> */</style><head></head></html>', 'dark'),
    `<html data-theme="dark"><!-- <head> --><script>"<head>"</script><style>/* <head> */</style><head>${S}</head></html>`,
  );
  // <header> is not <head>.
  assert.equal(
    m.prepareFullDocument('<html><body><header>x</header></body></html>', 'dark'),
    `<html data-theme="dark"><head>${S}<body><header>x</header></body></html>`,
  );
  // Scripts the document already loads are not added twice; a commented-out one
  // does not count as loaded.
  assert.equal(
    m.prepareFullDocument('<html><head><script src="neuron.js"></script></head></html>', 'dark'),
    `<html data-theme="dark"><head>${m.DOCUMENT_SCRIPTS.htmx}<script src="neuron.js"></script></head></html>`,
  );
  assert.equal(
    m.prepareFullDocument('<html><head></head><body><script src="./htmx.js?v=2" defer></script><script src=neuron.js></script></body></html>', 'dark'),
    '<html data-theme="dark"><head></head><body><script src="./htmx.js?v=2" defer></script><script src=neuron.js></script></body></html>',
  );
  assert.equal(
    m.prepareFullDocument('<html><head><!-- <script src="neuron.js"></script> --><script src="my-neuron.js"></script></head></html>', 'dark'),
    `<html data-theme="dark"><head>${S}<!-- <script src="neuron.js"></script> --><script src="my-neuron.js"></script></head></html>`,
  );
  // data-theme only when absent, whatever its value or case.
  assert.equal(
    m.prepareFullDocument('<html DATA-THEME="sepia"><head></head></html>', 'dark'),
    `<html DATA-THEME="sepia"><head>${S}</head></html>`,
  );
  // An attribute value that merely contains "data-theme" does not count.
  assert.equal(
    m.prepareFullDocument('<html class="data-theme"><head></head></html>', 'light'),
    `<html class="data-theme" data-theme="light"><head>${S}</head></html>`,
  );
  // Everything else is untouched: a leading BOM, comments, meta, title, classes.
  {
    const src = '﻿<!-- top -->\n<!doctype html>\n<html lang="fr" class="a">\n<head>\n  <meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="img-src \'none\'">\n  <title>Mon tableau</title>\n</head>\n<body class="b"><p>x</p></body>\n</html>\n';
    const out = m.prepareFullDocument(src, 'dark');
    assert.equal(out.replace(S, '').replace(' data-theme="dark"', ''), src, 'only the two scripts and data-theme are added');
  }

  // Interpolation behaves the same for both kinds: it runs before either.
  const doc = m.interpolate('<!doctype html><html><head><title>{{ variables.t }}</title></head></html>', { variables: { t: '<b>' } });
  assert.ok(m.prepareFullDocument(doc, 'dark').includes('<title>&lt;b&gt;</title>'));

  // Fragments are wrapped as before, now as a valid document with a lang and neuron.js.
  const wrapped = m.wrapDocument({ body: '<p>hi</p>', title: 'V', sessionId: 'sid', theme: 'dark', styles: [] });
  assert.ok(wrapped.startsWith('<!doctype html>\n<html lang="en">\n<head>'));
  assert.ok(wrapped.includes('<link rel="stylesheet" href="/views/sid/neuron.css">'));
  assert.ok(wrapped.includes('<script src="/views/sid/neuron.js"></script>\n  <script src="/views/sid/htmx.js" defer></script>'));
  assert.ok(wrapped.includes('<body class="neuron-view theme-dark">\n<p>hi</p>\n</body>'));
}

// --- sessions -----------------------------------------------------------------
const sessions = new m.SessionManager();
const mkSession = (caps, readPatterns, writePatterns = []) => sessions.create({
  viewPath: 'dash.html', root: ws, name: 'Dash', theme: 'dark',
  caps: new Set(caps),
  readPolicy: readPatterns.map(m.compileGlob),
  writePolicy: writePatterns.map(m.compileGlob),
});
{
  const s = mkSession(['notes.read'], ['**']);
  assert.equal(sessions.byCookie(`${s.id}:${s.cookieToken}`), s);
  assert.equal(sessions.byCookie(`${s.id}:wrongtoken`), null);
  assert.equal(sessions.byCookie('garbage'), null);
  const boot = s.bootToken;
  assert.ok(sessions.consumeBoot(s.id, boot));
  assert.equal(sessions.consumeBoot(s.id, boot), null, 'boot token is one-time');
  sessions.revoke(s.id);
  assert.equal(sessions.byCookie(`${s.id}:${s.cookieToken}`), null, 'revoked session rejected');
}

// --- integration: live loopback server ------------------------------------------
writeFileSync(join(ws, 'dash.html'), '<h1>{{ variables.dashboardTitle }}</h1>\n<div hx-get="/api/v1/search">x</div>\n<script>window.__ok = 1;</script>\n');
writeFileSync(join(ws, 'report.html'), '<h1>Unmanifested report</h1>\n');
mkdirSync(join(ws, '.neuron', 'fragments'), { recursive: true });
writeFileSync(join(ws, '.neuron', 'variables.json'), JSON.stringify({
  version: 1,
  variables: {
    dashboardTitle: { type: 'string', value: 'Ops <Dash>', writable: false },
    projectStatus: { type: 'string', value: 'active', writable: true },
  },
}));
writeFileSync(join(ws, '.neuron', 'fragments', 'greet.html'), '<p>{{ variables.dashboardTitle }} / {{ params.who }}</p>');
mkdirSync(join(ws, 'data'), { recursive: true });
writeFileSync(join(ws, 'data', 'out.txt'), 'v1');

const htmxJs = createRequire(import.meta.url).resolve('htmx.org/dist/htmx.min.js');
const srv = await m.createViewServer(sessions, htmxJs);
const READ_CAPS = ['workspace.files.read', 'workspace.directories.list', 'workspace.search', 'notes.read', 'tags.read', 'variables.read'];

const reader = mkSession(READ_CAPS, ['notes/**', 'dash.html']);
const writer = mkSession([...READ_CAPS, 'workspace.files.write', 'workspace.files.create', 'workspace.files.delete', 'variables.write'], ['**'], ['data/**']);
const cookie = (s) => ({ cookie: `nv=${s.id}:${s.cookieToken}` });
const api = (s, route, init = {}) => fetch(`${srv.origin}${route}`, { ...init, headers: { ...cookie(s), ...(init.headers ?? {}) } });

// Opaque/cross-origin requests are refused even with a valid session cookie.
for (const origin of ['null', 'https://outside.example', '']) {
  const result = await api(writer, '/api/v1/context', { method: 'POST', headers: { Origin: origin } });
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error.code, 'bad_origin');
}
assert.equal((await api(reader, '/api/v1/context', { headers: { Origin: srv.origin } })).status, 200);
assert.equal((await api(reader, '/api/v1/context')).status, 200, 'normal same-origin GET may omit Origin');

// Unauthenticated and spoofed requests
assert.equal((await fetch(`${srv.origin}/api/v1/context`)).status, 401, 'no cookie -> 401');
assert.equal((await fetch(`${srv.origin}/api/v1/context`, { headers: { cookie: `nv=${reader.id}:forged` } })).status, 401, 'forged token -> 401');
// fetch() forbids overriding Host, so spoof it with a raw http request (DNS rebinding shape).
{
  const { request } = await import('node:http');
  const status = await new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path: '/api/v1/context', headers: { ...cookie(reader), host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  assert.equal(status, 403, 'host spoof -> 403');
}

// Document bootstrap: one-time boot token, CSP, cookie issuance
assert.equal((await fetch(`${srv.origin}/views/${reader.id}/document?boot=${reader.bootToken}`, { headers: { Origin: 'null' } })).status, 403, 'opaque origin cannot consume a boot token');
const docRes = await fetch(`${srv.origin}/views/${reader.id}/document?boot=${reader.bootToken}`);
assert.equal(docRes.status, 200);
const viewCsp = docRes.headers.get('content-security-policy') ?? '';
assert.match(viewCsp, /default-src 'none'/);
assert.match(viewCsp, /script-src 'self' 'unsafe-inline'/, 'HTML views may run inline scripts');
assert.match(viewCsp, /connect-src 'self'/, 'views reach the loopback API only');
assert.doesNotMatch(viewCsp, /connect-src[^;]*https?:/, 'views have no network egress');
assert.match(docRes.headers.get('set-cookie') ?? '', /HttpOnly/);
assert.equal(docRes.headers.get('x-content-type-options'), 'nosniff');
const docHtml = await docRes.text();
assert.ok(docHtml.includes('Ops &lt;Dash&gt;'), 'document interpolates + escapes variables');
assert.ok(docHtml.includes(`/views/${reader.id}/htmx.js`), 'htmx served locally');
assert.ok(docHtml.includes(`/views/${reader.id}/neuron.css`), 'neuron.css is always injected');
assert.ok(docHtml.includes('window.__ok'), 'authored inline scripts are served verbatim');
assert.equal((await fetch(`${srv.origin}/views/${reader.id}/document?boot=x`)).status, 403, 'boot token replay/forgery -> 403');

// Reload the original URL using only the cookie issued to this view's partition.
{
  const s = mkSession(READ_CAPS, ['notes/**']);
  const url = `${srv.origin}/views/${s.id}/document?boot=${s.bootToken}`;
  const initial = await fetch(url);
  assert.equal(initial.status, 200);
  const headers = { cookie: initial.headers.get('set-cookie').split(';')[0] };
  assert.equal((await fetch(url, { headers })).status, 200, 'self-reload with consumed boot token -> 200');
  assert.equal((await fetch(url)).status, 403, 'reload without cookie -> 403');
  assert.equal((await fetch(url, { headers: cookie(writer) })).status, 403, 'another view cookie cannot reload this document');
  s.expiresAt = Date.now() - 1;
  assert.equal((await fetch(url, { headers })).status, 403, 'expired session cannot reload');
  s.expiresAt = Date.now() + m.SESSION_TTL_MS;
  sessions.revoke(s.id);
  assert.equal((await fetch(url, { headers })).status, 403, 'revoked session cannot reload');
}

// An unmanifested HTML file renders, but its session can read nothing.
const unmanifested = sessions.create({
  viewPath: 'report.html', root: ws, name: 'Report', theme: 'dark',
  caps: noManifestGrants.caps,
  readPolicy: noManifestGrants.readPatterns.map(m.compileGlob),
  writePolicy: [],
});
const unmanifestedRes = await fetch(`${srv.origin}/views/${unmanifested.id}/document?boot=${unmanifested.bootToken}`);
assert.equal(unmanifestedRes.status, 200, 'an unmanifested .html file still renders');
assert.equal(unmanifestedRes.headers.get('content-security-policy'), viewCsp, 'all HTML views use the same CSP');
assert.ok((await unmanifestedRes.text()).includes('Unmanifested report'));

// A full document is served as written: the author's lang and title survive,
// neuron.js is added once, and the CSP and cookie are the same as for a fragment.
{
  writeFileSync(join(ws, 'full.html'), '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>Tableau {{ variables.dashboardTitle }}</title>\n</head>\n<body><p>Bonjour</p></body>\n</html>\n');
  const s = sessions.create({
    viewPath: 'full.html', root: ws, name: 'Full', theme: 'light',
    caps: new Set(['variables.read']), readPolicy: [], writePolicy: [],
  });
  const res = await fetch(`${srv.origin}/views/${s.id}/document?boot=${s.bootToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-security-policy'), viewCsp, 'a full document carries the same CSP');
  assert.match(res.headers.get('set-cookie') ?? '', /^nv=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/, 'and the same session cookie');
  const html = await res.text();
  assert.ok(html.startsWith('<!doctype html>\n<html lang="fr" data-theme="light">\n<head><script src="neuron.js"></script><script src="htmx.js" defer></script>\n'));
  assert.ok(html.includes('<title>Tableau Ops &lt;Dash&gt;</title>'), 'title kept, and interpolated + escaped as before');
  assert.equal(html.split('neuron.js').length - 1, 1, 'neuron.js is included once');
  assert.ok(!html.includes('neuron.css'), 'the stylesheet is opt-in for full documents');
  assert.ok(!html.includes('neuron-view'), 'no wrapper around a full document');

  // neuron.js is guarded like htmx.js: session cookie, own session only.
  assert.equal((await fetch(`${srv.origin}/views/${s.id}/neuron.js`)).status, 401, 'neuron.js without a cookie -> 401');
  assert.equal((await api(writer, `/views/${s.id}/neuron.js`)).status, 403, 'cross-view neuron.js -> 403');
  const js = await api(s, `/views/${s.id}/neuron.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /application\/javascript/);
  assert.equal(js.headers.get('cache-control'), 'no-store', 'same caching as htmx.js');
  assert.match(await js.text(), /window\.neuron = /);
  sessions.revoke(s.id);
}

// Cross-view isolation: writer's cookie cannot pull reader's assets
assert.equal((await api(writer, `/views/${reader.id}/htmx.js`)).status, 403, 'cross-view asset access -> 403');
assert.equal((await api(reader, `/views/${reader.id}/htmx.js`)).status, 200);
assert.equal((await fetch(`${srv.origin}/views/${reader.id}/htmx.js`)).status, 401, 'htmx.js without a cookie -> 401');

// Context + capability enforcement
const context = await (await api(reader, '/api/v1/context')).json();
assert.equal(context.apiVersion, 1);
assert.ok(context.capabilities.includes('notes.read'));
assert.equal((await api(reader, '/api/v1/files/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/out.txt', content: 'x' }) })).status, 403, 'write without capability -> 403');

// Read paths: allowed, denied by policy, traversal, absolute
assert.equal((await api(reader, '/api/v1/files/content?path=notes/hello.md')).status, 200);
assert.equal((await api(reader, '/api/v1/files/content?path=data/out.txt')).status, 403, 'outside read policy -> 403');
assert.equal((await api(reader, '/api/v1/files/content?path=../secret.txt')).status, 400, 'traversal -> 400');
assert.equal((await api(reader, '/api/v1/files/content?path=C:/Windows/win.ini')).status, 400, 'absolute path -> 400');
assert.equal((await api(unmanifested, '/api/v1/files/content?path=notes/hello.md')).status, 403, 'unmanifested view cannot read files');
assert.equal((await api(unmanifested, '/api/v1/files')).status, 403, 'unmanifested view cannot list files');
assert.equal((await api(unmanifested, '/api/v1/search?query=needle')).status, 403, 'unmanifested view cannot search');
assert.equal((await api(unmanifested, '/api/v1/notes')).status, 403, 'unmanifested view cannot read note metadata');
assert.equal((await api(unmanifested, '/api/v1/tags')).status, 403, 'unmanifested view cannot read tags');
assert.equal((await api(unmanifested, '/api/v1/variables')).status, 403, 'unmanifested view cannot read variables');
assert.equal((await api(unmanifested, '/api/v1/fragments/workspace-summary')).status, 403, 'unmanifested view cannot read the built-in workspace summary');

// Search: JSON + HTML fragment shapes, results are escaped
assert.equal((await api(reader, `/api/v1/files?glob=${encodeURIComponent('?'.repeat(512))}`)).status, 200, '512-character glob is accepted');
assert.equal((await api(reader, `/api/v1/files?glob=${encodeURIComponent('?'.repeat(513))}`)).status, 400, 'glob longer than 512 characters is refused');
writeFileSync(join(ws, 'notes', 'hello.md.123.456.abcdef.tmp'), 'partial save');
const visibleFiles = await (await api(mkSession(READ_CAPS, ['**']), '/api/v1/files')).json();
assert.ok(!visibleFiles.files.some((file) => file.path.endsWith('.tmp')), 'view file lists hide save temp files');
const searchJson = await (await api(reader, '/api/v1/search?query=needle')).json();
assert.equal(searchJson.results.length, 1);
assert.equal(searchJson.results[0].path, 'notes/hello.md');
const searchHtml = await (await api(reader, '/api/v1/search?query=needle', { headers: { 'HX-Request': 'true' } })).text();
assert.match(searchHtml, /neuron-list/);

// Notes + tags
const notes = await (await api(reader, '/api/v1/notes?tag=beta')).json();
assert.equal(notes.notes.length, 1);
const tags = await (await api(reader, '/api/v1/tags')).json();
assert.deepEqual(tags.tags, ['alpha', 'beta']);

// Fragments: registry by id, interpolation escaped, hostile names rejected
const frag = await (await api(reader, '/api/v1/fragments/greet?who=<script>')).text();
assert.equal(frag, '<p>Ops &lt;Dash&gt; / &lt;script&gt;</p>');
assert.equal((await api(reader, '/api/v1/fragments/..%2F..%2Fetc')).status, 404, 'fragment ids cannot be paths');

// A fragment must not leak variables to a view that was denied variables.read.
// The document path and the variables API both gate on that capability; before
// this check the fragment path interpolated them unconditionally, so a denied
// view could read every variable value by requesting any fragment.
{
  const noVars = mkSession(READ_CAPS.filter((c) => c !== 'variables.read'), ['notes/**', 'dash.html']);
  const denied = await (await api(noVars, '/api/v1/fragments/greet?who=me')).text();
  assert.equal(denied, '<p> / me</p>', 'fragment must blank variables without variables.read');
  assert.ok(!denied.includes('Ops'), 'variable value leaked through a fragment');
  // Denial degrades the fragment, it does not break the view: params still work
  // and the response is still a 200 fragment, not an error.
  assert.equal((await api(noVars, '/api/v1/fragments/greet')).status, 200);
}

// Database route: renders one table, capability-gated, path-policy checked.
{
  writeFileSync(join(ws, 'notes', 'Plan.db'), JSON.stringify({
    version: 2,
    tables: {
      tasks: { name: 'Tasks', schema: { order: ['title', 'status'], properties: { title: { name: 'Title' }, status: { name: 'Status' } } },
               rows: [{ id: 't1', values: { title: '<script>x</script>', status: 'Todo' } }] },
      projects: { name: 'Projects', schema: { order: ['name'], properties: { name: { name: 'Name' } } }, rows: [] },
    },
  }));

  const json = await (await api(reader, '/api/v1/db?path=notes/Plan.db&table=tasks')).json();
  assert.deepEqual(json.tables, ['tasks', 'projects'], 'lists every table');
  assert.equal(json.columns[0].name, 'Title', 'uses the property display name');

  // htmx gets HTML, and every cell is escaped -- a row is untrusted content.
  const frag = await (await api(reader, '/api/v1/db?path=notes/Plan.db&table=tasks', { headers: { 'hx-request': 'true' } })).text();
  assert.ok(frag.includes('<table'), 'htmx gets a table fragment');
  assert.ok(frag.includes('&lt;script&gt;'), 'cells are escaped');
  assert.ok(frag.includes('<td>Todo</td>'), 'cell VALUES render, not just headers');
  assert.ok(!frag.includes('<script>'), 'no raw script survives a cell');

  // A multi-table file must not silently pick one.
  assert.equal((await api(reader, '/api/v1/db?path=notes/Plan.db')).status, 400, 'ambiguous table -> 400');
  assert.equal((await api(reader, '/api/v1/db?path=notes/Plan.db&table=nope')).status, 404, 'unknown table -> 404');

  // Same gates as every other read: capability, then path policy. Assert the
  // error CODE, not just the status -- both gates answer 403, so a status-only
  // check passes even with the capability check deleted. It did, when tried.
  const denied = await (await api(unmanifested, '/api/v1/db?path=notes/Plan.db')).json();
  assert.equal(denied.error.code, 'missing_capability', 'capability is checked before anything else');
  const offPolicy = await (await api(reader, '/api/v1/db?path=data/out.txt')).json();
  assert.equal(offPolicy.error.code, 'path_not_allowed', 'path policy still applies');

  // A v1 file (schema at the root) reads as its single table.
  writeFileSync(join(ws, 'notes', 'Old.db'), JSON.stringify({ schema: { order: ['a'], properties: { a: { name: 'A' } } }, rows: [{ id: 'r1', values: { a: 'cell-one' } }] }));
  const v1 = await (await api(reader, '/api/v1/db?path=notes/Old.db')).json();
  assert.equal(v1.rows.length, 1, 'v1 database reads without a table name');
  assert.equal(v1.rows[0].values.a, 'cell-one', 'v1 rows expose their values');
}

// The neuron.js helper, run against the live server: parsed JSON on success, an
// Error carrying the server's message and HTTP status on failure, and no access
// the session does not already have.
{
  const s = mkSession(['workspace.files.read'], ['notes/**']);
  const win = {};
  const viewFetch = (u, init) => fetch(srv.origin + u, { ...init, headers: { ...init.headers, ...cookie(s) } });
  new Function('window', 'fetch', m.NEURON_VIEW_JS)(win, viewFetch);
  const { neuron } = win;
  assert.equal(neuron.theme, null, 'theme is unknown until context() resolves');
  const ctx = await neuron.context();
  assert.equal(ctx.apiVersion, 1);
  assert.equal(neuron.theme, 'dark', 'theme is cached from context()');
  const file = await neuron.read('notes/hello.md');
  assert.ok(file.content.startsWith('# Hello world') && file.hash, 'read returns content and hash');
  const table = await neuron.db('notes/Plan.db', { table: 'tasks' });
  assert.equal(table.rows[0].values.status, 'Todo');
  await assert.rejects(neuron.read('data/out.txt'), (e) => e instanceof Error && e.status === 403 && /allowed read paths/.test(e.message), 'off-policy read rejects with the server message');
  await assert.rejects(neuron.write('notes/hello.md', 'x'), (e) => e.status === 403 && e.code === 'missing_capability', 'the helper grants nothing');
  await assert.rejects(neuron.tags(), (e) => e.status === 403);
  assert.ok(Object.isFrozen(neuron));
  sessions.revoke(s.id);
}

// Variables: read, write-protected, writable roundtrip, type checks
const dashTitle = await (await api(reader, '/api/v1/variables/dashboardTitle')).json();
assert.equal(dashTitle.value, 'Ops <Dash>');
assert.equal((await api(reader, '/api/v1/variables/projectStatus', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x' }) })).status, 403, 'variables.write required');
assert.equal((await api(writer, '/api/v1/variables/dashboardTitle', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x' }) })).status, 403, 'non-writable variable protected');
const variablesBefore = readFileSync(join(ws, '.neuron', 'variables.json'), 'utf8');
assert.equal((await api(writer, '/api/v1/variables/projectStatus', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'paused' }) })).status, 200);
const variablesPreImage = m.listJournalEntries(ws).find((entry) => entry.relativePath === '.neuron/variables.json');
assert.equal(variablesPreImage?.operation, 'overwrite');
assert.equal(variablesPreImage?.sha256, m.sha256(variablesBefore), 'journal preserves variables before the view changed them');
assert.equal((await (await api(writer, '/api/v1/variables/projectStatus')).json()).value, 'paused');
// htmx callers get an HTML confirmation to swap in (feedback), not silent JSON.
{
  const res = await api(writer, '/api/v1/variables/projectStatus', { method: 'PUT', headers: { 'content-type': 'application/json', 'HX-Request': 'true' }, body: JSON.stringify({ value: 'done' }) });
  assert.match(res.headers.get('content-type') ?? '', /text\/html/, 'htmx PUT returns HTML');
  const frag = await res.text();
  assert.ok(frag.includes('done'), 'confirmation names the new value for the view to announce');
}

// File writes: create, conflict detection, delete; write policy enforced
assert.equal((await api(writer, '/api/v1/files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'notes/new.md', content: 'x' }) })).status, 403, 'outside write policy -> 403');
const created = await api(writer, '/api/v1/files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/made.txt', content: 'hello' }) });
assert.equal(created.status, 201);
assert.ok(!m.listJournalEntries(ws).some((entry) => entry.relativePath === 'data/made.txt'), 'a newly created file has no pre-image');
const { hash } = await created.json();
assert.equal((await api(writer, '/api/v1/files/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/made.txt', content: 'v2', baseHash: 'stale' }) })).status, 409, 'stale baseHash -> 409');
assert.equal((await api(writer, '/api/v1/files/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'data/made.txt', content: 'v2', baseHash: hash }) })).status, 200);
assert.equal((await api(writer, '/api/v1/files?path=data/made.txt', { method: 'DELETE' })).status, 200);

// Quick capture, as the dashboard performs it: read a .db, append a row, PUT it
// back under its own hash. The route is generic file I/O, so nothing else
// proves that a database survives the round trip -- a capture that writes valid
// JSON but the wrong row shape leaves a table with a blank line in it.
{
  const dbPath = 'data/Capture.db';
  const seed = {
    version: 2,
    tables: {
      tasks: {
        name: 'Tasks',
        schema: { order: ['title', 'status'], properties: { title: { name: 'Title' }, status: { name: 'Status' } } },
        rows: [{ id: 't1', values: { title: 'Existing', status: 'todo' } }],
      },
    },
  };
  writeFileSync(join(ws, 'data', 'Capture.db'), JSON.stringify(seed, null, 2));

  const read = await api(writer, `/api/v1/files/content?path=${dbPath}`);
  assert.equal(read.status, 200, 'capture reads the database it is about to rewrite');
  const { content, hash: baseHash } = await read.json();

  const doc = JSON.parse(content);
  doc.tables.tasks.rows.push({ id: 't2', values: { title: 'Captured', status: 'todo' } });
  const put = await api(writer, '/api/v1/files/content', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: dbPath, content: JSON.stringify(doc, null, 2), baseHash }),
  });
  assert.equal(put.status, 200, 'capture writes the database back');

  // The row has to come back through the database route, not just the file
  // route: that is what proves the shape is right rather than merely valid JSON.
  const table = await (await api(writer, `/api/v1/db?path=${dbPath}&table=tasks`)).json();
  assert.equal(table.rows.length, 2, 'captured row is in the table');
  assert.equal(table.rows[1].values.title, 'Captured');

  // Second capture from the same stale hash is refused -- two dashboards open
  // on one database must not silently drop one of the two writes.
  const stale = await api(writer, '/api/v1/files/content', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: dbPath, content: '{}', baseHash }),
  });
  assert.equal(stale.status, 409, 'a capture against a stale hash is refused');
}
assert.equal((await api(writer, '/api/v1/files/content?path=data/made.txt')).status, 404);

// The API answers under the view prefix as well as at the root.
//
// A view document is served at /views/{sid}/document, so a relative
// "./api/v1/db" written inside it resolves to /views/{sid}/api/v1/db. That is
// the natural thing for an author to write and it used to fall through to the
// static asset handler and 404, which reads as a broken API rather than a
// mis-addressed one. The demo dashboard shipped that way and its fetch had
// never once succeeded in the app.
{
  const prefixed = await api(reader, `/views/${reader.id}/api/v1/context`);
  assert.equal(prefixed.status, 200, 'the API answers under the view prefix');
  const body = await prefixed.json();
  assert.ok(body.apiVersion && body.view, 'and it is the same API, not a lookalike');

  // The prefix must not become a way around anything. Same capability gate:
  assert.equal(
    (await api(reader, `/views/${reader.id}/api/v1/files/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'data/out.txt', content: 'x' }),
    })).status,
    403,
    'prefixed writes are still capability-checked',
  );
  // ...and still another view's session id is refused before the route runs.
  assert.equal(
    (await api(reader, `/views/${writer.id}/api/v1/context`)).status,
    403,
    'a view cannot address the API through another session id',
  );
}

// Rate limiting: hammering one session eventually 429s
{
  const s = mkSession(READ_CAPS, ['**']);
  let limited = false;
  for (let i = 0; i < 60; i++) {
    if ((await api(s, '/api/v1/context')).status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'burst of requests should hit the rate limit');
}

// Revocation: closing the tab kills the token immediately
sessions.revoke(reader.id);
assert.equal((await api(reader, '/api/v1/context')).status, 401, 'revoked session -> 401');

srv.close();
rmSync(ws, { recursive: true, force: true });
rmSync(outside, { recursive: true, force: true });
console.log(`htmx-views: all checks passed${symlinksWork ? '' : ' (symlink test skipped: no privilege)'}`);
