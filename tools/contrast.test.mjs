// Runnable check for the theme presets' colour contrast.
// Run: node tools/contrast.test.mjs
//
// This exists because contrast is the defect a design review finds and a test
// suite never does: nothing crashes, nothing looks obviously broken to whoever
// picked the colour, and the text is simply hard to read for everyone else. An
// Impeccable sweep found three of four presets shipping text below WCAG AA,
// including Nord's danger colour at 2.46:1 -- error states hardest to read in
// the theme where they matter most.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/renderer/lib/theme.ts'), 'utf-8');

const keys = src.match(/TOKEN_KEYS[\s\S]*?\] as const/)[0].match(/'([^']+)'/g).map((s) => s.slice(1, -1));

/** WCAG relative luminance. */
function luminance(hex) {
  const m = hex.replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(m.substr(i, 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

// Roles that carry text. Checked against every background text actually sits
// on: --canvas for the page, --surface for panels, cards and rows, and --nav
// for the sidebar, title bar, status bar and pane headers.
//
// --nav was missing here, which is why the light preset could ship a chrome
// colour chosen purely to look separate from the canvas with nothing checking
// that the file names written on it stayed readable.
const TEXT_ROLES = [
  '--ink', '--ink-secondary', '--ink-muted',
  '--accent', '--accent-strong', '--positive', '--danger', '--warning', '--info',
];
const BACKGROUNDS = ['--canvas', '--surface', '--nav'];

const presets = [...src.matchAll(/preset\('(\w+)', '([^']+)', '(\w+)', \[([\s\S]*?)\]\)/g)];
assert.ok(presets.length >= 4, 'expected at least four theme presets');

let checked = 0;
for (const [, id, , , body] of presets) {
  const values = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const token = {};
  keys.forEach((k, i) => { token[k] = values[i]; });

  for (const bg of BACKGROUNDS) {
    for (const role of TEXT_ROLES) {
      const colour = token[role];
      // rgba dividers and the like are not text roles; skip anything non-hex.
      if (!colour || !colour.startsWith('#')) continue;
      const ratio = contrast(colour, token[bg]);
      assert.ok(
        ratio >= AA,
        `${id}: ${role} on ${bg} is ${ratio.toFixed(2)}:1, below AA ${AA}:1`,
      );
      checked++;
    }
  }

  // --accent is also a button background with --canvas text on it, so it has to
  // clear AA in that direction too. Raising accent away from the surface helps
  // both, but only if someone checks -- otherwise fixing one breaks the other.
  const onAccent = contrast(token['--canvas'], token['--accent']);
  assert.ok(
    onAccent >= AA,
    `${id}: --canvas text on an --accent button is ${onAccent.toFixed(2)}:1, below AA`,
  );
  checked++;
}

console.log(`contrast: ${checked} combinations pass WCAG AA across ${presets.length} presets`);
