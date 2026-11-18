import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ prepareWorkspace: async ({}, use) => use((directory: string) => {
  for (const name of ['alpha', 'beta', 'gamma']) writeFileSync(join(directory, `${name}.md`), `# ${name}\n\nA paragraph in ${name}.\n`);
}) });

// Each editor group is `[data-editor-group="<index>"]`; the focused one carries data-focused="true".
const groups = (page: Page) => page.locator('[data-editor-group]');
const group = (page: Page, index: number) => page.locator(`[data-editor-group="${index}"]`);
const strip = (page: Page, index: number) => group(page, index).getByRole('navigation', { name: 'Open notes' });
// The tab buttons themselves: the close, new-tab and website buttons are labelled.
const tabsOf = (page: Page, index: number) => strip(page, index).locator('button:not([aria-label])');
const tab = (page: Page, index: number, name: string) => strip(page, index).getByRole('button', { name, exact: true });
const row = (page: Page, name: string) => page.locator('[data-sidebar-tree]').getByRole('button', { name, exact: true });

async function runCommand(page: Page, name: string) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole('combobox').or(dialog.locator('input')).first().fill(name);
  // By role and prefix: a command with a shortcut has its chord in the same row.
  await dialog.getByRole('option', { name: new RegExp('^' + name) }).first().click();
  await expect(dialog).toBeHidden();
}

async function splitFromMenu(page: Page, index: number, name: string, item: 'Split right' | 'Split down') {
  await tab(page, index, name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** An HTML5 drag driven by the mouse, with extra moves because the synthetic drag sends one dragover per move. */
async function drag(page: Page, source: Locator, to: () => Promise<{ x: number; y: number }>) {
  const box = await source.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box!.x + box!.width / 2 + 12, box!.y + box!.height / 2 + 4, { steps: 5 });
    const { x, y } = await to();
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.move(x + 3, y + 1, { steps: 3 });
  } finally {
    await page.mouse.up();
  }
}

/** The tabs of each stored group, as the app remembers them for this workspace. */
function stored(page: Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const repo = await api.repository.getCurrent();
    return api.settings.get('editorGroups:' + repo.path);
  });
}

test('split right from the tab menu, a third group from the palette, and the sidebar opens in the focused group', async ({ page }) => {
  await row(page, 'alpha').dblclick();
  await expect(tabsOf(page, 0)).toHaveText(['alpha']);

  await splitFromMenu(page, 0, 'alpha', 'Split right');
  await expect(groups(page)).toHaveCount(2);
  await expect(tabsOf(page, 1)).toHaveText(['alpha']);
  await expect(group(page, 1)).toHaveAttribute('data-focused', 'true');

  // The focused group is the new one, so a sidebar click opens there.
  await row(page, 'beta').click();
  await expect(tabsOf(page, 1)).toHaveText(['alpha', 'beta']);
  await expect(tabsOf(page, 0)).toHaveText(['alpha']);

  // Clicking in the first group focuses it; the next click lands there.
  await tab(page, 0, 'alpha').click();
  await expect(group(page, 0)).toHaveAttribute('data-focused', 'true');
  await row(page, 'gamma').click();
  await expect(tabsOf(page, 0)).toHaveText(['alpha', 'gamma']);
  await expect(group(page, 0).getByLabel('Note path')).toHaveText('gamma.md');

  // A third group from the palette, with the focused group's file.
  await runCommand(page, 'Split editor right');
  await expect(groups(page)).toHaveCount(3);
  await expect(group(page, 2).getByLabel('Note path')).toHaveText('gamma.md');

  // Side by side, the split cannot also go down.
  await tab(page, 2, 'gamma').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Split down', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Split right', exact: true })).toBeEnabled();
  await page.mouse.click(1, 1);
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Close editor group closes the focused group and its tabs.
  await runCommand(page, 'Close editor group');
  await expect(groups(page)).toHaveCount(2);
});

