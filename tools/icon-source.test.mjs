// One mark, in one place, and nothing quietly holding a second copy.
//
// The mark used to be written out three times: by hand in build/icon.svg, as
// Python constants in tools/appx-assets.py, and as inline SVG in
// tools/store-logos.mjs. The third had drifted onto a blue gradient, so the
// Microsoft Store listing showed a different icon from the application -- for
// however long it took someone to look at both at once. Nothing failed.
//
// These checks are what would have failed.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { icon, iconSvg, markSvg } from './icons/icon-source.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf-8');

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

check('the mark is black plate, white asterisk', () => {
  assert.equal(icon.plate, '#000000');
  assert.equal(icon.mark, '#ffffff');
  assert.equal(icon.branches, 5);
});

check('build/icon.svg is what the generator produces', () => {
  // Regenerating and comparing, rather than trusting whoever last edited it.
  assert.equal(read('build', 'icon.svg'), iconSvg(),
    'build/icon.svg is stale -- run: npm run icon:svg');
});

check('the generated icon carries no unreferenced leftovers', () => {
  const svg = read('build', 'icon.svg');
  // The hand-written file kept an indigo-to-violet <linearGradient id="bg">
  // that nothing referenced, left over from a design that had moved on.
  assert.doesNotMatch(svg, /linearGradient/,
    'a gradient nothing references is a spare part, not a design');
  assert.match(svg, /Do not edit/);
});

check('the Store logo generator holds no copy of the mark', () => {
  const source = read('tools', 'store-logos.mjs');
  assert.doesNotMatch(source, /<polygon/,
    'store-logos.mjs must render the shared mark, not restate it');
  assert.match(source, /icon-source\.mjs/);
});

check('the Store logos use the plate, not a gradient of their own', () => {
  const source = read('tools', 'store-logos.mjs');
  // The specific colours that made the Store listing disagree with the app.
  for (const blue of ['#4b78ff', '#2b5cf6', '#163ec9', '#7aa2ff', '#1230a8']) {
    assert.ok(!source.includes(blue), `${blue} is from the old blue plate`);
  }
  assert.match(source, /background:\s*\$\{icon\.plate\}/);
});

check('the appx tiles read the shared definition', () => {
  const source = read('tools', 'appx-assets.py');
  assert.match(source, /icon\.json/, 'appx-assets.py must read build/icon.json');
  // The literals it used to carry.
  assert.doesNotMatch(source, /^BRANCH = \[\(-24/m);
  assert.doesNotMatch(source, /^PLATE = \(0, 0, 0, 255\)/m);
});

check('the appx manifest background matches the plate', () => {
  // backgroundColor fills whatever the tile image does not. At #1a1a1a against
  // a #000000 plate that is a visible seam on the Start menu.
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.appx.backgroundColor, icon.plate);
});

check('the mark alone has no plate, so a caller can supply its own', () => {
  const svg = markSvg(128);
  assert.match(svg, /width="128"/);
  assert.doesNotMatch(svg, /<rect/, 'markSvg draws the asterisk only');
  assert.equal((svg.match(/<polygon/g) ?? []).length, icon.branches);
});

console.log(`\nicon source: ${checks} checks passed`);
