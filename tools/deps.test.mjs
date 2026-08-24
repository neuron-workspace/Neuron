// Run: node tools/deps.test.mjs
//
// Everything the main process loads at runtime must be a declared dependency.
//
// This exists because 0.4.3 shipped an application that could not start. `zod`
// is a PEER dependency of the AI SDK, npm hoists peers to the root, so it
// resolved perfectly in development and in all 47 end-to-end tests -- which run
// against dist/main/main.js with the full node_modules tree present. The
// packaged app loads from inside app.asar, which contains only what
// electron-builder can reach from `dependencies`. zod was not there.
//
// The renderer does not have this problem: Vite bundles it, so its imports are
// inlined and never resolved at runtime. Only main is compiled with tsc and
// left to resolve from node_modules.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const declared = new Set(Object.keys(pkg.dependencies ?? {}));
const builtin = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const read = (name) => {
  const file = join(root, 'node_modules', name, 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null;
};

/** `@scope/pkg/sub` and `pkg/sub` both resolve to their package name. */
const packageName = (spec) =>
  (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

// --- 1. every bare import in src/main -------------------------------------
const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : (full.endsWith('.ts') ? [full] : []);
});

const mainImports = new Set();
for (const file of walk(join(root, 'src', 'main'))) {
  const source = readFileSync(file, 'utf-8');
  for (const m of source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g)) mainImports.add(m[1]);
  for (const m of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) mainImports.add(m[1]);
  for (const m of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) mainImports.add(m[1]);
}

const external = [...mainImports]
  .filter((spec) => !spec.startsWith('.') && !spec.startsWith('/'))
  .map(packageName)
  .filter((name) => !builtin.has(name) && name !== 'electron');

let checked = 0;
for (const name of new Set(external)) {
  assert.ok(
    declared.has(name),
    `src/main imports "${name}" but package.json does not declare it as a dependency. `
    + 'It will resolve in development and be missing from the packaged app.',
  );
  checked++;
}

// --- 2. required peers of anything main pulls in ---------------------------
// A peer is not installed by the package that wants it; npm hoists one copy to
// the root. electron-builder does not follow peers, so an undeclared one is
// absent from app.asar even though everything works locally.
const seen = new Set();
const queue = [...new Set(external)];
let peersChecked = 0;
while (queue.length) {
  const name = queue.shift();
  if (seen.has(name) || builtin.has(name)) continue;
  seen.add(name);
  const meta = read(name);
  if (!meta) continue;

  for (const dep of Object.keys(meta.dependencies ?? {})) queue.push(dep);

  for (const [peer] of Object.entries(meta.peerDependencies ?? {})) {
    if (meta.peerDependenciesMeta?.[peer]?.optional === true) continue;
    // A nested copy ships with its parent, so it is already inside the package.
    if (existsSync(join(root, 'node_modules', name, 'node_modules', peer))) continue;
    if (peer === 'electron') continue;
    assert.ok(
      declared.has(peer),
      `"${name}" requires peer "${peer}", which package.json does not declare. `
      + 'npm hoists it so development works; the packaged app will not have it. '
      + 'This is exactly how 0.4.3 shipped without zod and could not start.',
    );
    peersChecked++;
  }
}

console.log(`deps: ${checked} main-process imports and ${peersChecked} required peers are all declared`);
