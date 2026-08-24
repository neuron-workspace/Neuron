import { test, expect, openNote } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('launches a single window with the seeded workspace open', async ({ app, page }) => {
  expect(app.windows()).toHaveLength(1);
  await expect(page.locator('.note-row').first()).toBeVisible();
});

test('lists workspace notes in the explorer', async ({ page }) => {
  await expect(page.getByText('getting-started', { exact: false }).first()).toBeVisible();
});

test('opening a note shows its content', async ({ page }) => {
  await openNote(page, 'guides/markdown-basics.mdx');
  await expect(page.locator('.preview-prose').first()).toBeVisible();
});

test('an edit reaches disk as plain Markdown', async ({ page, workspace }) => {
  await openNote(page, 'guides/markdown-basics.mdx');

  // Markdown opens in reading view by default (App.tsx defaultEditorMode), so
  // .cm-content does not exist yet. Double-clicking the prose is the documented
  // way into the live editor and is the path a user actually takes.
  const prose = page.locator('.preview-prose').first();
  await expect(prose).toBeVisible();
  await prose.dblclick();

  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('e2e-marker');

  // Neuron saves on keystroke with no save button; poll the file rather than
  // guessing a debounce interval.
  const file = join(workspace, 'guides', 'markdown-basics.mdx');
  await expect
    .poll(() => readFileSync(file, 'utf-8').includes('e2e-marker'), { timeout: 15_000 })
    .toBe(true);
});

test('MDX import statements are not rendered as prose', async ({ page, workspace }) => {
  // A note that declares its components must not show the declaration to the
  // reader. Reading view is a line parser, not a real MDX compiler, so ESM
  // statements fell straight through as text.
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  writeFileSync(
    join(workspace, 'esm-note.mdx'),
    ["import { Callout } from '../components'", '', '# Heading', '', 'Body text.', ''].join('\n'),
  );

  await page.locator('button[aria-label="Refresh explorer"]').click();
  await page.locator('.note-row', { hasText: 'esm-note' }).first().click();
  const prose = page.locator('.preview-prose').first();
  await expect(prose).toBeVisible();
  await expect(prose).toContainText('Body text.');
  await expect(prose).not.toContainText('import {');
  await expect(prose).not.toContainText('../components');
});
