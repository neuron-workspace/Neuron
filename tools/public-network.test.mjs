import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/main/public-network.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const calls = [];
let lookups = 0;
let answers = [{ address: '8.8.8.8', family: 4 }];
let redirects = [];
const exports = {};
vm.runInNewContext(outputText, { exports, URL, Buffer, setTimeout, clearTimeout, require: (name) => {
  if (name === 'node:dns') return { promises: { lookup: async (_host, options) => {
    lookups++;
    assert.equal(options.all, true);
    return answers;
  } } };
  if (name === 'node:http' || name === 'node:https') return { request: (url, options, receive) => {
    calls.push({ url: url.href, options });
    for (const all of [true, false]) options.lookup(url.hostname, { all }, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(all ? address[0].address : address, '8.8.8.8', 'socket lookup uses the vetted answer');
      if (!all) assert.equal(family, 4);
    });
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = () => {};
    request.end = () => {
      const response = new EventEmitter();
      const redirect = redirects.shift();
      response.statusCode = redirect ? 302 : 200;
      response.headers = redirect ? { location: redirect } : {};
      response.resume = () => {};
      receive(response);
      response.emit('data', Buffer.from('ok'));
      response.emit('end');
    };
    return request;
  } };
  return require(name);
} });
const { isBlockedAddress, requestPublic, BODY_LIMIT, RESPONSE_TOO_LARGE, REQUEST_TOO_LARGE, REQUEST_TOO_SLOW } = exports;
assert.equal(BODY_LIMIT, 10 * 1024 * 1024);
const blocked =['127.0.0.1', '127.255.255.255', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.255.255'];
for (const ip of blocked) {
  assert.equal(isBlockedAddress(ip), true, ip);
  assert.equal(isBlockedAddress(`::ffff:${ip}`), true, `mapped ${ip}`);
}
for (const ip of ['::', '::1', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::127.0.0.1', '::a9fe:a9fe', '64:ff9b::10.0.0.1', '64:ff9b::7f00:1', 'invalid']) assert.equal(isBlockedAddress(ip), true, ip);
// Zone ids and bracketed literals are not addresses a lookup answers with: they fail closed.
for (const ip of ['fe80::1%eth0', 'fe80::1%1', '2001:4860:4860::8888%eth0', '[::1]', '[fe80::1]', '[2001:4860:4860::8888]', '[127.0.0.1]']) assert.equal(isBlockedAddress(ip), true, ip);
for (const ip of ['8.8.8.8', '172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8']) assert.equal(isBlockedAddress(ip), false, ip);
assert.equal((await requestPublic({ url: 'https://public.example/path' })).body, 'ok');
assert.equal(calls[0].options.agent, false);
await requestPublic({ url: 'https://public.example/post', method: 'POST', body: 'é' });
assert.equal(calls[1].options.headers['content-length'], '2', 'string bodies keep a byte length, as fetch sent');
calls.length = 1;
answers = [...answers, { address: '127.0.0.1', family: 4 }];
await assert.rejects(() => requestPublic({ url: 'https://mixed.example' }), /public network/);
assert.equal(calls.length, 1, 'one blocked DNS answer refuses the whole request');
answers = [{ address: '8.8.8.8', family: 4 }];
redirects = ['http://127.0.0.1'];
// Model DNS resolving the redirect's literal address on the second lookup.
Object.defineProperty(answers, '0', { get() {
  return calls.length > 1 ? { address: '127.0.0.1', family: 4 } : { address: '8.8.8.8', family: 4 };
} });
await assert.rejects(() => requestPublic({ url: 'https://public.example' }), /public network/);
assert.equal(calls.length, 2, 'blocked redirect is never connected');
answers = [{ address: '8.8.8.8', family: 4 }];
redirects = Array(6).fill('/again');
await assert.rejects(() => requestPublic({ url: 'https://public.example' }), /Too many redirects/);
await assert.rejects(() => requestPublic({ url: 'file:///secret' }), /http\(s\)/);

// A request body over 10 MB is refused before any lookup or connection (10A).
const [callsBefore, lookupsBefore] = [calls.length, lookups];
await assert.rejects(() => requestPublic({ url: 'https://public.example/post', method: 'POST', body: 'x'.repeat(BODY_LIMIT + 1) }), { message: REQUEST_TOO_LARGE });
await assert.rejects(() => requestPublic({ url: 'https://public.example/post', method: 'POST', body: 'é'.repeat(BODY_LIMIT / 2 + 1) }), { message: REQUEST_TOO_LARGE }, 'counted in UTF-8 bytes');
assert.deepEqual([calls.length, lookups], [callsBefore, lookupsBefore], 'an oversized body is never sent');
await requestPublic({ url: 'https://public.example/post', method: 'POST', body: 'x'.repeat(BODY_LIMIT) });
assert.equal(calls.length, callsBefore + 1, 'exactly 10 MB is sent');

// The same module over real sockets to a local server. DNS answers with a
// public address so the address check passes, and only the socket lookup is
// pointed at the loopback server.
const realHttp = require('node:http');
const live = {};
vm.runInNewContext(outputText, { exports: live, URL, Buffer, setTimeout, clearTimeout, require: (name) => {
  if (name === 'node:dns') return { promises: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] } };
  if (name === 'node:http') return { request: (url, options, receive) => realHttp.request(url, {
    ...options, lookup: (_host, opts, callback) => (opts.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)),
  }, receive) };
  return require(name);
} });
const closed = [];
const server = realHttp.createServer((request, response) => {
  response.on('close', () => closed.push(request.url));
  const route = new URL(request.url, 'http://local');
  if (route.pathname === '/exact') response.end(Buffer.alloc(BODY_LIMIT, 97));
  else if (route.pathname === '/over') response.end(Buffer.alloc(BODY_LIMIT + 1, 97));
  else if (route.pathname === '/endless') {
    // Never ends: only the cap stops it.
    const chunk = Buffer.alloc(1024 * 1024, 97);
    const pump = () => { while (!response.destroyed && response.write(chunk)); if (!response.destroyed) response.once('drain', pump); };
    pump();
  } else if (route.pathname === '/drip') {
    // One byte every 20 ms: never idle, never done.
    response.writeHead(200);
    const drip = setInterval(() => (response.destroyed ? clearInterval(drip) : response.write('.')), 20);
  } else if (route.pathname === '/hop') {
    // Each hop is quick on its own; together they pass the overall limit.
    const n = Number(route.searchParams.get('n'));
    setTimeout(() => {
      if (n < 4) response.writeHead(302, { location: `/hop?n=${n + 1}` }).end();
      else response.end('arrived');
    }, 200);
  } else response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://public.example:${server.address().port}`;
try {
  const exact = await live.requestPublic({ url: `${base}/exact` });
  assert.equal(exact.body.length, BODY_LIMIT, 'exactly 10 MB is collected');
  await assert.rejects(() => live.requestPublic({ url: `${base}/over` }), { message: RESPONSE_TOO_LARGE });
  await assert.rejects(() => live.requestPublic({ url: `${base}/endless` }), { message: RESPONSE_TOO_LARGE });
  await waitFor(() => closed.includes('/endless'), 'the oversized response is cut off, not drained');

  let started = Date.now();
  await assert.rejects(() => live.requestPublic({ url: `${base}/drip` }, { totalMs: 300 }), { message: REQUEST_TOO_SLOW });
  assert.ok(Date.now() - started < 5_000, 'the overall limit, not the 30 s idle timeout, ended it');
  await waitFor(() => closed.includes('/drip'), 'the dripping request is destroyed');

  // Four redirects and a final answer, 200 ms each (1 s in all): within 5 s,
  // past 500 ms though no single hop is.
  assert.equal((await live.requestPublic({ url: `${base}/hop?n=0` }, { totalMs: 5_000 })).body, 'arrived');
  started = Date.now();
  await assert.rejects(() => live.requestPublic({ url: `${base}/hop?n=0` }, { totalMs: 500 }), { message: REQUEST_TOO_SLOW });
  assert.ok(Date.now() - started < 900, 'the limit counts every redirect hop, not each one');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function waitFor(check, what) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(check(), what);
}
console.log('public-network: 48 address cases plus pinned DNS, mixed DNS, redirects, scheme, 10 MB body caps both ways, and overall-limit checks passed');
