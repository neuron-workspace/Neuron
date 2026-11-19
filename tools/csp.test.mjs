import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const policy = (text) => text.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
const production = policy(html);
const directives = Object.fromEntries(production.split(';').map((part) => part.trim().split(/\s+/)).map(([key, ...values]) => [key, values.join(' ')]));
assert.deepEqual(directives, {
  'default-src': "'self'", 'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
  'img-src': "'self' data: blob: neuron-file: https:", 'media-src': "'self' blob: neuron-file:",
  'font-src': "'self' data: https://fonts.gstatic.com", 'connect-src': "'self'", 'worker-src': "'self' blob:",
  'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'", 'frame-src': "'none'",
});
assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<link'), 'policy precedes resources');
const source = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
const exports = {};
vm.runInNewContext(outputText, { exports, __dirname: '.', require: (name) => name === 'vite' ? { defineConfig: (config) => config } : name === '@vitejs/plugin-react' ? () => ({}) : require(name) });
const plugin = exports.default.plugins.find((item) => item.name === 'development-csp');
assert.equal(plugin.apply, 'serve');
const development = policy(plugin.transformIndexHtml(html));
assert.equal(development, production.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws://localhost:5174"));
assert.ok(!development.includes('unsafe-eval'));
console.log('csp: 12 production directives and development-only exceptions passed');
