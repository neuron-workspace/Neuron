// Runnable checks for the HTMX view platform (src/main/htmx/*): path policy,
// manifest validation, token/session lifecycle, HTML escaping, and a live
// integration pass against the loopback view server. No test framework —
// bundle with vite's esbuild, then assert. Run: node tools/htmx-views.test.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
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
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
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

// --- relative path normalization ----------------------------------------------
assert.equal(m.normalizeRel('notes/a.md'), 'notes/a.md');
assert.equal(m.normalizeRel('.\\notes\\a.md'), 'notes/a.md');
for (const bad of ['..', '../x', 'a/../../x', '/etc/passwd', 'C:/Windows', 'C:\\x', '\\\\server\\share', '~/secrets', 'a\0b', 'a%00b', '', 42, null]) {
  assert.equal(m.normalizeRel(bad), null, `normalizeRel should reject: ${String(bad)}`);
}
assert.equal(m.normalizeRelDir(''), '');
assert.equal(m.normalizeRelDir('..'), null);

// --- workspace resolution + symlink escapes ------------------------------------
const ws = mkdtempSync(join(tmpdir(), 'neuron-htmx-ws-'));
const outside = mkdtempSync(join(tmpdir(), 'neuron-htmx-out-'));
mkdirSync(join(ws, 'notes'), { recursive: true });
writeFileSync(join(ws, 'notes', 'hello.md'), '# Hello world\n\nA note with #alpha and #beta tags. Searchable needle here.\n');
writeFileSync(join(ws, 'notes', 'other.md'), '# Other\n\n#alpha only.\n');
writeFileSync(join(outside, 'secret.txt'), 'top secret');

assert.ok(m.resolveInWorkspace(ws, 'notes/hello.md'));
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
const noManifestGrants = m.effectiveGrants(null);
assert.deepEqual([...noManifestGrants.caps], [], 'an unmanifested view gets no capabilities');
assert.deepEqual(noManifestGrants.readPatterns, [], 'an unmanifested view gets no readable paths');
assert.ok(!noManifestGrants.needsApproval, 'an unmanifested view renders without an empty prompt');

// --- view + manifest paths (plain files vs folder apps) -----------------------
assert.ok(m.isViewPath('report.html'), 'plain .html opens as a view');
assert.ok(m.isViewPath('Launch board/index.html'), 'a folder app uses index.html');
assert.ok(!m.isViewPath('notes/readme.md'), 'plain notes are not views');
assert.ok(!m.isViewPath('notes/readme.htm'), 'only the .html extension is a view');
assert.equal(m.appManifestPathFor('Launch board/index.html'), 'Launch board/neuron.app.json');
assert.equal(m.appManifestPathFor('index.html'), null, 'the workspace root cannot be a folder app');
assert.equal(m.appManifestPathFor('Launch board/report.html'), null, 'only index.html can be a folder app entry');
// Plain-view manifests mirror their path under .neuron/manifests:
assert.equal(m.manifestPathFor('projects/tracker.html'), '.neuron/manifests/projects/tracker.json');
assert.equal(m.manifestPathFor('projects/index.html'), '.neuron/manifests/projects/index.json');
// A folder app's manifest is the co-located marker, never under .neuron:
assert.equal(m.manifestPathFor('Launch board/index.html', true), 'Launch board/neuron.app.json');
assert.equal(m.legacyManifestPathFor('projects/tracker.html'), 'projects/tracker.neuron.json');
assert.equal(m.defaultViewName('Launch board/index.html', true), 'Launch board', 'folder app is named for its folder');
assert.equal(m.defaultViewName('a/b/Report.html'), 'Report', 'plain view is named for its file');

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

// Cross-view isolation: writer's cookie cannot pull reader's assets
assert.equal((await api(writer, `/views/${reader.id}/htmx.js`)).status, 403, 'cross-view asset access -> 403');
assert.equal((await api(reader, `/views/${reader.id}/htmx.js`)).status, 200);

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

// Variables: read, write-protected, writable roundtrip, type checks
const dashTitle = await (await api(reader, '/api/v1/variables/dashboardTitle')).json();
assert.equal(dashTitle.value, 'Ops <Dash>');
assert.equal((await api(reader, '/api/v1/variables/projectStatus', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x' }) })).status, 403, 'variables.write required');
assert.equal((await api(writer, '/api/v1/variables/dashboardTitle', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x' }) })).status, 403, 'non-writable variable protected');
assert.equal((await api(writer, '/api/v1/variables/projectStatus', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'paused' }) })).status, 200);
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
