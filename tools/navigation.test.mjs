// Runnable check for src/main/navigation.ts -- no test framework needed:
// transpile with vite's bundled esbuild, then assert.
// Run: node tools/navigation.test.mjs
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/main/navigation.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const tmp = join(root, 'tools/.navigation.tmp.mjs');
writeFileSync(tmp, code);
const { isSameOrigin, isAppContent, DEV_URL } = await import(pathToFileURL(tmp));
rmSync(tmp);

// --- isAppContent: the privileged app frame -------------------------------
// Allowed: the dev server itself (development only), and packaged file:// content.
assert.equal(isAppContent(DEV_URL, undefined, false, true), true);
assert.equal(isAppContent(DEV_URL + '/index.html', undefined, false, true), true);
// A packaged app never loads the dev server: whatever answers on that port is
// not Neuron. Packaged is the default, so a call site that forgets the flag
// fails closed.
assert.equal(isAppContent(DEV_URL), false);
assert.equal(isAppContent(DEV_URL + '/index.html'), false);
assert.equal(isAppContent(DEV_URL, 'file:///C:/app/dist/renderer/', true, false), false);
for (const appRoot of ['file:///C:/app/dist/renderer/', 'file:///home/u/app/dist/renderer/']) {
  for (const suffix of ['index.html', 'index.html?x=1', 'index.html#/route']) {
    assert.equal(isAppContent(appRoot + suffix, appRoot), true);
    assert.equal(isAppContent(appRoot + suffix), false);
  }
  for (const bad of [
    appRoot + '../main/x.html',
    appRoot.replace(/\/$/, '-evil/index.html'),
    appRoot + '%2e%2e/main/x.html',
    appRoot + '..%2fmain/x.html',
    appRoot + '%ZZ',
    appRoot.replace('file:///', 'file://remote/'),
  ]) {
    assert.equal(isAppContent(bad, appRoot), false);
  }
}
const appRoot = 'file:///C:/app/dist/renderer/';
assert.equal(isAppContent('file:///C:/tmp/page.html', appRoot), false);
assert.equal(isAppContent('file:///etc/passwd', 'file:///home/u/app/dist/renderer/'), false);
assert.equal(isAppContent('file:///c:/APP/dist/renderer/index.html', appRoot), false);
assert.equal(isAppContent('file:///c:/APP/dist/renderer/index.html', appRoot, true), true);

// Rejected. Every entry here passes a naive startsWith(DEV_URL) test and is the
// reason this module exists -- see the regression assertion at the bottom.
for (const bad of [
  'http://localhost:5174@evil.com/',        // userinfo: real host is evil.com
  'http://localhost:5174@evil.com/steal',
  'http://localhost:51740/',                // port prefix, different port
  'http://localhost:5174.evil.com/',        // unparseable port -> must not throw
  'https://localhost:5174/',                // scheme mismatch
  'http://127.0.0.1:5174/',                 // different host, same port
  'http://evil.com/',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'not a url',
  '',
]) {
  assert.equal(isAppContent(bad), false, `isAppContent must reject ${JSON.stringify(bad)}`);
  assert.equal(isAppContent(bad, undefined, false, true), false, `isAppContent must reject ${JSON.stringify(bad)} in development`);
}

// --- isSameOrigin: pinning an HTMX view to its loopback session -----------
const origin = 'http://127.0.0.1:49152';
assert.equal(isSameOrigin(origin, origin), true);
assert.equal(isSameOrigin(origin + '/views/abc/document', origin), true);
assert.equal(isSameOrigin(origin + '/api/v1/context?q=1', origin), true);

for (const bad of [
  'http://127.0.0.1:49152@evil.com/',  // userinfo again
  'http://127.0.0.1:491520/',          // port prefix
  'http://127.0.0.1:49153/',           // neighbouring view server
  'https://127.0.0.1:49152/',
  'http://localhost:49152/',           // localhost !== 127.0.0.1 as an origin
  'file:///etc/passwd',
  'garbage',
]) {
  assert.equal(isSameOrigin(bad, origin), false, `isSameOrigin must reject ${JSON.stringify(bad)}`);
}

// A null/undefined origin means "no view server running" -> deny, never allow.
assert.equal(isSameOrigin(origin, null), false);
assert.equal(isSameOrigin(origin, undefined), false);
assert.equal(isSameOrigin(origin, ''), false);

