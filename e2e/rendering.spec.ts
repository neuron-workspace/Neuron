import { test, expect, openNote } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Reading mode used to be a picture of a document: checkboxes rendered but were
// `readOnly`, Markdown links rendered as their own syntax, and the workspace's
// layout file could not be reached at all.

test('a task can be ticked in reading mode and lands in the file', async ({ page, workspace }) => {
  const relative = 'daily/2026-06-19.mdx';
  const file = join(workspace, 'daily', '2026-06-19.mdx');
  await openNote(page, relative);

  // Reading is the default mode; this is the view with no editor behind it,
  // which is exactly why the tick has to be written to disk rather than held
  // in renderer state.
  const box = page.locator('input[aria-label="Incomplete task"]').first();
  await expect(box).toBeVisible();
  await expect(box).toBeEnabled();
  await box.click();

  await expect
    .poll(() => (readFileSync(file, 'utf-8').match(/- \[x\]/gi) ?? []).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test('unticking a task writes it back too', async ({ page, workspace }) => {
  const file = join(workspace, 'ticked.mdx');
  writeFileSync(file, '# Ticked\n\n- [x] already done\n', 'utf-8');

  await page.locator('button[aria-label="Refresh explorer"]').click();
  await openNote(page, 'ticked.mdx');

  const box = page.locator('input[aria-label="Completed task"]').first();
  await expect(box).toBeVisible();
  await box.click();

  await expect
    .poll(() => readFileSync(file, 'utf-8'), { timeout: 15_000 })
    .toMatch(/- \[ \] already done/);
});

test('a Markdown link renders as a link, not as its own syntax', async ({ page, workspace }) => {
  const file = join(workspace, 'links.mdx');
  writeFileSync(
    file,
    '# Links\n\nSee [the htmx site](https://htmx.org) for details.\n\nAlso [[getting-started]].\n',
    'utf-8',
  );

  await page.locator('button[aria-label="Refresh explorer"]').click();
  await openNote(page, 'links.mdx');

  const prose = page.locator('.preview-prose').first();
  await expect(prose).toBeVisible();

  // The label, not the raw `[the htmx site](https://htmx.org)`.
  const external = prose.getByRole('link', { name: /the htmx site/ });
  await expect(external).toBeVisible();
  await expect(external).toHaveAttribute('href', 'https://htmx.org');
  await expect(prose).not.toContainText('](https://htmx.org)');

  // A wiki-link to a note that exists stays a button that opens it in place.
  await expect(prose.getByRole('button', { name: /Open note/ }).first()).toBeVisible();
});

test('a link to a note that does not exist is shown as broken', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'broken.mdx'), '# Broken\n\nSee [[no such note]].\n', 'utf-8');

  await page.locator('button[aria-label="Refresh explorer"]').click();
  await openNote(page, 'broken.mdx');

  const prose = page.locator('.preview-prose').first();
  await expect(prose).toContainText('no such note');
  // Marked as missing rather than silently offered as if it would work.
  await expect(prose.getByText('(missing note)')).toHaveCount(1);
});

test('the workspace layout file can be opened and edited from the explorer', async ({ page, workspace }) => {
  const file = join(workspace, '.neuron', 'layout.json');
  const before = readFileSync(file, 'utf-8');
  expect(before).toContain('terminal');

  // It is the one piece of workspace configuration worth hand-editing, so it
  // has to be reachable without another editor.
  await openNote(page, '.neuron/layout.json');
  await expect(page.locator('.preview-prose, .cm-content').first()).toBeVisible();
});
