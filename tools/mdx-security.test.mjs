// Exercise the actual page parser, not a separately recreated Markdown pipeline.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';

globalThis.DOMParser = class {
  parseFromString(html) { return parseHTML(`<html><head></head><body>${html}</body></html>`).document; }
};
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
const outfile = resolve('tools/.mdx-security.tmp.cjs');
await build({ stdin: { contents: `export { default as MDXPreview } from './src/renderer/components/MDXPreview'; export { default as NoteTabs } from './src/renderer/components/NoteTabs'; export { BarChart, LineChart, PieChart } from './src/renderer/components/mdx-data';`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs',
  packages: 'external', jsx: 'automatic', alias: { '@': resolve('src/renderer') }, outfile });
let MDXPreview, NoteTabs, BarChart, LineChart, PieChart;
try { ({ MDXPreview, NoteTabs, BarChart, LineChart, PieChart } = createRequire(import.meta.url)(outfile)); } finally { rmSync(outfile, { force: true }); }
let checks = 0;
const render = text => {
  // React warns about useLayoutEffect in server renders. The test does not rely on effects.
  const original = console.error;
  console.error = (...args) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) original(...args); };
  try {
    const html = renderToStaticMarkup(React.createElement(MDXPreview, { mdxContent: text, showProperties: false }));
    return parseHTML(`<html><body>${html}</body></html>`).document;
  } finally { console.error = original; }
};
for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,evil', 'vbscript:msgbox(1)']) {
  for (const text of [`[x](${url})`, `Link: [x](${url})`]) {
    const doc = render(text);
    assert.equal(doc.querySelectorAll('a[href]').length, 0, url);
    assert.equal(doc.querySelector('[role="alert"]'), null, 'the renderer must parse, not fail closed by crashing');
  }
  checks++;
}
// Safe links still render, so a parser that drops every input cannot pass.
assert.equal(render('[safe](https://example.com)').querySelector('a')?.getAttribute('href'), 'https://example.com'); checks++;
for (const raw of ['<script>globalThis.pwned = true</script>', '<img src=x onerror=alert(1)>', '<iframe src="https://evil.test"></iframe>', '<a href="javascript:alert(1)">x</a>']) {
  for (const text of [raw, `<div>${raw}</div>`, `<Card title="Nested">\n${raw}\n</Card>`]) {
    const doc = render(text);
    assert.equal(doc.querySelectorAll('script,iframe,img[src],a[href],[onerror]').length, 0, text);
    assert.equal(globalThis.pwned, undefined);
    if (text.startsWith('<div>')) assert.equal(doc.querySelector('[role="alert"]'), null, 'allowed HTML containers go through sanitization');
    else assert.ok(doc.querySelector('[role="alert"]')?.textContent.includes(raw.startsWith('<img') ? 'Unclosed MDX tag' : 'not registered'), 'standalone unsafe HTML reports a parse error today');
    checks++;
  }
}
// Raw HTML is sanitized today: inert a/img nodes may remain, never their unsafe URLs/handlers.
assert.equal(render('<div><img src=x onerror=alert(1)></div>').querySelector('img')?.getAttribute('src'), null); checks++;
for (const value of ['bogus fixed inset-0', '__proto__', 'constructor', 'toString']) {
  const doc = render(`<Card title="Card" tone="${value}">\nBody\n</Card>\n<Stat label="Stat" value="4" tone="${value}" />\n<Badge type="${value}" text="Badge" />\n<Callout type="${value}">\nBody\n</Callout>`);
  assert.equal(doc.querySelector('[data-badge-kind]')?.getAttribute('data-badge-kind'), 'info');
  assert.equal(doc.querySelector('[data-callout-kind]')?.getAttribute('data-callout-kind'), 'info');
  assert.ok(!doc.body.innerHTML.includes('function Object') && !doc.body.innerHTML.includes('[object Object]'));
  assert.equal(doc.querySelector('.fixed'), null);
  assert.equal(doc.querySelector('.mdx-card h3 span'), null, 'unknown tone uses the plain surface dot fallback');
  checks++;
}
assert.equal(render('<Columns>\n<Column>One</Column>\n<Column>Two</Column>\n</Columns>').querySelectorAll('[data-column-move],[role="separator"]').length, 0); checks++;
for (const type of ['', 'constructor', 'untrusted fixed inset-0']) {
  assert.doesNotThrow(() => render(`<Chart type="${type}" source="data.csv" group="Name" />`)); checks++;
}
for (const values of [[], [1], [0, 0], [-4, 2], [-4]]) {
  const label = 'A long label '.repeat(30).trim();
  const groups = values.map((value, i) => ({ key: String(i), label: label + i, value, count: 1 }));
  for (const Component of [BarChart, LineChart, PieChart]) {
    const html = renderToStaticMarkup(React.createElement(Component, { groups, width: 400, own: false }));
    assert.ok(!/NaN|Infinity/.test(html), `${Component.name}: ${values}`);
    const doc = parseHTML(`<html><body>${html}</body></html>`).document;
    if (Component === PieChart) assert.equal(doc.querySelectorAll('[data-slice]').length, values.filter(v => v > 0).length, 'pie ignores non-positive values, including a zero total');
    else {
      assert.equal(doc.querySelectorAll('title').length, values.length);
      if (values.length) assert.equal(doc.querySelector('title').textContent, `${label}0: ${values[0]}`, 'full labels and signed values remain accessible');
    }
    checks++;
  }
}
for (const path of ['people.csv', 'PEOPLE.CSV']) {
  const html = renderToStaticMarkup(React.createElement(NoteTabs, { tabs: [path], activeTab: path, onSelect() {}, onClose() {}, onNewTab() {}, onNewBrowser() {} }));
  assert.ok(html.includes('lucide-table2'), 'CSV tabs use the explorer table icon'); checks++;
}
console.log(`mdx-security: ${checks} rendered pipeline cases passed`);