// Regression guard: prove the old prefix check would have accepted the bypasses
// these functions now reject. If this ever stops holding, the test data above
// has drifted away from the bug it exists to prevent.
for (const bypass of ['http://localhost:5174@evil.com/', 'http://localhost:51740/']) {
  assert.equal(bypass.startsWith(DEV_URL), true, 'test data no longer exercises the prefix bug');
  assert.equal(isAppContent(bypass, undefined, false, true), false);
}

// Execute the actual Electron wiring: a policy-only test cannot detect an
// omitted event subscription (HTTP redirects do not emit will-navigate).
const main = readFileSync(join(root, 'src/main/main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
const wiring = ast.statements.find((node) => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'app.on'
  && node.expression.arguments[0]?.text === 'web-contents-created');
assert.ok(wiring, 'web-contents-created guard exists');
const compiled = ts.transpileModule(wiring.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let navigationCases = 0;
for (const isDev of [false, true]) {
  for (const type of ['app', 'view', 'browser']) {
    const listeners = new Map();
    const external = [];
    let openWindow;
    let permission;
    const contents = {
      on: (event, fn) => listeners.set(event, fn),
      getURL: () => type === 'view' ? origin + '/views/session/document' : type === 'app' ? appRoot + 'index.html' : 'https://example.com',
      getType: () => type === 'app' ? 'window' : 'webview',
      setWindowOpenHandler: (fn) => { openWindow = fn; },
      session: { setPermissionRequestHandler: (fn) => { permission = fn; } },
    };
    vm.runInNewContext(compiled, {
      app: { on: (_event, fn) => fn({}, contents) },
      getViewServerOrigin: () => origin, isSameOrigin, isAppContent,
      RENDERER_ROOT: appRoot, IS_DEV: isDev, process,
      shell: { openExternal: (url) => external.push(url) },
    });
    assert.equal(typeof listeners.get('will-redirect'), 'function');
    assert.equal(listeners.get('will-navigate'), listeners.get('will-redirect'), 'identical redirect policy');
    const destinations = [
      [origin + '/views/session/next', false, true], [origin + '/api/v1/context', false, true],
      [appRoot + 'index.html', true, false], [appRoot + 'index.html#/route', true, false],
      [DEV_URL + '/next', isDev, false],
      ...['http://localhost:5174@evil.com/', 'http://localhost:51740/', 'https://localhost:5174/',
        'http://127.0.0.1:5174/', 'http://127.0.0.1:49152@evil.com/', 'http://127.0.0.1:49153/',
        'https://127.0.0.1:49152/', 'http://localhost:49152/', 'https://example.com/',
        'file:///C:/secret.txt', appRoot + '../main/x.html', appRoot + '..%2fmain/x.html',
        'javascript:alert(1)', 'data:text/html,hello', 'about:blank', 'not a url'].map((url) => [url, false, false]),
    ];
    for (const eventName of ['will-navigate', 'will-redirect']) {
      for (const [url, appAllowed, viewAllowed] of destinations) {
        let prevented = false;
        external.length = 0;
        listeners.get(eventName)({ preventDefault: () => { prevented = true; } }, url);
        const allowed = type === 'app' ? appAllowed : type === 'view' ? viewAllowed : true;
        assert.equal(prevented, !allowed, `${type} dev=${isDev} ${eventName}: ${url}`);
        assert.deepEqual(external, type === 'app' && !allowed && /^https?:\/\//.test(url) ? [url] : []);
        navigationCases++;
      }
    }
    for (const url of ['https://example.com/', 'http://example.com/', 'file:///secret', 'javascript:alert(1)', 'data:text/html,hello']) {
      external.length = 0;
      assert.equal(openWindow({ url }).action, 'deny');
      assert.deepEqual(external, type !== 'view' && /^https?:\/\//.test(url) ? [url] : []);
    }
    const prefs = { preload: '/malicious.js', nodeIntegration: true, contextIsolation: false, sandbox: false };
    listeners.get('will-attach-webview')({}, prefs);
    assert.deepEqual(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true });
    if (type !== 'app') permission({}, 'camera', (allowed) => assert.equal(allowed, false));
  }
}
console.log(`navigation: origin checks and ${navigationCases} navigation/redirect decisions, popup, webview and permission guards passed`);
