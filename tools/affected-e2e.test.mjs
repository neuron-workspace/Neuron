import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectSpecs, areas } from './affected-e2e.mjs';

const specs = readdirSync(new URL('../e2e/', import.meta.url)).filter(p => p.endsWith('.spec.ts')).map(p => 'e2e/' + p);
const select = (...files) => selectSpecs(files, specs);
const expected = (...names) => ['app', 'workspace', ...names].map(n => 'e2e/' + n + '.spec.ts').sort();
let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log('  ok  ' + what); };

check('a spec-only change includes the core smoke specs', () => assert.deepEqual(select('e2e/graph.spec.ts'), expected('graph')));
check('a fixture change runs all specs', () => assert.equal(select('e2e/fixtures.ts'), 'all'));
check('the demo workspace every spec copies runs all specs', () => assert.equal(select('examples/demo-repo/Planner.db'), 'all'));
check('main and preload changes run all specs', () => {
  for (const p of ['src/main/main.ts', 'src/preload/index.ts']) assert.equal(select(p), 'all');
});
check('a mapped renderer file selects its area', () => assert.deepEqual(select('src/renderer/lib/db.ts'), expected('database', 'db-virtualization')));
check('an unmapped renderer file runs all specs', () => assert.equal(select('src/renderer/App.tsx'), 'all'));
check('docs only selects nothing', () => assert.deepEqual(select('docs/distribution.md', 'README.md'), []));
check('tools only selects nothing', () => assert.deepEqual(select('tools/publish-gate.test.mjs'), []));
check('two areas are unioned', () => assert.deepEqual(select('src/renderer/lib/db.ts', 'src/renderer/lib/graph-layout.ts'), expected('database', 'db-virtualization', 'graph')));
check('package and shared config changes run all specs', () => {
  for (const p of ['package.json', 'package-lock.json', 'tsconfig.main.json', 'vite.config.ts', 'playwright.config.ts']) assert.equal(select(p), 'all');
});
check('benchmarks are never selected', () => {
  assert.deepEqual(select('e2e/graph-benchmark.spec.ts', 'e2e/scale.benchmark.spec.ts'), []);
  assert.deepEqual(select('e2e/graph-benchmark.spec.ts', 'src/renderer/components/SigmaGraph.tsx'), expected('graph'));
});
check('every spec named in the area table exists', () => {
  for (const [, names] of areas) for (const name of names) assert.ok(specs.includes('e2e/' + name + '.spec.ts'), name);
});
check('every area matches a real renderer file', () => {
  const paths = readdirSync(new URL('../src/renderer/', import.meta.url), { recursive: true }).map(p => p.replaceAll('\\', '/'));
  for (const [pattern] of areas) assert.ok(paths.some(p => pattern.test(p)), String(pattern));
});
check('all wins over an area selection', () => assert.equal(select('src/renderer/lib/db.ts', 'e2e/fixtures.ts'), 'all'));
check('overlapping areas include all their specs', () => assert.deepEqual(select('src/renderer/surfaces/HtmxViewSurface.tsx'), expected('surfaces', 'security', 'snake')));
check('unrelated source and workflow changes select nothing', () => assert.deepEqual(select('src/shared/types.ts', '.github/workflows/ci.yml', 'build/icon.png'), []));
check('deleted specs do not turn into nonexistent test filters', () => assert.deepEqual(select('e2e/deleted.spec.ts'), []));
check('the CLI prints all, selected paths, or an empty line', () => {
  const cli = fileURLToPath(new URL('./affected-e2e.mjs', import.meta.url));
  for (const [input, output] of [['package.json\n', 'all\n'], ['docs/a.md\n', '\n'], ['e2e/graph.spec.ts\r\n', expected('graph').join(' ') + '\n']]) {
    assert.equal(execFileSync(process.execPath, [cli], { input, encoding: 'utf8' }), output);
  }
});
console.log('\naffected-e2e: ' + checks + ' checks passed');
