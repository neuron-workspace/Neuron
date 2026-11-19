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
let answers = [{ address: '8.8.8.8', family: 4 }];
let redirects = [];
const exports = {};
vm.runInNewContext(outputText, { exports, URL, Buffer, require: (name) => {
  if (name === 'node:dns') return { promises: { lookup: async (_host, options) => {
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
const { isBlockedAddress, requestPublic } = exports;
const blocked = ['127.0.0.1', '127.255.255.255', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.255.255'];
for (const ip of blocked) {
  assert.equal(isBlockedAddress(ip), true, ip);
  assert.equal(isBlockedAddress(`::ffff:${ip}`), true, `mapped ${ip}`);
}
for (const ip of ['::', '::1', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::127.0.0.1', '::a9fe:a9fe', '64:ff9b::10.0.0.1', '64:ff9b::7f00:1', 'invalid']) assert.equal(isBlockedAddress(ip), true, ip);
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
console.log('public-network: 41 address cases plus pinned DNS, mixed DNS, redirects, and scheme checks passed');
