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

test('an HTML view names the file and asks for its declared permissions before it renders', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Team dashboard' }).first().click();

  // A view does not run until its manifest permissions are granted -- the
  // prompt is the security boundary, so assert it appears BEFORE the webview.
  // Scope to the prompt: the filename also appears in the title bar, the sidebar
  // row and the tab, so a bare getByText matches four elements. What matters
  // here is that the PROMPT names the real file -- the manifest's self-declared
  // name is attacker-controlled, so identifying the view by path is the control.
  const prompt = page.getByText('requests workspace access');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Team dashboard.html');
  await expect(page.locator('webview')).toHaveCount(0);

  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.getByText('HTML view', { exact: false })).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(1);
});

test('an inline-script HTML file uses the same isolated view surface', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();
  const prompt = page.getByText('requests workspace access', { exact: false });
  if (await prompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Allow for this view' }).click();
  }
  await expect(page.getByText('HTML view', { exact: false })).toBeVisible();
});

test('a folder mini-app collapses to one explorer entry', async ({ page }) => {
  await expect(page.locator('.note-row', { hasText: 'Launch board' }).first()).toBeVisible();
  // The folder's internals (index.html, neuron.app.json) must not be listed as
  // notes. Scoped to explorer rows -- the strings appear in demo note prose too.
  await expect(page.locator('.note-row', { hasText: 'index.html' })).toHaveCount(0);
  await expect(page.locator('.note-row', { hasText: 'neuron.app.json' })).toHaveCount(0);
});
