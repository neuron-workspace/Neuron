import { test, expect } from './fixtures';

test('labelled sidebar collapses to accessible icons and survives reload', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
  const names = ['Explorer', 'Search notes', 'Tags', 'Graph', 'Plugins & integrations', 'Workspaces', 'Component gallery', 'Settings'];
  await expect(sidebar.locator('[data-sidebar-label]')).toHaveText(['Files', 'Search', 'Tags', 'Graph', 'Plugins', 'Workspaces', 'Component gallery', 'Settings']);
  await expect(sidebar.locator('[data-sidebar-tree]')).toBeVisible();
  await sidebar.getByRole('button', { name: 'Collapse sidebar to icons', exact: true }).click();
  const checkCollapsed = async () => {
    await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'true');
    await expect(sidebar.locator('[data-sidebar-label]')).toHaveCount(0);
    await expect(sidebar.locator('[data-sidebar-tree]')).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Move sidebar', exact: true })).toHaveCount(0);
    await expect.poll(() => sidebar.evaluate((node) => node.getBoundingClientRect().width)).toBe(44);
    for (const name of names) {
      const button = sidebar.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      await button.focus();
      await expect(button).toBeFocused();
    }
  };
  await checkCollapsed();
  await expect.poll(() => page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    return (await api.settings.get('layout'))?.sidebarCollapsed;
  })).toBe(true);
  await page.reload();
  await checkCollapsed();
  await sidebar.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(sidebar.locator('[data-sidebar-tree]')).toBeVisible();
  await expect(sidebar.locator('[data-sidebar-label]')).toHaveCount(8);
});


test('sidebar header groups Move with the mirrored collapse control', async ({ page }) => {
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
  const move = sidebar.getByRole('button', { name: 'Move sidebar', exact: true });
  const collapse = sidebar.getByRole('button', { name: 'Collapse sidebar to icons', exact: true });
  await expect(move).toHaveAttribute('draggable', 'true');
  await expect(move.locator('..').getByRole('button')).toHaveCount(2);
  await expect(collapse.locator('svg')).toHaveClass(/lucide-chevrons-left/);
  await move.click();
  await expect(collapse.locator('svg')).toHaveClass(/lucide-chevrons-right/);
  await expect(page.getByRole('button', { name: 'Workspace home', exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
});
