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
// <Columns>: finding columns, resolving widths, and writing dragged widths back.
const columnsBuild = await build({ entryPoints: ['src/renderer/lib/columns.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { splitColumns, resolveWidths, roundWidths, dragWidths, writeColumnWidths } = await import('data:text/javascript;base64,' + Buffer.from(columnsBuild.outputFiles[0].contents).toString('base64'));
const block = [
  '<Columns>', '<Column width="40%">', 'Left', '</Column>', '<Column>', 'Middle',
  '<Columns>', '<Column>', 'Inner', '</Column>', '<Column>', 'Inner 2', '</Column>', '</Columns>',
  '</Column>', '<Column width="junk">', 'Right', '</Column>', '</Columns>',
].join('\n');
const segments = splitColumns(block);
assert.equal(segments.length, 3, 'a nested Columns keeps its columns to itself');
assert.deepEqual(segments.map((s) => s.width), ['40%', undefined, 'junk']);
assert.equal(segments[0].content.trim(), 'Left');
assert.ok(segments[1].content.includes('Inner 2'));
assert.deepEqual(resolveWidths([undefined, undefined]), [50, 50]);
assert.deepEqual(resolveWidths(['40%', undefined, 'junk']), [40, 30, 30]);
assert.deepEqual(resolveWidths(['80', '80']), [50, 50], 'over-full widths are scaled');
assert.deepEqual(roundWidths([33.333, 33.333, 33.334]), [33, 33, 34]);
assert.equal(roundWidths([12.5, 37.5, 25.2, 24.8]).reduce((a, b) => a + b, 0), 100);
assert.deepEqual(dragWidths([50, 50], 0, 15), [65, 35]);
assert.deepEqual(dragWidths([50, 50], 0, 80), [90, 10], 'no column narrower than 10%');
assert.deepEqual(dragWidths([50, 50], 1, 10), [50, 50], 'no divider after the last column');
const written = writeColumnWidths(block, [30, 45, 25]);
assert.deepEqual(splitColumns(written).map((s) => s.width), ['30%', '45%', '25%']);
assert.ok(written.includes('<Column width="45%">\nMiddle'), 'a column without a width gains one');
assert.ok(written.includes('<Column>\nInner\n'), 'nested columns are left alone');
assert.equal(writeColumnWidths(written, [30, 45, 25]), written);

console.log('mdx components: 39 assertions passed (badge aliases, numeric columns, Columns widths)');
