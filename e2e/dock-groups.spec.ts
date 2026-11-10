import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Graph and Version history are both enabled by default and both live in the
// right dock, so a fresh profile has two tabs to split.
const groups = (page: Page) => page.locator('[data-dock-group^="right:"]');
const tab = (page: Page, name: string) => groups(page).getByRole('button', { name, exact: true });

async function openRightDock(page: Page) {
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await expect(groups(page)).toHaveCount(1);
  await expect(tab(page, 'Graph')).toBeVisible();
  await expect(tab(page, 'Version history')).toBeVisible();
}

test('a panel splits into its own group from the menu, joins back, and survives reload', async ({ page }) => {
  await openRightDock(page);
  await tab(page, 'Graph').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split into its own group', exact: true }).click();

  await expect(groups(page)).toHaveCount(2);
  await expect(page.locator('[data-dock-group="right:0"]').getByRole('button', { name: 'Version history', exact: true })).toBeVisible();
  await expect(page.locator('[data-dock-group="right:1"]').getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await expect.poll(() => page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    return (await api.settings.get('layout'))?.panels?.['graph:graph.panel']?.group;
  })).toBe(1);
  await page.reload();
  await expect(groups(page)).toHaveCount(2);

  // Alone in its group, it cannot be split again.
  await tab(page, 'Graph').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Split into its own group', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Join previous group', exact: true }).click();
  await expect(groups(page)).toHaveCount(1);
  await expect(tab(page, 'Graph')).toHaveAttribute('aria-pressed', 'true');
});

test('dragging a tab onto a card edge splits it into a new group', async ({ page }) => {
  await openRightDock(page);
  const source = tab(page, 'Version history');
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 15, { steps: 5 });
    const zone = page.locator('[data-split-zone="right:0:after"]');
    await expect(zone).toHaveAttribute('data-visible', 'true');
    const target = (await zone.boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    // A real pointer keeps sending dragover while it rests; the synthetic one
    // sends one per move, so move again inside the zone.
    await page.mouse.move(target.x + target.width / 2 + 12, target.y + target.height / 2, { steps: 4 });
    await expect(zone).toHaveAttribute('data-hover', 'true');
  } finally {
    await page.mouse.up();
  }
  await expect(groups(page)).toHaveCount(2);
  await expect(page.locator('[data-dock-group="right:1"]').getByRole('button', { name: 'Version history', exact: true })).toBeVisible();
});
