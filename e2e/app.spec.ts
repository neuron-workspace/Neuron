import { test, expect } from './fixtures';
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
  await page.locator('.note-row', { hasText: 'markdown-basics' }).first().click();
  await expect(page.locator('.preview-prose').first()).toBeVisible();
});

test('an edit reaches disk as plain Markdown', async ({ page, workspace }) => {
  await page.locator('.note-row', { hasText: 'markdown-basics' }).first().click();

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
  const file = join(workspace, 'markdown-basics.mdx');
  await expect
    .poll(() => readFileSync(file, 'utf-8').includes('e2e-marker'), { timeout: 15_000 })
    .toBe(true);
});
