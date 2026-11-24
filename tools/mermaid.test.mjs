import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-mermaid-'));
const surfacesFile = join(out, 'surfaces.mjs');
const mermaidFile = join(out, 'mermaid.mjs');

await Promise.all([
  build({ entryPoints: ['src/renderer/surfaces/index.ts'], outfile: surfacesFile, format: 'esm', bundle: true }),
  build({ entryPoints: ['src/renderer/lib/mermaid.ts'], outfile: mermaidFile, format: 'esm', bundle: true, external: ['mermaid'] }),
]);

const { SURFACE_EXTENSIONS, getSurface, isSurfaceFile, registerSurface } = await import('file://' + surfacesFile.replace(/\\/g, '/'));
const { formatMermaidError } = await import('file://' + mermaidFile.replace(/\\/g, '/'));

assert.ok(SURFACE_EXTENSIONS.includes('mmd'));
assert.ok(SURFACE_EXTENSIONS.includes('mermaid'));
assert.equal(isSurfaceFile('diagrams/Flow.MMD'), true);
assert.equal(isSurfaceFile('diagrams/Flow.mermaid'), true);
assert.equal(isSurfaceFile('diagrams/Flow.md'), false);

const surface = () => null;
registerSurface('.MMD', surface);
assert.equal(getSurface('diagrams/Flow.mmd'), surface);
assert.equal(getSurface('diagrams/no-extension'), undefined);

assert.equal(formatMermaidError(new Error('  Parse error on line 2  ')), 'Parse error on line 2');
assert.equal(formatMermaidError(' invalid syntax '), 'invalid syntax');
assert.equal(formatMermaidError({}), 'Mermaid could not render this diagram.');

// renderMermaid against the real Mermaid parser. render() itself needs a DOM, so
// the shim parses with real Mermaid and reports the configuration the diagram
// was parsed under and what became of its click link.
{
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const realMermaid = pathToFileURL(createRequire(import.meta.url).resolve('mermaid')).href;
  const renderFile = join(out, 'render.mjs');
  await build({
    entryPoints: ['src/renderer/lib/mermaid.ts'], outfile: renderFile, format: 'esm', bundle: true, platform: 'node',
    plugins: [{ name: 'mermaid-shim', setup(b) {
      b.onResolve({ filter: /^mermaid$/ }, () => ({ path: 'mermaid', namespace: 'shim' }));
      b.onResolve({ filter: /^mermaid-real$/ }, () => ({ path: realMermaid, external: true }));
      b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: `
        import real from 'mermaid-real';
        export default {
          initialize(config) { real.initialize(config); },
          async render(_id, source) {
            // As render() does: apply the source's directives, then build the diagram.
            await real.parse(source);
            const diagram = await real.mermaidAPI.getDiagramFromText(source);
            const vertices = diagram.db.getVertices();
            const a = vertices instanceof Map ? vertices.get('A') : vertices.A;
            const config = real.mermaidAPI.getConfig();
            return { svg: JSON.stringify({ level: config.securityLevel, theme: config.theme, link: a?.link ?? null }) };
          },
        };
      ` }));
    } }],
  });
  const { renderMermaid } = await import(pathToFileURL(renderFile).href);

  // A directive cannot loosen security: Mermaid drops securityLevel from it, so
  // the diagram parses under 'strict' and its javascript: link is neutralised.
  const hostile = '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n  A-->B\n  click A href "javascript:alert(1)"';
  const parsed = JSON.parse(await renderMermaid('m1', hostile, 'dark'));
  assert.equal(parsed.level, 'strict', 'an init directive cannot set securityLevel to loose');
  assert.ok(parsed.link && !/^javascript:/i.test(parsed.link), `a javascript: click link is sanitised (got ${parsed.link})`);
  // Other directive settings still apply, so the directive was read, not ignored.
  const themed = JSON.parse(await renderMermaid('m2', '%%{init: {"securityLevel": "antiscript", "theme": "forest"}}%%\nflowchart LR\n  A-->B', 'light'));
  assert.equal(themed.theme, 'forest', 'the directive was applied');
  assert.equal(themed.level, 'strict', 'except for securityLevel, whatever its value');

  // A broken diagram rejects with a message the surface shows; it does not throw past it.
  const broken = await renderMermaid('m3', 'this is not a mermaid diagram', 'dark').then(() => null, (error) => error);
  assert.ok(broken, 'a broken diagram rejects');
  assert.ok(formatMermaidError(broken).length > 0, 'and its error has a message to show');
  assert.notEqual(formatMermaidError(broken), '', 'not an empty string');
}

rmSync(out, { recursive: true, force: true });
console.log('mermaid: extension routing, error formatting and strict security under directives verified');
