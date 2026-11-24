import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectSpecs, areas, mainAreas, detailedSpecs } from './affected-e2e.mjs';

const integration = readdirSync(new URL('../e2e/integration/', import.meta.url)).filter(p => p.endsWith('.spec.ts')).map(p => 'e2e/integration/' + p);
const detailed = readdirSync(new URL('../e2e/', import.meta.url)).filter(p => p.endsWith('.spec.ts')).map(p => p.slice(0, -'.spec.ts'.length));
const select = (...files) => selectSpecs(files, integration);
const expected = (...names) => names.map(n => 'e2e/integration/' + n + '.spec.ts').sort();
let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log('  ok  ' + what); };

check('an integration spec change selects that spec alone', () => assert.deepEqual(select('e2e/integration/graph.spec.ts'), expected('graph')));
check('a detailed spec change selects its feature\'s integration spec, not itself', () => {
  assert.deepEqual(select('e2e/graph.spec.ts'), expected('graph'));
  assert.deepEqual(select('e2e/search-graph.spec.ts'), expected('graph', 'search'));
});
check('a fixture change runs all integration specs', () => assert.equal(select('e2e/fixtures.ts'), 'all'));
check('the demo workspace every spec copies runs all integration specs', () => assert.equal(select('examples/demo-repo/Planner.db'), 'all'));
check('unmapped main and preload changes run all integration specs', () => {
  for (const p of ['src/main/main.ts', 'src/main/preload.ts', 'src/main/safe-fs.ts', 'src/preload/index.ts', 'src/shared/types.ts']) assert.equal(select(p), 'all', p);
});
check('a mapped renderer file selects its feature', () => assert.deepEqual(select('src/renderer/lib/db.ts'), expected('tables')));
check('an unmapped renderer file runs all integration specs', () => {
  for (const p of ['src/renderer/App.tsx', 'src/renderer/components/ui/button.tsx', 'src/renderer/index.css']) assert.equal(select(p), 'all', p);
});
check('docs only selects nothing', () => assert.deepEqual(select('docs/distribution.md', 'README.md'), []));
check('tools only selects nothing', () => assert.deepEqual(select('tools/publish-gate.test.mjs'), []));
check('the process helper the e2e fixtures import runs all integration specs', () => assert.equal(select('tools/procs.mjs'), 'all'));
check('the shared table pieces select both tables and MDX pages', () => assert.deepEqual(select('src/renderer/components/DbView.tsx'), expected('mdx', 'tables')));
check('two features are unioned', () => assert.deepEqual(select('src/renderer/lib/db.ts', 'src/renderer/lib/graph-layout.ts'), expected('graph', 'tables')));
check('package and shared config changes run all integration specs', () => {
  for (const p of ['package.json', 'package-lock.json', 'tsconfig.main.json', 'vite.config.ts', 'playwright.config.ts']) assert.equal(select(p), 'all');
});
check('benchmarks are never selected', () => {
  assert.deepEqual(select('e2e/graph-benchmark.spec.ts', 'e2e/scale.benchmark.spec.ts'), []);
  assert.deepEqual(select('e2e/graph-benchmark.spec.ts', 'src/renderer/components/SigmaGraph.tsx'), expected('graph'));
});
check('only integration specs are ever selected', () => {
  for (const p of ['src/renderer/lib/db.ts', 'src/main/htmx/server.ts', 'e2e/terminal.spec.ts', 'e2e/integration/files.spec.ts']) {
    const picked = select(p);
    assert.ok(Array.isArray(picked) && picked.length > 0, p);
    for (const path of picked) assert.match(path, /^e2e\/integration\/[^/]+\.spec\.ts$/, p);
  }
});
check('every feature named in the tables has an integration spec', () => {
  const named = [...areas, ...mainAreas].flatMap(([, names]) => names).concat(Object.values(detailedSpecs).flat());
  for (const name of new Set(named)) assert.ok(integration.includes('e2e/integration/' + name + '.spec.ts'), name);
});
check('every integration spec is reachable from some source file', () => {
  const named = new Set([...areas, ...mainAreas].flatMap(([, names]) => names));
  for (const path of integration) assert.ok(named.has(path.slice('e2e/integration/'.length, -'.spec.ts'.length)), path);
});
check('every detailed spec belongs to a feature, benchmarks aside', () => {
  for (const name of detailed.filter(n => !/benchmark/.test(n))) assert.ok(detailedSpecs[name], name);
  for (const name of Object.keys(detailedSpecs)) assert.ok(detailed.includes(name), 'mapped but missing: ' + name);
});
check('an unmapped detailed spec is treated as shared', () => assert.equal(select('e2e/brand-new.spec.ts'), 'all'));
check('every area matches a real renderer file', () => {
  const paths = readdirSync(new URL('../src/renderer/', import.meta.url), { recursive: true }).map(p => p.replaceAll('\\', '/'));
  for (const [pattern] of areas) assert.ok(paths.some(p => pattern.test(p)), String(pattern));
});
check('every main area matches a real main file', () => {
  const paths = readdirSync(new URL('../src/main/', import.meta.url), { recursive: true }).map(p => p.replaceAll('\\', '/'));
  for (const [pattern] of mainAreas) assert.ok(paths.some(p => pattern.test(p)), String(pattern));
});
check('terminal files, renderer and main, select the terminal spec', () => {
  for (const p of ['src/renderer/components/Automations.tsx', 'src/renderer/lib/useTerminalToggle.ts', 'src/main/terminal-shell.ts', 'src/main/terminal-history.ts',
    'src/renderer/components/RunButton.tsx', 'src/renderer/components/XtermTerminal.tsx', 'src/renderer/lib/terminal-bus.ts', 'src/renderer/plugins/builtin/terminal.tsx']) {
    assert.deepEqual(select(p), expected('terminal'), p);
  }
});
check('the view server and the view surface select HTML views and security', () => {
  assert.deepEqual(select('src/main/htmx/server.ts'), expected('html-views', 'security'));
  assert.deepEqual(select('src/renderer/surfaces/HtmxViewSurface.tsx'), expected('html-views', 'security'));
});
check('an unmapped main file still runs all, even beside a mapped one', () => assert.equal(select('src/main/terminal-shell.ts', 'src/main/main.ts'), 'all'));
check('all wins over a feature selection', () => assert.equal(select('src/renderer/lib/db.ts', 'e2e/fixtures.ts'), 'all'));
check('the surface registry selects every surface it routes to', () => assert.deepEqual(select('src/renderer/surfaces/index.ts'), expected('html-views', 'surfaces', 'tables')));
check('unrelated files and workflow changes select nothing', () => assert.deepEqual(select('.github/workflows/ci.yml', 'build/icon.png', 'CHANGELOG.md'), []));
check('a deleted integration spec does not turn into a nonexistent test filter', () => assert.deepEqual(select('e2e/integration/deleted.spec.ts'), []));
check('the CLI prints all, selected paths, or an empty line', () => {
  const cli = fileURLToPath(new URL('./affected-e2e.mjs', import.meta.url));
  for (const [input, output] of [['package.json\n', 'all\n'], ['docs/a.md\n', '\n'], ['e2e/graph.spec.ts\r\n', expected('graph').join(' ') + '\n']]) {
    assert.equal(execFileSync(process.execPath, [cli], { input, encoding: 'utf8' }), output);
  }
});
console.log('\naffected-e2e: ' + checks + ' checks passed');
