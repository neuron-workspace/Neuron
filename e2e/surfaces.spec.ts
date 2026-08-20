import { test, expect } from './fixtures';

// Each workspace file type routes to its own surface (src/renderer/surfaces).
// These assert the surface actually mounts -- a registry regression shows up
// here as a note editor rendering raw JSON instead of a board.

test('canvas opens as a board, not raw JSON', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Idea board' }).first().click();
  await expect(page.locator('svg').first()).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0);
});

test('database opens as a typed table', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Projects.db' }).first().click();
  await expect(page.locator('.vw-content, table').first()).toBeVisible();
});

test('an htmx view asks for its declared permissions before it renders', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Team dashboard' }).first().click();

  // A view does not run until its manifest permissions are granted -- the
  // prompt is the security boundary, so assert it appears BEFORE the webview.
  await expect(page.getByText('requests permissions', { exact: false })).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(0);

  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.getByText('HTMX view', { exact: false })).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(1);
});

test('scripting dashboard is labelled distinctly from an htmx view', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();
  const prompt = page.getByText('requests permissions', { exact: false });
  if (await prompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Allow for this view' }).click();
  }
  await expect(page.getByText('Scripting dashboard', { exact: false })).toBeVisible();
});

test('a folder mini-app collapses to one explorer entry', async ({ page }) => {
  await expect(page.locator('.note-row', { hasText: 'Launch board' }).first()).toBeVisible();
  // The folder's internals (neuron.app, neuron.app.json) must not be listed as
  // notes. Scoped to explorer rows -- the strings appear in demo note prose too.
  await expect(page.locator('.note-row', { hasText: 'neuron.app' })).toHaveCount(0);
});
