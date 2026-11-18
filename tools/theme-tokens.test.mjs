import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/renderer/lib/theme.ts', import.meta.url), 'utf8');
const exports = {};
runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS }), { exports });
const { PRESETS, normalizeAppearance } = exports;
const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
for (const id of ['light', 'graphite']) {
  const t = PRESETS[id].tokens;
  for (const ink of ['--ink', '--ink-secondary', '--ink-muted']) {
    for (const bg of ['--canvas', '--nav', '--surface']) {
      assert.ok(contrast(t[ink], t[bg]) >= 4.5, id + ': ' + ink + ' on ' + bg);
    }
  }
  assert.ok(contrast(t['--accent'], t['--canvas']) >= 4.5, id + ': accent on canvas');
}
assert.equal(normalizeAppearance(undefined).preset, 'light');
for (const id of Object.keys(PRESETS)) assert.equal(normalizeAppearance({ preset: id }).preset, id);
const css = readFileSync(new URL('../src/renderer/index.css', import.meta.url), 'utf8');
for (const [key, value] of Object.entries(PRESETS.light.tokens)) assert.ok(css.includes(key + ': ' + value + ';'), key + ' default matches Light');
console.log('theme tokens: AA contrast, CSS defaults and saved presets pass');
