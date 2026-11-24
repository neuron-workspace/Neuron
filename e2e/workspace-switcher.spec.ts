import { test, expect } from './fixtures';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The switcher used to show the open workspace twice -- on its button and again
// under "Recent" -- and the same folder once per spelling it was opened with.
test('the workspace switcher lists each folder once and not the open one', async ({ app, page, workspace }) => {
  const a = join(workspace, '..', 'one', 'notes');
  const b = join(workspace, '..', 'two', 'notes');
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const sameAsCurrent = process.platform === 'win32' ? `${workspace.toUpperCase()}\\` : `${workspace}/`;

  await expect(page.locator('.note-row').first()).toBeVisible();
  // `repositories` is main's own key (P0-2): the renderer cannot write it, so
  // the file is written from inside main, in one synchronous step.
  await app.evaluate(({ app: electronApp }, repositories) => {
    const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
    const file = `${electronApp.getPath('userData')}/neuron-settings.json`;
    const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
    settings.repositories = repositories;
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  }, { current: workspace, recent: [workspace, sameAsCurrent, a, b, a] });
  await page.reload();
  await expect(page.locator('.note-row').first()).toBeVisible();

  await page.locator('.titlebar').getByRole('button', { name: /workspace/ }).first().click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  // Open folder, Create workspace, New workspace from template, the two distinct
  // "notes" folders only, then Workspace settings and Manage workspaces.
  await expect(items).toHaveCount(7);
  await expect(items.nth(2)).toHaveText(/New workspace from template/);
  await expect(items.nth(5)).toHaveText(/Workspace settings/);
  await expect(items.last()).toHaveText(/Manage workspaces/);
  await expect(menu.getByRole('menuitem', { name: /^workspace/ })).toHaveCount(0);
  // Same name, different folders: each shows where it lives.
  await expect(menu.getByRole('menuitem', { name: /notes.*one/ })).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: /notes.*two/ })).toHaveCount(1);
});
