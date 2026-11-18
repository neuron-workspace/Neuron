import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/renderer/components/mdx-components.tsx'],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
});
const { numericColumns, parseBadgeType, parseSemanticType } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));

for (const alias of ['neutral', 'default', 'plain', ' PLAIN ']) {
  assert.equal(parseBadgeType(alias), 'neutral');
  assert.equal(parseSemanticType(alias), 'info', 'Badge aliases must not add Callout kinds');
}
for (const kind of ['success', 'info', 'warning', 'error', 'tip', 'note', 'caution', 'danger']) {
  assert.equal(parseBadgeType(kind), parseSemanticType(kind));
}
assert.equal(parseBadgeType('unknown'), 'info');
assert.equal(parseBadgeType(undefined), 'info');
assert.deepEqual(numericColumns([['Ada', '-1.5', '7'], ['Lin', '+12', 'pending']], 3), [false, true, false]);
assert.deepEqual(numericColumns([['0', '.5', '2.'], ['12', '-.5', ' 3 ']], 3), [true, true, true]);
assert.deepEqual(numericColumns([['1', ''], ['2']], 2), [true, false]);
assert.deepEqual(numericColumns([], 2), [false, false]);
assert.deepEqual(numericColumns([['Infinity'], ['NaN']], 1), [false]);
console.log('mdx components: 23 assertions passed (badge aliases and numeric columns)');
