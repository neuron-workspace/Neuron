import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-012. Coverage for the everyday surfaces the harness did not reach.
// Every assertion here is about behaviour that would silently break a user's
// workspace, not about an element being on screen.

/**
 * Open a note through the command palette rather than the explorer.
 *
 * Folders are collapsed by default, so a row inside one is either absent or
 * detaches as the tree re-renders. The palette lists every note by full path
 * and is what a user reaches for anyway.
 */
async function openNote(page: import('@playwright/test').Page, path: string) {
  // Click the title-bar trigger rather than pressing Ctrl+K. The shortcut runs
  // through a global keydown handler attached on mount, so a press issued while
  // the renderer is still hydrating lands nowhere -- this spec passed alone and
  // failed about one run in two. Retrying the press is worse, not better: the
  // binding TOGGLES, so a second press closes what the first opened.
  const trigger = page.getByRole('button', { name: /Search & commands/ });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Filter first. The unfiltered list is long enough that the wanted entry may
  // be scrolled out of view, and a click on an off-screen item never lands.
  await dialog.getByRole('combobox').or(dialog.locator('input')).first().fill(path);
  await dialog.getByText(path, { exact: false }).first().click();
  await expect(dialog).toBeHidden();
}

test('closing a tab keeps the note on disk', async ({ page, workspace }) => {
  await openNote(page, 'markdown-basics.mdx');
  await openNote(page, 'getting-started.mdx');

  const tabs = page.locator('nav[aria-label="Open notes"]');
  await expect(tabs.getByText('markdown-basics')).toBeVisible();
  await expect(tabs.getByText('getting-started')).toBeVisible();

  await tabs.getByRole('button', { name: 'Close markdown-basics' }).click();
  await expect(tabs.getByText('markdown-basics')).toHaveCount(0);
  await expect(tabs.getByText('getting-started')).toBeVisible();

  // Closing a tab is not deleting a note. A user who conflates the two loses
  // work, so this is the assertion that matters, not the tab count.
  expect(readFileSync(join(workspace, 'markdown-basics.mdx'), 'utf-8').length).toBeGreaterThan(0);
});

test('frontmatter renders as editable properties', async ({ page }) => {
  await openNote(page, 'properties/project-atlas.mdx');
  const props = page.locator('[aria-label="Document properties"]');
  await expect(props).toBeVisible();
  // Values live in inputs, not text nodes -- the panel is an editor, not a
  // read-only summary, which is the thing worth asserting.
  const values = await props.locator('input').evaluateAll(
    (els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values).toContain('Project Atlas');
  await expect(props).toContainText('Tags');
});

test('invalid YAML degrades and never rewrites the file', async ({ page, workspace }) => {
  const file = join(workspace, 'properties', 'invalid-yaml.md');
  const before = readFileSync(file);

  await openNote(page, 'properties/invalid-yaml.md');
  await expect(page.locator('[aria-label="Document properties (error)"]')).toBeVisible();

  // The whole point of the degraded state: Neuron says it cannot read the
  // frontmatter and leaves it alone. "Repairing" malformed YAML would destroy
  // what the user actually typed, which is worse than refusing to show it.
  await page.waitForTimeout(1500);
  expect(readFileSync(file)).toEqual(before);
});

test('ticking a task checkbox writes it to disk', async ({ page, workspace }) => {
  await openNote(page, 'daily/2026-06-19.mdx');
  const file = join(workspace, 'daily', '2026-06-19.mdx');

  const box = page.locator('input[aria-label="Incomplete task"]').first();
  await expect(box).toBeVisible();
  await box.click();

  // Markdown is the source of truth: the tick has to land in the file as
  // - [x], not live only in renderer state.
  await expect
    .poll(() => (readFileSync(file, 'utf-8').match(/- \[x\]/gi) ?? []).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test('search narrows the explorer to matching notes', async ({ page }) => {
  await page.getByRole('button', { name: 'Search notes' }).first().click();
  const search = page.locator('section[aria-label="Search notes"]');
  await expect(search).toBeVisible();

  await search.getByRole('textbox').first().fill('wikilinks');
  await expect(search.locator('.note-row', { hasText: 'wikilinks' })).toHaveCount(1);
  await expect(search.locator('.note-row', { hasText: 'markdown-basics' })).toHaveCount(0);
});

test('changing the theme preset applies it to the document', async ({ page }) => {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.getByText('Open settings', { exact: false }).first().click();

  await page.getByRole('button', { name: /^Light$/ }).first().click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')), { timeout: 10_000 })
    .toBe('light');
});
