import { test, expect } from './fixtures';

// T-026. The graph is a floating square over the editor, on by default, drawing
// the whole workspace -- not a full-height column showing the active note alone.

test('the graph is visible without touching a shortcut', async ({ page }) => {
  // No keypress, no focus juggling. It is on by default because it replaced a
  // panel that was always on; a graph you must discover a shortcut for is a
  // graph nobody sees. This also sidesteps the real problem that a global
  // keydown handler does nothing while the terminal or a webview holds focus.
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
  expect(box!.width).toBeLessThan(320);
});

test('the graph draws every note, not only the active one', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  const nodes = graph.locator('.graph-node');
  await expect(nodes.first()).toBeVisible();
  // The demo workspace has well over a dozen notes. The old panel scoped to the
  // active note and drew one.
  expect(await nodes.count()).toBeGreaterThan(5);

  const faded = await nodes.evaluateAll(
    (els) => els.filter((el) => Number((el as HTMLElement).style.opacity || '1') < 0.85).length,
  );
  expect(faded).toBe(0);
});

test('the graph sits over the editor and can be dismissed', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();
  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await expect(graph).toHaveCount(0);
});

test('no full-height graph column remains in the shell layout', async ({ page, workspace }) => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const layout = JSON.parse(readFileSync(join(workspace, '.neuron', 'layout.json'), 'utf-8'));
  const panels = JSON.stringify(layout);
  expect(panels).not.toContain('"graph"');
  // The editor gets the width back: it is the only panel besides the terminal.
  expect(panels).toContain('"editor"');
  expect(panels).toContain('"terminal"');
  // And the floating graph is what shows the workspace instead.
  await expect(page.getByRole('complementary', { name: 'Workspace graph' })).toBeVisible();
});
