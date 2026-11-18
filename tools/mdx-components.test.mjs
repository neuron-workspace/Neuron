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
const { moveColumn, splitColumns, resolveWidths, roundWidths, dragWidths, writeColumnWidths } = await import('data:text/javascript;base64,' + Buffer.from(columnsBuild.outputFiles[0].contents).toString('base64'));
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

const first = '<Column width="40%">\n# First\n<Callout title="Nested">\n- One\n- Two\n</Callout>\n</Column>';
const middle = '<Column>\nMiddle\n<Columns>\n<Column>Inner</Column>\n<Column>Inner 2</Column>\n</Columns>\n</Column>';
const last = '<Column width="20%">\nLast\n</Column>';
const row = (...columns) => '<Columns>\n' + columns.join('\n\n') + '\n</Columns>';
assert.equal(moveColumn(row(first, middle), 0, 0, 1), row(middle, first), 'two columns keep their entire content and widths');
assert.equal(moveColumn(row(first, middle), 0, 1, 0), row(middle, first), 'a column without a width moves too');
assert.equal(moveColumn(row(first, middle, last), 0, 0, 2), row(middle, last, first), 'first to last');
assert.equal(moveColumn(row(first, middle, last), 0, 2, 0), row(last, first, middle), 'last to first');
assert.equal(moveColumn(row(first, middle, last), 0, 1, 2), row(first, last, middle), 'nested Columns moves intact');
assert.equal(moveColumn(block, 0, 1, 1), block, 'same position is byte-identical');
const prefix = '---\r\ntitle: Test\r\n---\r\n\r\n';
const suffix = '\r\n\r\n' + row(first, last);
assert.equal(moveColumn(prefix + row(first, middle).replaceAll('\n', '\r\n') + suffix, 4, 0, 1),
  prefix + row(middle, first).replaceAll('\n', '\r\n') + suffix, 'frontmatter, CRLF, and another row stay untouched');
assert.equal(moveColumn(row(first, middle), 1, 0, 1), row(first, middle), 'only a Columns start line is accepted');
assert.equal(moveColumn(block, 0, -1, 0), block);
assert.equal(moveColumn(block, 0, 0, 3), block);
const nestedColumn = '<Column><Card><Column>Nested column</Column></Card></Column>';
assert.equal(moveColumn(row(nestedColumn, last), 0, 0, 1), row(last, nestedColumn), 'matching close includes a directly nested Column');
assert.equal(moveColumn(row('<Column />', last), 0, 0, 1), row(last, '<Column />'), 'empty columns can move');

console.log('mdx components: 51 assertions passed (badge aliases, numeric columns, Columns widths and moves)');