test('typing in a note open in two groups shows in both and saves once', async ({ page, workspace }) => {
  await row(page, 'alpha').dblclick();
  await splitFromMenu(page, 0, 'alpha', 'Split right');
  await expect(groups(page)).toHaveCount(2);

  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).click();
  await expect(group(page, 0).locator('[data-live-preview]')).toBeVisible();
  await group(page, 0).locator('p[data-live-line]').filter({ hasText: 'A paragraph' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Edited.');
  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).focus();

  await expect(group(page, 1).locator('p').filter({ hasText: 'A paragraph in alpha. Edited.' })).toHaveCount(1);
  await expect.poll(() => readFileSync(join(workspace, 'alpha.md'), 'utf8')).toContain('Edited.');
  expect(readFileSync(join(workspace, 'alpha.md'), 'utf8').split('Edited.').length - 1).toBe(1);
});

test('dragging a tab onto another group\'s strip moves it, and closing a group\'s last tab closes the group', async ({ page }) => {
  await row(page, 'alpha').dblclick();
  await splitFromMenu(page, 0, 'alpha', 'Split right');
  await row(page, 'beta').dblclick();
  await expect(tabsOf(page, 1)).toHaveText(['alpha', 'beta']);

  // Onto the empty end of the first group's strip.
  await drag(page, tab(page, 1, 'beta'), async () => {
    const target = await strip(page, 0).boundingBox();
    return { x: target!.x + target!.width - 80, y: target!.y + target!.height / 2 };
  });
  await expect(tabsOf(page, 0)).toHaveText(['alpha', 'beta']);
  await expect(tabsOf(page, 1)).toHaveText(['alpha']);

  await group(page, 1).getByRole('button', { name: 'Close alpha', exact: true }).click();
  await expect(groups(page)).toHaveCount(1);
  await expect(tabsOf(page, 0)).toHaveText(['alpha', 'beta']);

  // Onto the right half of a group's content: a new group there, holding the tab.
  await drag(page, tab(page, 0, 'beta'), async () => {
    const zone = group(page, 0).locator('[data-split-zone="row"]');
    await expect(zone).toBeVisible();
    const box = await zone.boundingBox();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  });
  await expect(groups(page)).toHaveCount(2);
  await expect(tabsOf(page, 0)).toHaveText(['alpha']);
  await expect(tabsOf(page, 1)).toHaveText(['beta']);
});

test('the arrangement survives a reload', async ({ page }) => {
  await row(page, 'alpha').dblclick();
  await splitFromMenu(page, 0, 'alpha', 'Split down');
  await row(page, 'beta').dblclick();
  await expect(groups(page)).toHaveCount(2);
  await expect.poll(async () => (await stored(page))?.groups?.map((g: { tabs: string[] }) => g.tabs)).toEqual([['alpha.md'], ['alpha.md', 'beta.md']]);
  await expect.poll(async () => (await stored(page))?.direction).toBe('column');

  await page.reload();
  await expect(groups(page)).toHaveCount(2);
  await expect(tabsOf(page, 0)).toHaveText(['alpha']);
  await expect(tabsOf(page, 1)).toHaveText(['alpha', 'beta']);
  await expect(group(page, 1).getByLabel('Note path')).toHaveText('beta.md');
  await expect(group(page, 1)).toHaveAttribute('data-focused', 'true');
  // Stacked: the second group is below the first.
  const first = await group(page, 0).boundingBox();
  const second = await group(page, 1).boundingBox();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 1);
});

test('the old side pane setting becomes a second group, once', async ({ page }) => {
  await expect(row(page, 'beta')).toBeVisible();
  await page.evaluate(() => (window as unknown as { electronAPI: any }).electronAPI.settings.set('editorSplit', 'beta.md'));
  await page.reload();
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 1).getByLabel('Note path')).toHaveText('beta.md');
  await expect.poll(() => page.evaluate(() => (window as unknown as { electronAPI: any }).electronAPI.settings.get('editorSplit'))).toBeFalsy();
});
