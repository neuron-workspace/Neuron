// Runnable check for src/main/navigation.ts -- no test framework needed:
// transpile with vite's bundled esbuild, then assert.
// Run: node tools/navigation.test.mjs
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/main/navigation.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const tmp = join(root, 'tools/.navigation.tmp.mjs');
writeFileSync(tmp, code);
const { isSameOrigin, isAppContent, DEV_URL } = await import(pathToFileURL(tmp));
rmSync(tmp);

// --- isAppContent: the privileged app frame -------------------------------
// Allowed: the dev server itself, and packaged file:// content.
assert.equal(isAppContent(DEV_URL), true);
assert.equal(isAppContent(DEV_URL + '/index.html'), true);
assert.equal(isAppContent('file:///C:/app/dist/renderer/index.html'), true);
assert.equal(isAppContent('file:///home/u/app/index.html'), true);

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
  assert.equal(isAppContent(bypass), false);
}

console.log('navigation: all checks passed');
