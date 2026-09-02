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

rmSync(out, { recursive: true, force: true });
console.log('mermaid: extension routing and error formatting verified');
