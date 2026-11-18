import { test, expect, openNote } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
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

// Full-text search has no sidebar row; the command palette opens it.
async function openNoteSearch(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill('Search in notes');
  await dialog.getByText('Search in notes', { exact: true }).first().click();
  await expect(dialog).toBeHidden();
}

test('closing a tab keeps the note on disk', async ({ page, workspace }) => {
  const tabs = page.locator('nav[aria-label="Open notes"]');
  await openNote(page, 'guides/markdown-basics.mdx');
  // Opened from the palette it is a preview, which the next open would replace.
  await tabs.getByRole('button', { name: 'markdown-basics', exact: true }).dblclick();
  await openNote(page, 'getting-started.mdx');

  await expect(tabs.getByText('markdown-basics')).toBeVisible();
  await expect(tabs.getByText('getting-started')).toBeVisible();

  await tabs.getByRole('button', { name: 'Close markdown-basics' }).click();
  await expect(tabs.getByText('markdown-basics')).toHaveCount(0);
  await expect(tabs.getByText('getting-started')).toBeVisible();

  // Closing a tab is not deleting a note. A user who conflates the two loses
  // work, so this is the assertion that matters, not the tab count.
  expect(readFileSync(join(workspace, 'guides', 'markdown-basics.mdx'), 'utf-8').length).toBeGreaterThan(0);
});

test('frontmatter renders as editable properties', async ({ page, workspace }) => {
  const file = join(workspace, 'properties', 'project-atlas.mdx');
  const before = readFileSync(file, 'utf8');
  await openNote(page, 'properties/project-atlas.mdx');
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const props = page.locator('[aria-label="Document properties"]');
  await expect(props).toBeVisible();
  // Text reads as part of the document until its control is activated.
  await expect(props).toContainText('Project Atlas');
  await expect(props).toContainText('Tags');
  await props.getByLabel('Title', { exact: true }).click();
  const title = props.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeEnabled();
  await title.fill('Updated Atlas');
  await title.press('Enter');
  await expect(props.getByLabel('Title', { exact: true })).toHaveText('Updated Atlas');
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('Updated Atlas');
  expect(readFileSync(file, 'utf8').split(/---\r?\n/).slice(2).join('---\n')).toBe(before.split(/---\r?\n/).slice(2).join('---\n'));
  await props.getByRole('button', { name: 'Properties actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit as YAML' }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
});

test('properties wrap at 720px, collapse and keep typed value controls', async ({ page, workspace }) => {
  const file = join(workspace, 'property-states.mdx');
  writeFileSync(file, [
    '---', `description: ${'A long property value that should wrap. '.repeat(12)}`,
    'tags: [alpha, beta, gamma, delta, epsilon, zeta, eta, theta, iota, kappa, lambda, mu]',
    'empty: ""', 'due: 2026-11-18', 'completed: true', 'rating: 1234.5',
    'url: https://example.com/a/path', '---', '', '# Property states',
  ].join('\n'));
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'property-states.mdx');
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const props = page.getByRole('region', { name: 'Document properties', exact: true });
  await props.evaluate((element) => { element.style.width = '720px'; element.style.maxWidth = '100%'; });
  await expect(props).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(props).toHaveCSS('border-top-width', '0px');
  await expect(props).toHaveCSS('border-bottom-style', 'solid');
  expect(await props.evaluate((element) => parseFloat(getComputedStyle(element).borderBottomWidth))).toBeGreaterThan(0);
  expect(await props.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(props.getByLabel('Empty', { exact: true })).toHaveText('Empty');
  await expect(props.getByRole('link', { name: 'example.com' })).toHaveAttribute('href', 'https://example.com/a/path');
  await expect(props.getByRole('checkbox', { name: 'Completed', exact: true })).toBeChecked();
  await expect(props.getByLabel('Rating', { exact: true })).toHaveCSS('font-variant-numeric', 'tabular-nums');
  await props.getByLabel('Due', { exact: true }).click();
  await expect(props.locator('input[type="date"]')).toHaveValue('2026-11-18');
  await props.locator('input[type="date"]').fill('2026-11-19');
  await props.getByRole('button', { name: /^Properties ·/ }).click();
  await expect(props.getByRole('button', { name: /^Properties ·/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(props.getByLabel('Description', { exact: true })).toHaveCount(0);
  await props.getByRole('button', { name: /^Properties ·/ }).click();
  await expect(props.getByLabel('Description', { exact: true })).toBeVisible();
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('2026-11-19');
  await page.getByRole('button', { name: 'Reading', exact: true }).first().click();
  await expect(props.getByRole('button', { name: 'Add property', exact: true })).toHaveCount(0);
  await expect(props.getByRole('link', { name: 'example.com' })).toBeVisible();
});

test('invalid YAML uses the error callout and retains its source action', async ({ page, workspace }) => {
  const file = join(workspace, 'properties', 'invalid-yaml.md');
  const before = readFileSync(file);
  await openNote(page, 'properties/invalid-yaml.md');
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const error = page.getByRole('region', { name: 'Document properties (error)', exact: true });
  await expect(error).toHaveClass(/callout/);
  await expect(error).toHaveAttribute('data-callout-kind', 'error');
  await expect(error).toContainText('the frontmatter YAML is invalid');
  await error.getByRole('button', { name: 'Edit as YAML', exact: true }).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  expect(readFileSync(file)).toEqual(before);
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
  await openNoteSearch(page);
  const search = page.locator('section[aria-label="Search notes"]');
  await expect(search).toBeVisible();

  await search.getByRole('textbox').first().fill('wikilinks');
  await expect(search.getByText('wikilinks', { exact: false }).first()).toBeVisible();
  await expect(search.getByText('markdown-basics', { exact: false })).toHaveCount(0);
});

test('search looks inside notes, not just at their names', async ({ page }) => {
  await openNoteSearch(page);
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
  await openNoteSearch(page);
  const search = page.locator('section[aria-label="Search notes"]');
  const box = search.getByRole('textbox').first();

  await box.fill('htmx');
  const broad = await search.locator('button', { hasText: /\.(md|mdx|html)/ }).count();
  expect(broad).toBeGreaterThan(1);

  await box.fill('htmx sandbox');
  const narrow = await search.locator('button', { hasText: /\.(md|mdx|html)/ }).count();
  expect(narrow).toBeLessThan(broad);
});
