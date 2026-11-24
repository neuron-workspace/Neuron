import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: the graph. It opens from the toolbar and either draws the
// workspace or says it needs WebGL, and clicking a node opens its note.
// graph.spec.ts, search-graph.spec.ts and layout.spec.ts hold the detail
// (layout, camera, settings, dragging and docking).

const NO_WEBGL = "The graph needs WebGL, which isn't available on this computer.";
const graph = (page: Page) => page.getByRole('complementary', { name: 'Workspace graph' });

/** Open the graph and wait for Sigma to draw it, or for the no-WebGL message. Returns whether it drew. */
async function showGraph(page: Page): Promise<{ drawn: boolean; canvas: Locator }> {
  await page.getByRole('button', { name: 'Show graph', exact: true }).click();
  const canvas = graph(page).locator('[data-graph-canvas]');
  const nodes = canvas.locator('canvas.sigma-nodes');
  const alert = graph(page).getByRole('alert');
  await expect(nodes.or(alert)).toBeVisible();
  if (await alert.isVisible()) {
    await expect(alert).toHaveText(NO_WEBGL);
    return { drawn: false, canvas };
  }
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(2);
  await expect(graph(page).locator('[data-graph-root]')).toHaveAttribute('data-layout-running', 'false');
  return { drawn: true, canvas };
}

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  writeFileSync(join(dir, 'alpha.md'), '# Alpha\n\n[[beta]]\n');
  writeFileSync(join(dir, 'beta.md'), '# Beta\n\n[[gamma]]\n');
  writeFileSync(join(dir, 'gamma.md'), '# Gamma\n\n[[alpha]]\n');
}) });

test('the toolbar opens the graph, which draws every note or says it needs WebGL, and closes again', async ({ page }) => {
  const { drawn, canvas } = await showGraph(page);
  if (drawn) {
    expect(await canvas.evaluate((el: any) => el.sigma.getGraph().order)).toBe(3);
  }
  await graph(page).getByRole('button', { name: 'Hide graph' }).click();
  await expect(graph(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Show graph', exact: true }).click();
  await expect(graph(page)).toBeVisible();
});

test('clicking a node opens its note', async ({ page }) => {
  const { drawn, canvas } = await showGraph(page);
  test.skip(!drawn, 'This machine has no WebGL, so there are no nodes to click.');
  // Sigma hit-tests against what it has drawn; wait for a frame (see graph.spec.ts).
  await canvas.evaluate((el: any) => new Promise<void>((resolve) => {
    el.sigma.once('afterRender', () => resolve());
    el.sigma.refresh();
  }));
  const rect = (await canvas.boundingBox())!;
  const target = await canvas.evaluate((el: any) => el.sigma.graphToViewport(el.sigma.getGraph().getNodeAttributes('beta.md')));
  await page.mouse.click(rect.x + target.x, rect.y + target.y);
  await expect(page.getByLabel('Note path')).toHaveAttribute('title', 'beta.md');
});

test.describe('without WebGL', () => {
  // No GPU and no software rasterizer: no WebGL anywhere (the fixture then leaves SwiftShader out).
  test.use({ launchArgs: ['--disable-gpu', '--disable-software-rasterizer'] });

  test('the graph says it needs WebGL, and notes still open beside it', async ({ page }) => {
    await page.getByRole('button', { name: 'Show graph', exact: true }).click();
    await expect(graph(page).getByRole('alert')).toHaveText(NO_WEBGL);
    await expect(graph(page).locator('canvas')).toHaveCount(0);
    await openNote(page, 'alpha.md');
    await expect(page.locator('article.preview-prose h1').first()).toHaveText('Alpha');
    await expect(graph(page).getByRole('alert')).toBeVisible();
  });
});
