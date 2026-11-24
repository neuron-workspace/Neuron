// Real loopback HTTP requests, real workspace policy/trust, no Electron.
import { build } from 'esbuild';
import * as fs from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = fs.mkdtempSync(join(root, 'tools/.adversarial-'));
const ws = join(scratch, 'workspace');
const ud = join(scratch, 'userData');
for (const dir of [ws, ud, '.git', '.neuron/styles', '.neuron/fragments', '.neuron/journal']) {
  fs.mkdirSync(dir === ws || dir === ud ? dir : join(ws, dir), { recursive: true });
}
const put = (name, data) => fs.writeFileSync(join(ws, name), data);
put('view.html', '<p>trusted view</p>');
put('note.md', 'workspace needle');
put('.git/secret.md', 'OUTSIDE_SENTINEL needle');
put('.neuron/journal/ordinary.md', 'ordinary workspace needle');
put('.neuron/styles/test.css', 'p { color: red }');
put('.neuron/fragments/test.html', '<p>{{ params.safe }}{{ params.constructor }}{{ params.__proto__ }}</p>');
put('.neuron/variables.json', JSON.stringify({ version: 1, variables: { value: { type: 'object', value: {}, writable: true } } }));
fs.writeFileSync(join(ud, 'settings.json'), 'OUTSIDE_SENTINEL needle');
fs.writeFileSync(join(ud, 'secret.md'), 'OUTSIDE_SENTINEL needle');
const bundle = join(scratch, 'server.mjs');
await build({ stdin: { contents: `export * from './src/main/htmx/server'; export * from './src/main/htmx/sessions'; export * from './src/main/htmx/pathPolicy'; export * from './src/main/htmx/trust'; export * from './src/main/safe-fs'; export * from './src/main/journal';`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: bundle });
const m = await import(pathToFileURL(bundle));
const journal = m.configureWriteJournal(ud);
const captured = journal.capturePreImage(ws, join(ws, 'note.md'), 'overwrite');
assert.equal(captured.status, 'captured');
const store = join(ud, 'journal', fs.readdirSync(join(ud, 'journal'))[0]);
const outsideSnapshot = () => fs.readdirSync(ud, { recursive: true }).filter(p => fs.statSync(join(ud, p)).isFile()).map(p => [p, fs.readFileSync(join(ud, p)).toString('hex')]);
const baseline = outsideSnapshot();
const caps = ['workspace.files.read', 'workspace.files.write', 'workspace.files.create', 'workspace.files.delete', 'workspace.directories.list', 'workspace.search', 'notes.read', 'tags.read', 'variables.read', 'variables.write'];
const sessions = new m.SessionManager();
const make = (permissions = caps) => sessions.create({ root: ws, viewPath: 'view.html', name: 'adversarial', theme: 'dark', caps: new Set(permissions), readPolicy: [m.compileGlob('**')], writePolicy: [m.compileGlob('**')], trusted: m.computeTrust(ws, 'view.html').files });
const srv = await m.createViewServer(sessions, join(root, 'node_modules/htmx.org/dist/htmx.min.js'));
// Raw http keeps encoded URL segments intact (fetch normalizes dot segments).
function call(url, { session = make(), method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(srv.origin + url, { method, headers: { ...(session ? { Cookie: `nv=${session.id}:${session.cookieToken}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
const refused = (res, label) => {
  assert.ok([400, 401, 403, 404, 413, 414, 431].includes(res.status), `${label}: ${res.status} ${res.text}`);
  assert.ok(!res.text.includes('OUTSIDE_SENTINEL'), label);
};

try {
  await test('traversal: every path route contains real userData, settings and journal', async () => {
    // Junctions require no symlink privilege on Windows; failure is a failed test.
    fs.symlinkSync(ud, join(ws, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(store, join(ws, 'history'), process.platform === 'win32' ? 'junction' : 'dir');
    const bad = ['..', '../userData/settings.json', '..\\userData\\settings.json', 'sub/..\\../userData/settings.json', '/etc/passwd', 'C:/Windows/win.ini', 'C:\\Windows\\win.ini', '\\\\server\\share', 'a\0b', 'a%00b', 'a'.repeat(1100), '.git', '.git/secret.md', '.GIT/secret.md', 'escape/settings.json', `history/${captured.entry.id}.bin`, join(ud, 'settings.json'), join(store, `${captured.entry.id}.bin`), '.neuron/journal/../../../userData/settings.json'];
    if (['win32', 'darwin'].includes(process.platform)) bad.push('ESCAPE/SETTINGS.JSON', 'HISTORY/' + captured.entry.id + '.bin');
    // Encoding belongs to the transport. Double encoding leaves a literal percent
    // filename after one decode; it must never gain traversal semantics.
    for (const p of bad) {
      for (const [route, key] of [['files/content', 'path'], ['files', 'dir'], ['db', 'path']]) {
        refused(await call(`/api/v1/${route}?${key}=${encodeURIComponent(p)}`), `${route} ${p}`);
      }
      refused(await call(`/api/v1/files?path=${encodeURIComponent(p)}`, { method: 'DELETE' }), `delete ${p}`);
      for (const [route, method] of [['files/content', 'PUT'], ['files', 'POST']]) {
        refused(await call(`/api/v1/${route}`, { method, body: JSON.stringify({ path: p, content: 'ATTACK' }) }), `${method} ${p}`);
      }
      const styleSession = make();
      refused(await call(`/views/${styleSession.id}/styles/${encodeURIComponent(p)}.css`, { session: styleSession }), `style ${p}`);
      refused(await call(`/api/v1/fragments/${encodeURIComponent(p)}`), `fragment ${p}`);
      const search = await call(`/api/v1/search?query=${encodeURIComponent(p)}`);
      assert.equal(search.status, 200);
      assert.deepEqual(search.json().results, []);
      const notes = await call(`/api/v1/notes?folder=${encodeURIComponent(p)}`);
      assert.equal(notes.status, 200);
      assert.deepEqual(notes.json().notes, []);
    }
    for (const p of ['%2e%2e%2fuserData%2fsettings.json', '%252e%252e%252fuserData%252fsettings.json']) {
      for (const [route, key] of [['files/content', 'path'], ['files', 'dir'], ['db', 'path']]) {
        const res = await call(`/api/v1/${route}?${key}=${p}`);
        // A literal nonexistent directory can list as empty; no decoding twice.
        if (route === 'files' && res.status === 200) assert.deepEqual(res.json().files, []);
        else refused(res, `${route} ${p}`);
      }
      refused(await call(`/api/v1/files?path=${p}`, { method: 'DELETE' }), `encoded delete ${p}`);
      const s = make();
      refused(await call(`/views/${s.id}/styles/${p}.css`, { session: s }), `encoded style ${p}`);
      refused(await call(`/api/v1/fragments/${p}`), `encoded fragment ${p}`);
      assert.deepEqual((await call(`/api/v1/search?query=${p}`)).json().results, []);
      // JSON does not URL-decode. A double-encoded URL denotes this literal
      // percent filename, not an outside path; preserve ordinary filenames.
      const literal = decodeURIComponent(p);
      const body = JSON.stringify({ path: literal, content: 'literal filename' });
      refused(await call('/api/v1/files/content', { method: 'PUT', body }), 'encoded update before create');
      const create = await call('/api/v1/files', { method: 'POST', body });
      if (literal.startsWith('..')) refused(create, 'decoded traversal create');
      else {
        assert.equal(create.status, 201);
        assert.equal(fs.readFileSync(join(ws, literal), 'utf8'), 'literal filename');
        assert.equal((await call('/api/v1/files/content', { method: 'PUT', body })).status, 200);
        assert.equal((await call(`/api/v1/files/content?path=${p}`)).json().content, 'literal filename');
        assert.equal((await call(`/api/v1/files?path=${p}`, { method: 'DELETE' })).status, 200);
      }
    }
    for (const route of ['files', 'search?query=needle', 'notes', 'tags']) {
      const res = await call(`/api/v1/${route}`);
      assert.equal(res.status, 200);
      assert.ok(!res.text.includes('OUTSIDE_SENTINEL'));
      assert.ok(!res.text.includes('escape/') && !res.text.includes('history/') && !res.text.includes('.git/'));
      if (route.startsWith('search')) assert.ok(res.json().results.some(row => row.path === 'note.md'));
    }
    // Updating the literal workspace file may legitimately journal it; external
    // settings and the pre-existing real journal entry must remain byte-identical.
    const after = new Map(outsideSnapshot());
    for (const [name, bytes] of baseline) assert.equal(after.get(name), bytes, `outside file unchanged: ${name}`);
    assert.equal(fs.readFileSync(join(ws, '.git/secret.md'), 'utf8'), 'OUTSIDE_SENTINEL needle');
  });

  await test('ordinary workspace journal paths still support read, update, create, list and delete', async () => {
    const p = '.neuron/journal/ordinary.md';
    assert.equal((await call(`/api/v1/files/content?path=${p}`)).json().content, 'ordinary workspace needle');
    assert.equal((await call('/api/v1/files/content', { method: 'PUT', body: JSON.stringify({ path: p, content: 'updated' }) })).status, 200);
    assert.equal((await call('/api/v1/files?dir=.neuron/journal')).json().files[0].path, p);
    const fresh = '.neuron/journal/new.md';
    assert.equal((await call('/api/v1/files', { method: 'POST', body: JSON.stringify({ path: fresh, content: 'new' }) })).status, 201);
    assert.equal((await call(`/api/v1/files?path=${fresh}`, { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(join(ws, fresh)), false);
  });

  await test('prototype pollution: nested JSON, variables, db writes and query keys stay inert', async () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    for (const payload of ['{"__proto__":{"polluted":true}}', '{"constructor":{"prototype":{"polluted":true}}}', '{"nested":{"__proto__":{"polluted":true}}}']) {
      const res = await call('/api/v1/variables/value', { method: 'PUT', body: `{"value":${payload}}` });
      assert.equal(res.status, 400, 'unsafe variable object refused');
      for (const method of ['POST', 'PUT']) {
        put('data.db', '{"version":2,"tables":{}}');
        const response = await call(`/api/v1/${method === 'POST' ? 'files' : 'files/content'}`, { method, body: `{"path":"${method === 'POST' ? 'new.db' : 'data.db'}","content":"{}",${payload.slice(1)}` });
        assert.equal(response.status, 400, 'unsafe db request refused');
      }
      const query = new URLSearchParams({ __proto__: 'ignored', 'constructor.prototype.polluted': 'true', 'nested[__proto__][polluted]': 'true', constructor: 'evil', safe: 'safe' });
      query.set('__proto__', 'evil');
      const fragment = await call(`/api/v1/fragments/test?${query}`);
      assert.equal(fragment.status, 200);
      assert.equal(fragment.text, '<p>safe</p>');
      assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(join(ws, '.neuron/variables.json'))).variables.value.value, {});
    assert.equal(fs.readFileSync(join(ws, 'data.db'), 'utf8'), '{"version":2,"tables":{}}');
    assert.equal(fs.existsSync(join(ws, 'new.db')), false);
  });

  await test('session and token forgery: boot replay, wrong view, origin and immediate revocation', async () => {
    const a = make(), b = make();
    const doc = `/views/${a.id}/document`;
    const boot = a.bootToken;
    assert.equal((await call('/api/v1/context', { session: null })).status, 401);
    for (const token of ['', 'wrong', b.cookieToken, a.cookieToken + 'x']) {
      assert.equal((await call('/api/v1/context', { headers: { Cookie: `nv=${a.id}:${token}` } })).status, 401);
    }
    assert.equal((await call(doc + '?boot=wrong', { session: null })).status, 403);
    assert.equal((await call(doc + '?boot=' + boot, { session: null })).status, 200);
    assert.equal((await call(doc + '?boot=' + boot, { session: null })).status, 403);
    assert.equal((await call(doc, { session: b })).status, 403);
    for (const suffix of ['neuron.js', 'styles/test.css', 'api/v1/files/content?path=note.md']) {
      assert.equal((await call(`/views/${a.id}/${suffix}`, { session: b })).status, 403);
    }
    for (const Origin of ['null', 'https://evil.example', srv.origin + '.evil', 'http://localhost:' + srv.port]) {
      assert.equal((await call('/api/v1/context', { session: a, headers: { Origin } })).status, 403);
    }
    assert.equal((await call('/api/v1/context', { session: a })).status, 200);
    sessions.revoke(a.id);
    assert.equal((await call('/api/v1/context', { session: a })).status, 401);
    assert.equal((await call(doc + '?boot=' + boot, { session: a })).status, 403);
    sessions.revoke(b.id);
    assert.equal((await call(`/views/${b.id}/document?boot=${b.bootToken}`, { session: null })).status, 403);
  });

  await test('revocation while a write body is arriving prevents all subsequent mutations', async () => {
    for (const [route, method, body] of [
      ['files/content', 'PUT', { path: 'note.md', content: 'revoked write' }],
      ['files', 'POST', { path: 'revoked.md', content: 'revoked create' }],
      ['variables/value', 'PUT', { value: { revoked: true } }],
    ]) {
      const session = make();
      const arrived = new Promise(resolve => srv.server.once('request', resolve));
      let req;
      const response = new Promise((resolve, reject) => {
        req = request(srv.origin + '/api/v1/' + route, { method, headers: { Cookie: `nv=${session.id}:${session.cookieToken}`, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.setTimeout(10000, () => req.destroy(new Error('request timed out')));
        req.on('error', reject);
        req.flushHeaders();
      });
      // The server has authenticated and is awaiting readBody at this point.
      await arrived;
      sessions.revoke(session.id);
      req.end(JSON.stringify(body));
      assert.equal(await response, 401, route);
    }
    assert.equal(fs.readFileSync(join(ws, 'note.md'), 'utf8'), 'workspace needle');
    assert.equal(fs.existsSync(join(ws, 'revoked.md')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(join(ws, '.neuron/variables.json'))).variables.value.value, {});
  });

  await test('trust race: changed fragments and styles are refused through safe-fs hook', async () => {
    for (const [rel, route] of [['.neuron/fragments/test.html', '/api/v1/fragments/test'], ['.neuron/styles/test.css', 'styles/test.css']]) {
      const original = fs.readFileSync(join(ws, rel));
      const session = make();
      const url = route.startsWith('/') ? route : `/views/${session.id}/${route}`;
      assert.equal((await call(url, { session })).status, 200);
      let injected = false;
      m.setSafeFsTestHook((phase, file) => {
        if (phase === 'after-open' && relative(ws, file).replaceAll('\\', '/') === rel) {
          injected = true;
          fs.writeFileSync(file, 'UNTRUSTED_CODE');
        }
      });
      try {
        const res = await call(url, { session });
        assert.equal(injected, true);
        assert.equal(res.status, 403);
        assert.ok(!res.text.includes('UNTRUSTED_CODE'));
      } finally { m.setSafeFsTestHook(); fs.writeFileSync(join(ws, rel), original); }
      const untrusted = make();
      untrusted.trusted = new Map();
      assert.equal((await call(route.startsWith('/') ? route : `/views/${untrusted.id}/${route}`, { session: untrusted })).status, 403);
    }
  });

  await test('capabilities: every API gate refuses an ungranted capability', async () => {
    for (const [route, method] of [['files/content?path=note.md', 'GET'], ['files/content', 'PUT'], ['files', 'POST'], ['files?path=note.md', 'DELETE'], ['files', 'GET'], ['search?query=needle', 'GET'], ['notes', 'GET'], ['tags', 'GET'], ['db?path=data.db', 'GET'], ['variables', 'GET'], ['variables/value', 'GET'], ['variables/value', 'PUT'], ['fragments/workspace-summary', 'GET']]) {
      const res = await call('/api/v1/' + route, { session: make([]), method, ...(['PUT', 'POST'].includes(method) ? { body: '{}' } : {}) });
      assert.equal(res.status, 403, route);
      assert.equal(res.json().error.code, 'missing_capability');
    }
  });

  await test('limits: oversized bodies, deep JSON, huge globs and concurrent floods leave server alive', async () => {
    for (const route of ['files', 'files/content', 'variables/value']) {
      try {
        const res = await call('/api/v1/' + route, { method: route === 'files' ? 'POST' : 'PUT', body: JSON.stringify({ path: 'note.md', content: 'x'.repeat(1024 * 1024 + 1), value: {} }) });
        assert.equal(res.status, 413);
      } catch (error) { assert.equal(error.code, 'ECONNRESET', 'body limit may close the socket'); }
    }
    const deep = '{"x":'.repeat(10000) + '0' + '}'.repeat(10000);
    assert.equal((await call('/api/v1/variables/value', { method: 'PUT', body: `{"value":${deep}}` })).status, 400);
    for (const length of [513, 8000]) assert.equal((await call('/api/v1/files?glob=' + '*'.repeat(length))).status, 400);
    // A backtracking-shaped glob just under the cap still answers promptly.
    const started = Date.now();
    const pathological = await call('/api/v1/files?glob=' + encodeURIComponent('*a'.repeat(255)));
    assert.equal(pathological.status, 200);
    assert.ok(Date.now() - started < 5000, 'pathological glob answered promptly');
    const session = make();
    const responses = await Promise.all(Array.from({ length: 100 }, () => call('/api/v1/context', { session })));
    assert.ok(responses.some(r => r.status === 200));
    assert.ok(responses.some(r => r.status === 429), 'concurrent flood is throttled');
    assert.ok(responses.every(r => [200, 429].includes(r.status)));
    assert.equal((await call('/api/v1/files/content?path=note.md')).json().content, 'workspace needle');
  });
} finally {
  m.setSafeFsTestHook();
  await new Promise(resolve => { srv.server.close(resolve); srv.server.closeAllConnections(); });
  fs.rmSync(scratch, { recursive: true, force: true });
}
