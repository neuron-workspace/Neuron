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

// Callouts: read the mix percentages from the stylesheet itself, so the check
// follows whatever the CSS ships. srgb mixing is a per-channel blend of the
// encoded values, which is what `mix` does.
const calloutRule = /\n\.callout \{([^}]*)\}/.exec(css)?.[1] ?? '';
const tint = Number(/background: color-mix\(in srgb, var\(--callout-color\) (\d+)%, var\(--canvas\)\)/.exec(calloutRule)?.[1]);
const edge = Number(/border: 1px solid color-mix\(in srgb, var\(--callout-color\) (\d+)%, var\(--canvas\)\)/.exec(calloutRule)?.[1]);
assert.ok(tint > 0 && edge > tint, 'callout tint and border percentages found in index.css');
const mix = (color, base, percent) => '#' + [1, 3, 5].map((i) => {
  const value = parseInt(color.slice(i, i + 2), 16) * percent / 100 + parseInt(base.slice(i, i + 2), 16) * (100 - percent) / 100;
  return Math.round(value).toString(16).padStart(2, '0');
}).join('');
for (const id of ['light', 'graphite']) {
  const t = PRESETS[id].tokens;
  for (const kind of ['--positive', '--info', '--warning', '--danger']) {
    const background = mix(t[kind], t['--canvas'], tint);
    assert.ok(contrast(t[kind], background) >= 3, id + ': ' + kind + ' callout icon on its tint');
    // Title is --ink; body is --md-text, which defaults to --ink-secondary.
    for (const ink of ['--ink', '--ink-secondary']) {
      assert.ok(contrast(t[ink], background) >= 4.5, id + ': ' + ink + ' on the ' + kind + ' callout tint');
    }
  }
  for (const kind of ['--positive', '--info', '--warning', '--danger', '--ink-muted']) {
    const badgeRule = /\n\.mdx-badge \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const foreground = Number(/color: color-mix\(in srgb, var\(--callout-color\) (\d+)%, var\(--ink\)\)/.exec(badgeRule)?.[1]);
    assert.ok(foreground > 0, 'badge foreground mix found in index.css');
    assert.ok(contrast(mix(t[kind], t['--ink'], foreground), mix(t[kind], t['--canvas'], tint)) >= 4.5, id + ': ' + kind + ' badge text on its tint');
  }
}
console.log('theme tokens: AA contrast, callout tints, CSS defaults and saved presets pass');
