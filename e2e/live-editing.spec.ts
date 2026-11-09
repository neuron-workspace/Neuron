import { test, expect, openNote } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const note = 'live-editing.mdx';
const callout = '<Callout title="Keep this title">\nCallout **body**.\n</Callout>';
const original = [
  '---', 'title: Live editing # keep comment', 'tags: [test]', '---',
  '# Live editing', '', '## Section title', '',
  'A paragraph with *emphasis* and `code`.', '',
  '- First item', '- Second item', '',
  'Keep **bold** and [[getting-started]] together.', '',
  callout, '', 'After the block.', '',
].join('\n');
const selectAll = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
const end = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

// As in window-chrome: prove the mounted shortcut handler can close the
// button-opened palette before sending editing keys.
async function ready(page: Page) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(async () => {
    if (await dialog.isVisible()) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await page.waitForTimeout(200);
    return dialog.isVisible();
  }, { timeout: 15_000 }).toBe(false);
}

async function live(page: Page) {
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  await expect(page.locator('[data-live-preview]')).toBeVisible();
}
async function blur(page: Page) {
  await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
}
async function append(page: Page, line: Locator, text: string) {
  await line.click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(text);
}
async function source(page: Page, text: string) {
  const editor = page.locator('.live-block-editor .cm-content');
  await expect(editor).toBeFocused();
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText(text);
}

test.beforeEach(async ({ workspace, page }) => {
  writeFileSync(join(workspace, note), original);
  await ready(page);
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, note);
  await expect(page.locator('article.preview-prose h1')).toHaveText('Live editing');
});

test('Live keeps Reading typography and component DOM without a CodeMirror document', async ({ page }) => {
  const prose = page.locator('article.preview-prose');
  const snapshot = () => prose.locator('h1, h2, h3, p').evaluateAll((nodes) => nodes
    .filter((node) => node.textContent)
    .map((node) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName, text: node.textContent,
        classes: node.className.replace(/\blive-text\b/g, '').trim(),
        font: style.font, margin: style.margin, padding: style.padding,
      };
    }));
  const reading = await snapshot();
  await expect(prose.locator('[contenteditable="true"]')).toHaveCount(0);
  await live(page);
  expect(await snapshot()).toEqual(reading);
  await expect(page.locator('.cm-editor')).toHaveCount(0);
  await expect(prose.locator('.callout [contenteditable="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reading', exact: true }).first().click();
  await prose.locator('h1').dblclick();
  await expect(page.locator('[data-live-preview]')).toBeVisible();
});

test('paragraph edits commit on blur without changing other markup or frontmatter', async ({ page, workspace }) => {
  await live(page);
  const line = page.locator('p[data-live-line]').filter({ hasText: 'A paragraph' });
  await append(page, line, ' Added.');
  await blur(page);
  await expect.poll(() => readFileSync(join(workspace, note), 'utf8')).toBe(original.replace('and `code`.', 'and `code`. Added.'));
});

test('heading text edits preserve the ## prefix', async ({ page, workspace }) => {
  await live(page);
  await append(page, page.locator('h2[data-live-line]'), ' updated');
  await blur(page);
  await expect.poll(() => readFileSync(join(workspace, note), 'utf8')).toBe(original.replace('## Section title', '## Section title updated'));
});

test('Enter at the end of a list item inserts and focuses the next item', async ({ page, workspace }) => {
  await live(page);
  const first = page.locator('li[data-live-line]').filter({ hasText: 'First item' });
  await append(page, first, '');
  await page.keyboard.press('Enter');
  const next = page.locator('li[data-live-line]').nth(1);
  await expect(next).toBeFocused();
  await expect(next).toHaveText('');
  await page.keyboard.insertText('Inserted item');
  await blur(page);
  await expect.poll(() => readFileSync(join(workspace, note), 'utf8')).toBe(original.replace('- First item\n', '- First item\n- Inserted item\n'));
});

