import type { Page } from '@playwright/test';
import { test, expect, setPluginEnabled } from '../fixtures';

// Integration: the layout shell and its docks. A panel moves dock and stays
// there, saved layouts rearrange the workbench, and the sidebar collapses and
// survives a reload. layout.spec.ts, dock-groups.spec.ts, panels.spec.ts,
// saved-layouts.spec.ts, sidebar.spec.ts and workspace-layout-config.spec.ts
// hold the detail, the pointer drags included.

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Workspace sidebar' });
const storedLayout = (page: Page) => page.evaluate(async () => {
  const api = (window as unknown as { electronAPI: any }).electronAPI;
  return api.settings.get('layout');
});

test('Panel options moves the Terminal to the right dock, and the placement is kept', async ({ app, page }) => {
  await setPluginEnabled(app, page, 'Workspace Terminal');
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();
  const bottom = page.getByRole('complementary', { name: 'Bottom plugin peek' });
  await expect(bottom.getByRole('button', { name: 'Terminal', exact: true })).toBeVisible();
  // The terminal takes focus as its shell starts, which would close a menu opened before it.
  await expect(page.locator('.xterm-rows').first()).not.toBeEmpty({ timeout: 60_000 });

  await bottom.getByRole('button', { name: 'Panel options' }).click();
  await page.getByRole('menuitem', { name: 'Move to right dock', exact: true }).click();
  const right = page.getByRole('complementary', { name: 'Side plugin peek' });
  await expect(right.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Bottom plugin peek' }).getByRole('button', { name: 'Terminal', exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    const layout = await storedLayout(page);
    return { dock: layout?.panels?.['terminal:terminal.panel']?.dock, open: layout?.rightPanel };
  }).toEqual({ dock: 'right', open: true });
});

test('switching saved layouts rearranges the workbench', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Layouts', exact: true });
  const saved = page.getByRole('group', { name: 'Saved layouts' });
  const switchTo = async (name: string) => {
    if (!(await saved.isVisible())) await trigger.click();
    await saved.getByRole('button', { name, exact: true }).click();
    await expect(trigger).toContainText(name);
    await expect(saved).toBeHidden();
  };

  await switchTo('Focus');
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page.locator('footer.status-bar')).toHaveCount(0);
  await switchTo('Writing');
  await expect(sidebar(page)).toBeVisible();
  await expect(page.locator('footer.status-bar')).toBeVisible();
  await switchTo('Review');
  await expect(page.locator('[data-dock-group="right:0"]')).toBeVisible();
});

test('the sidebar collapses to icons and stays collapsed after a reload', async ({ page }) => {
  await expect(sidebar(page).locator('[data-sidebar-tree]')).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'Collapse sidebar to icons', exact: true }).click();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(sidebar(page).locator('[data-sidebar-tree]')).toHaveCount(0);
  await expect.poll(async () => (await storedLayout(page))?.sidebarCollapsed).toBe(true);

  await page.reload();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar-collapsed', 'true');
  await sidebar(page).getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(sidebar(page).locator('[data-sidebar-tree]')).toBeVisible();
});
