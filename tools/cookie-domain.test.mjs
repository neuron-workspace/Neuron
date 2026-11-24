import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/main/cookie-domain.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { normalizeCookieDomain, cookieDomainMatches } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

assert.equal(normalizeCookieDomain('GitHub.com'), 'github.com');
for (const invalid of [undefined, null, '', 'https://github.com', 'github.com/a', 'github.com:80', '.github.com', 'github.com.', 'github..com', '*.github.com', '-github.com', ' github.com', '127.0.0.1', '::1']) {
  assert.equal(normalizeCookieDomain(invalid), null, String(invalid));
}
for (const host of ['github.com', '.github.com', 'api.github.com', '.api.github.com', 'API.GITHUB.COM']) {
  assert.equal(cookieDomainMatches(host, 'github.com'), true, host);
}
for (const host of ['evilgithub.com', '.evilgithub.com', 'github.com.evil.com', 'com']) {
  assert.equal(cookieDomainMatches(host, 'github.com'), false, host);
}
console.log('cookie-domain: 25 validation and boundary cases passed');