test('bold text and an atomic wiki link survive editing the surrounding paragraph', async ({ page, workspace }) => {
  await live(page);
  const line = page.locator('p[data-live-line]').filter({ hasText: 'Keep bold' });
  await expect(line.locator('strong')).toHaveText('bold');
  await expect(line.locator('[data-md="[[getting-started]]"]')).toHaveAttribute('contenteditable', 'false');
  await append(page, line, ' Still together.');
  await blur(page);
  await expect.poll(() => readFileSync(join(workspace, note), 'utf8')).toBe(original.replace('together.', 'together. Still together.'));
  await expect(line.locator('strong')).toHaveText('bold');
});

test('Callout Edit writes only its block, Done renders it, and Cancel discards its draft', async ({ page, workspace }) => {
  await live(page);
  const block = page.locator('.live-block').filter({ has: page.locator('.callout') });
  await block.hover();
  await block.getByRole('button', { name: 'Edit Callout', exact: true }).click();
  const changed = callout.replace('Callout **body**.', 'Changed **body**.\nAnother line.');
  await source(page, changed);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const saved = original.replace(callout, changed);
  await expect.poll(() => readFileSync(join(workspace, note), 'utf8')).toBe(saved);
  await expect(block).toContainText('Changed body.');
  await expect(page.locator('.cm-editor')).toHaveCount(0);
  await block.hover();
  await block.getByRole('button', { name: 'Edit Callout', exact: true }).click();
  await source(page, callout.replace('body', 'discarded'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(readFileSync(join(workspace, note), 'utf8')).toBe(saved);
  await expect(block).not.toContainText('discarded');
});

test('Escape restores a paragraph and performs no disk write', async ({ page, workspace }) => {
  await live(page);
  const file = join(workspace, note);
  const before = statSync(file).mtimeMs;
  const line = page.locator('p[data-live-line]').filter({ hasText: 'A paragraph' });
  await append(page, line, ' Discard me.');
  await page.keyboard.press('Escape');
  await expect(line).not.toContainText('Discard me.');
  await blur(page);
  await page.waitForTimeout(500);
  expect(readFileSync(file, 'utf8')).toBe(original);
  expect(statSync(file).mtimeMs).toBe(before);
});

test('Backspace removes an inserted empty paragraph and returns to the previous text', async ({ page, workspace }) => {
  await live(page);
  const heading = page.locator('h2[data-live-line]');
  await append(page, heading, '');
  await page.keyboard.press('Enter');
  await expect(page.locator('p[data-live-line]:focus')).toHaveText('');
  await page.keyboard.press('Backspace');
  await expect(heading).toBeFocused();
  await page.keyboard.insertText(' end');
  await blur(page);
  await expect.poll(() => readFileSync(join(workspace, note), 'utf8')).toBe(original.replace('## Section title', '## Section title end'));
});

test('opening a second block commits the first and rebases its source lines', async ({ page, workspace }) => {
  const file = join(workspace, note);
  const second = '<Badge text="Second block" />';
  writeFileSync(file, original + second + '\n');
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, note);
  await live(page);
  // The note was already open from beforeEach; the rewrite above reaches it
  // through the file watcher, a moment after the click.
  await expect(page.locator('[data-live-preview]').getByText('Second block')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Callout', exact: true }).focus();
  await page.keyboard.press('Enter');
  const changed = callout.replace('Callout **body**.', 'First edit.\nExtra line.');
  await source(page, changed);
  await page.getByRole('button', { name: 'Edit Badge', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-editor')).toHaveCount(1);
  await source(page, '<Badge text="Second edit" />');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe((original + second + '\n').replace(callout, changed).replace(second, '<Badge text="Second edit" />'));
  await page.getByRole('button', { name: 'Edit Badge', exact: true }).press('Enter');
  await source(page, '<Badge text="Cancelled" />');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-editor')).toHaveCount(0);
  expect(readFileSync(file, 'utf8')).not.toContain('Cancelled');
});

test('empty notes provide an editable starting paragraph', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'empty-live.md'), '');
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'empty-live.md');
  await live(page);
  const line = page.locator('p[data-live-line]');
  await expect(line).toHaveAttribute('data-placeholder', 'Start writing…');
  await line.click();
  await page.keyboard.insertText('First words');
  await blur(page);
  await expect.poll(() => readFileSync(join(workspace, 'empty-live.md'), 'utf8')).toBe('First words');
});
