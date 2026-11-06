import { test, expect } from './fixtures';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The switcher used to show the open workspace twice -- on its button and again
// under "Recent" -- and the same folder once per spelling it was opened with.
test('the workspace switcher lists each folder once and not the open one', async ({ page, workspace }) => {
  const a = join(workspace, '..', 'one', 'notes');
  const b = join(workspace, '..', 'two', 'notes');
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const sameAsCurrent = process.platform === 'win32' ? `${workspace.toUpperCase()}\\` : `${workspace}/`;

  await expect(page.locator('.note-row').first()).toBeVisible();
  await page.evaluate(async ({ workspace, recent }) => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    await api.settings.set('repositories', { current: workspace, recent });
  }, { workspace, recent: [workspace, sameAsCurrent, a, b, a] });
  await page.reload();
  await expect(page.locator('.note-row').first()).toBeVisible();

  await page.locator('.titlebar').getByRole('button', { name: /workspace/ }).first().click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  // Open folder, Create workspace, then the two distinct "notes" folders only.
  await expect(items).toHaveCount(4);
  await expect(menu.getByRole('menuitem', { name: /^workspace/ })).toHaveCount(0);
  // Same name, different folders: each shows where it lives.
  await expect(menu.getByRole('menuitem', { name: /notes.*one/ })).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: /notes.*two/ })).toHaveCount(1);
});
