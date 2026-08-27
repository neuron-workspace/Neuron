import { test, expect, openNote } from './fixtures';
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

test('closing a tab keeps the note on disk', async ({ page, workspace }) => {
  await openNote(page, 'guides/markdown-basics.mdx');
  await openNote(page, 'getting-started.mdx');

  const tabs = page.locator('nav[aria-label="Open notes"]');
  await expect(tabs.getByText('markdown-basics')).toBeVisible();
  await expect(tabs.getByText('getting-started')).toBeVisible();

  await tabs.getByRole('button', { name: 'Close markdown-basics' }).click();
  await expect(tabs.getByText('markdown-basics')).toHaveCount(0);
  await expect(tabs.getByText('getting-started')).toBeVisible();

  // Closing a tab is not deleting a note. A user who conflates the two loses
  // work, so this is the assertion that matters, not the tab count.
  expect(readFileSync(join(workspace, 'guides', 'markdown-basics.mdx'), 'utf-8').length).toBeGreaterThan(0);
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

test('search matches note names', async ({ page }) => {
  await page.getByRole('button', { name: 'Search notes' }).first().click();
  const search = page.locator('section[aria-label="Search notes"]');
  await expect(search).toBeVisible();

  await search.getByRole('textbox').first().fill('wikilinks');
  await expect(search.getByText('wikilinks', { exact: false }).first()).toBeVisible();
  await expect(search.getByText('markdown-basics', { exact: false })).toHaveCount(0);
});

test('search looks inside notes, not just at their names', async ({ page }) => {
  await page.getByRole('button', { name: 'Search notes' }).first().click();
  const search = page.locator('section[aria-label="Search notes"]');
  await expect(search).toBeVisible();

  // "sandbox" appears in the body of Dashboard.mdx and in no filename at all,
  // so before search read note contents this returned nothing.
  await search.getByRole('textbox').first().fill('sandbox');
  await expect(search.getByText('Dashboard.mdx', { exact: false }).first()).toBeVisible();

  // And it shows the line it matched, so a body hit is not a bare filename.
  await expect(search.getByText(/sandbox/i).first()).toBeVisible();
});

test('a second search word narrows rather than widens', async ({ page }) => {
  await page.getByRole('button', { name: 'Search notes' }).first().click();
  const search = page.locator('section[aria-label="Search notes"]');
  const box = search.getByRole('textbox').first();

  await box.fill('htmx');
  const broad = await search.locator('button', { hasText: /\.(md|mdx|html)/ }).count();
  expect(broad).toBeGreaterThan(1);

  await box.fill('htmx sandbox');
  const narrow = await search.locator('button', { hasText: /\.(md|mdx|html)/ }).count();
  expect(narrow).toBeLessThan(broad);
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
