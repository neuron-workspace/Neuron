import { test, expect } from './fixtures';

// T-026. The graph is a dismissible square over the editor, not a dock, and it
// draws the whole workspace rather than just the active note's neighbours.

test('the graph opens as a floating square and can be dismissed', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'markdown-basics' }).first().click();

  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toHaveCount(0);

  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+Shift+G');
  await expect(graph).toBeVisible();

  // Square, and small enough to stay peripheral rather than becoming a dock.
  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
  expect(box!.width).toBeLessThan(320);

  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await expect(graph).toHaveCount(0);
});

test('the graph draws every note, not only the active one', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'markdown-basics' }).first().click();
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+Shift+G');

  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  // Unconnected notes used to render at 0.32 opacity and read as absent. Every
  // node must be drawn and none may be faded out of usefulness.
  const nodes = graph.locator('.graph-node');
  await expect(nodes.first()).toBeVisible();
  expect(await nodes.count()).toBeGreaterThan(3);

  const faded = await nodes.evaluateAll(
    (els) => els.filter((el) => Number((el as HTMLElement).style.opacity || '1') < 0.85).length,
  );
  expect(faded).toBe(0);
});
