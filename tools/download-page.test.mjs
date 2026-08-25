// Run: node tools/download-page.test.mjs
// Bite-check: node tools/download-page.test.mjs --bite-latest
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const pageScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(pageScript, 'download page script not found');

const script = process.argv.includes('--bite-latest')
  ? pageScript.replace('/releases?per_page=20', '/releases/latest')
  : pageScript;

class Element {
  #html = '';
  #text = '';

  constructor(initial = '') {
    this.innerHTML = initial;
    this.href = '';
  }

  get innerHTML() { return this.#html; }
  set innerHTML(value) { this.#html = String(value); this.#text = ''; }
  get textContent() { return this.#text; }
  set textContent(value) { this.#text = String(value); this.#html = ''; }
}

async function runPage(releases) {
  const elements = new Map([
    ['strip-version', new Element()],
    ['dl-meta', new Element('Checking the latest release…')],
    ['dl-windows', new Element('<p class="empty">Loading…</p>')],
    ['dl-mac', new Element('<p class="empty">Loading…</p>')],
    ['dl-linux', new Element('<p class="empty">Loading…</p>')],
    ['hero-dl', new Element()],
    ['hero-dl-label', new Element()],
  ]);
  let requestedUrl = '';
  const assets = ['dl-windows', 'dl-mac', 'dl-linux'].map((id) => elements.get(id));
  const document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === '.assets' ? assets : [],
  };
  const fetch = async (url) => {
    requestedUrl = url;
    if (url.endsWith('/releases/latest')) {
      const stable = releases.find((release) => !release.draft && !release.prerelease);
      return stable
        ? { ok: true, json: async () => stable }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, json: async () => releases };
  };

  vm.runInNewContext(script, {
    document,
    fetch,
    location: { hostname: 'shiv-khetan.github.io', pathname: '/Neuron/' },
    navigator: { userAgent: 'test' },
    URLSearchParams,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, requestedUrl };
}

const prereleaseAssets = [
  { name: 'Neuron-beta-windows.exe', size: 80_000_000, download_count: 12, browser_download_url: 'https://downloads.example/Neuron-beta-windows.exe' },
  { name: 'Neuron-beta-mac.zip', size: 90_000_000, download_count: 8, browser_download_url: 'https://downloads.example/Neuron-beta-mac.zip' },
  { name: 'Neuron-beta-linux.AppImage', size: 100_000_000, download_count: 4, browser_download_url: 'https://downloads.example/Neuron-beta-linux.AppImage' },
];
const prerelease = {
  tag_name: 'v0.5.0-beta.1',
  published_at: '2026-08-25T00:00:00Z',
  prerelease: true,
  draft: false,
  assets: prereleaseAssets,
};
const olderPrerelease = { ...prerelease, tag_name: 'v0.4.4-beta.1', published_at: '2026-08-20T00:00:00Z' };

// A repository containing only prereleases must still take the success path.
{
  const { elements, requestedUrl } = await runPage([prerelease, olderPrerelease]);
  assert.equal(requestedUrl, 'https://api.github.com/repos/shiv-khetan/Neuron/releases?per_page=20');
  assert.match(elements.get('dl-meta').innerHTML, /v0\.5\.0-beta\.1/);

  const windows = elements.get('dl-windows').innerHTML;
  const mac = elements.get('dl-mac').innerHTML;
  const linux = elements.get('dl-linux').innerHTML;
  assert.match(windows, /Neuron-beta-windows\.exe/);
  assert.doesNotMatch(windows, /Neuron-beta-mac\.zip/);
  assert.match(mac, /Neuron-beta-mac\.zip/);
  assert.doesNotMatch(mac, /Neuron-beta-windows\.exe/);
  assert.match(linux, /Neuron-beta-linux\.AppImage/);

  for (const [box, asset] of [[windows, prereleaseAssets[0]], [mac, prereleaseAssets[1]], [linux, prereleaseAssets[2]]]) {
    const href = box.match(/href="([^"]+)"/)?.[1];
    assert.match(href, /^\.\/installing\.html\?/);
    const target = new URL(href.replaceAll('&amp;', '&'), 'https://shiv-khetan.github.io/Neuron/');
    assert.equal(target.searchParams.get('url'), asset.browser_download_url);
    assert.notEqual(href, asset.browser_download_url);
  }
  assert.match(elements.get('dl-meta').innerHTML, /<span class="chip">beta<\/span>/);
}

// Drafts never win, and a stable release wins over a newer prerelease.
{
  const draft = { ...prerelease, tag_name: 'v2.0.0-draft', prerelease: false, draft: true, assets: [{ ...prereleaseAssets[0], name: 'draft.exe', browser_download_url: 'https://downloads.example/draft.exe' }] };
  const stable = { ...prerelease, tag_name: 'v1.0.0', prerelease: false, assets: [{ ...prereleaseAssets[0], name: 'stable.exe', browser_download_url: 'https://downloads.example/stable.exe' }] };
  const { elements } = await runPage([draft, prerelease, stable]);
  const meta = elements.get('dl-meta').innerHTML;
  const windows = elements.get('dl-windows').innerHTML;
  assert.match(meta, /v1\.0\.0/);
  assert.doesNotMatch(meta, /v2\.0\.0-draft|v0\.5\.0-beta\.1/);
  assert.doesNotMatch(meta, /<span class="chip">beta<\/span>/);
  assert.match(windows, /stable\.exe/);
  assert.doesNotMatch(windows, /draft\.exe|Neuron-beta-windows\.exe/);
}

// With no published release, the promise chain is caught and every group gets
// the page's stated Releases fallback instead of retaining Loading markup.
{
  const { elements } = await runPage([]);
  assert.match(elements.get('dl-meta').textContent, /Could not reach the GitHub API/);
  for (const id of ['dl-windows', 'dl-mac', 'dl-linux']) {
    assert.match(elements.get(id).innerHTML, /Open the Releases page/);
    assert.doesNotMatch(elements.get(id).innerHTML, /Loading/);
  }
}

console.log('download-page: success and fallback paths verified');
