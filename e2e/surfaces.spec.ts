import { test, expect } from './fixtures';

// Each workspace file type routes to its own surface (src/renderer/surfaces).
// These assert the surface actually mounts -- a registry regression shows up
// here as a note editor rendering raw JSON instead of a board.

test('canvas opens as a board, fitted to its content', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Idea board' }).first().click();
  await expect(page.locator('svg').first()).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0);

  // It used to open at pan (80,80) zoom 1 -- the top-left of an infinite plane,
  // so a board whose content sits elsewhere showed empty space with cards
  // sliced off at the edges. Every node must be inside the viewport on open,
  // without anyone pressing "Zoom to fit".
  const view = (await page.locator('[data-canvas-surface]').boundingBox())!;
  const cards = page.locator('[data-canvas-node]');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const b = await cards.nth(i).boundingBox();
    if (!b) continue;
    expect(b.x).toBeGreaterThanOrEqual(view.x - 2);
    expect(b.y).toBeGreaterThanOrEqual(view.y - 2);
    expect(b.x + b.width).toBeLessThanOrEqual(view.x + view.width + 2);
  }
});

test('a multi-table database opens its schema overview, then drills into a table', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Planner.db' }).first().click();

  // Planner.db holds two tables, so it opens the overview rather than guessing
  // which one you meant (D28). A single-table file opens straight into it.
  await expect(page.getByText('Tasks', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Projects', { exact: true }).first()).toBeVisible();

  await page.getByText('Tasks', { exact: true }).first().click();
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
