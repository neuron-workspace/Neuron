import { test, expect, closeMenuByClickingOutside, openNote } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  await closeMenuByClickingOutside(page);
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

test('dragging a tab within its strip reorders it, and a middle click closes a tab', async ({ page }) => {
  for (const name of ['alpha', 'beta', 'gamma']) await row(page, name).dblclick();
  await expect(tabsOf(page, 0)).toHaveText(['alpha', 'beta', 'gamma']);

  // Onto the left half of the first tab: it goes first.
  await drag(page, tab(page, 0, 'gamma'), async () => {
    const target = await tab(page, 0, 'alpha').boundingBox();
    return { x: target!.x + 6, y: target!.y + target!.height / 2 };
  });
  await expect(tabsOf(page, 0)).toHaveText(['gamma', 'alpha', 'beta']);
  // A reorder never splits.
  await expect(groups(page)).toHaveCount(1);

  await tab(page, 0, 'alpha').click({ button: 'middle' });
  await expect(tabsOf(page, 0)).toHaveText(['gamma', 'beta']);
});

test('Zen shows only the focused group and hides the chrome; leaving it, or relaunching, brings everything back', async ({ page }) => {
  await row(page, 'alpha').dblclick();
  await splitFromMenu(page, 0, 'alpha', 'Split right');
  await row(page, 'beta').dblclick();
  await expect(groups(page)).toHaveCount(2);
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
  const status = page.locator('footer.status-bar');
  await expect(sidebar).toBeVisible();
  await expect(status).toBeVisible();

  await runCommand(page, 'Zen mode');
  await expect(groups(page)).toHaveCount(1);
  await expect(group(page, 1).getByLabel('Note path')).toHaveText('beta.md');
  await expect(sidebar).toHaveCount(0);
  await expect(status).toHaveCount(0);
  await expect(page.locator('[data-dock-group]')).toHaveCount(0);

  await runCommand(page, 'Exit zen mode');
  await expect(groups(page)).toHaveCount(2);
  await expect(tabsOf(page, 0)).toHaveText(['alpha']);
  await expect(sidebar).toBeVisible();
  await expect(status).toBeVisible();

  // A relaunch in zen starts as zen found the window, not in zen.
  await runCommand(page, 'Zen mode');
  await expect(sidebar).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as { electronAPI: any }).electronAPI.settings.get('layout'))?.sidebar)).toBe(true);
  await page.reload();
  await expect(groups(page)).toHaveCount(2);
  await expect(sidebar).toBeVisible();
  await expect(status).toBeVisible();
  await page.getByRole('button', { name: /Search & commands/ }).click();
  await expect(page.locator('[role="dialog"]').getByRole('option', { name: /^Zen mode/ })).toBeVisible();
});

test('the view mode belongs to the file: switching it in one group switches it in every group showing that file', async ({ page }) => {
  await row(page, 'alpha').dblclick();
  await row(page, 'beta').dblclick();
  await tab(page, 0, 'alpha').click();
  await splitFromMenu(page, 0, 'alpha', 'Split right');
  await expect(groups(page)).toHaveCount(2);
  const mode = (index: number, name: string) => group(page, index).getByRole('button', { name, exact: true });

  await expect(mode(0, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await mode(0, 'Live').click();
  await expect(mode(0, 'Live')).toHaveAttribute('aria-pressed', 'true');
  await expect(mode(1, 'Live')).toHaveAttribute('aria-pressed', 'true');
  await expect(group(page, 1).locator('[data-live-preview]')).toBeVisible();

  // Another file keeps its own mode.
  await tab(page, 0, 'beta').click();
  await expect(mode(0, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(mode(1, 'Live')).toHaveAttribute('aria-pressed', 'true');
});

test('the old side pane setting becomes a second group, once', async ({ page }) => {
  await expect(row(page, 'beta')).toBeVisible();
  await page.evaluate(() => (window as unknown as { electronAPI: any }).electronAPI.settings.set('editorSplit', 'beta.md'));
  await page.reload();
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 1).getByLabel('Note path')).toHaveText('beta.md');
  await expect.poll(() => page.evaluate(() => (window as unknown as { electronAPI: any }).electronAPI.settings.get('editorSplit'))).toBeFalsy();
});

/** Drag a tab onto a split zone of group `index`, the right one ('row') or the lower one ('column'). */
async function dragToZone(page: Page, source: Locator, index: number, direction: 'row' | 'column') {
  await drag(page, source, async () => {
    const zone = group(page, index).locator(`[data-split-zone="${direction}"]`);
    await expect(zone).toBeVisible();
    const box = await zone.boundingBox();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  });
}

// 4B: a workspace with a layout shell shows its one editor group in the shell's
// editor panel. That panel has the same split zones as the editor groups.
test.describe('in a layout-shell workspace', () => {
  test.use({ prepareWorkspace: async ({}, use) => use((directory: string) => {
    for (const name of ['alpha', 'beta', 'gamma']) writeFileSync(join(directory, `${name}.md`), `# ${name}\n\nA paragraph in ${name}.\n`);
    mkdirSync(join(directory, '.neuron'), { recursive: true });
    writeFileSync(join(directory, '.neuron', 'layout.json'), JSON.stringify({
      direction: 'horizontal',
      children: [{ size: 70, panel: { type: 'editor' } }, { size: 30, panel: { type: 'graph' } }],
    }));
  }) });

  test('dragging a tab to the editor panel\'s right edge makes the first split, and to the bottom edge too', async ({ page }) => {
    await expect(page.locator('[data-graph-root]').first()).toBeVisible();
    await row(page, 'alpha').dblclick();
    await row(page, 'beta').dblclick();
    await expect(groups(page)).toHaveCount(1);
    await expect(tabsOf(page, 0)).toHaveText(['alpha', 'beta']);

    await dragToZone(page, tab(page, 0, 'beta'), 0, 'row');
    await expect(groups(page)).toHaveCount(2);
    await expect(tabsOf(page, 0)).toHaveText(['alpha']);
    await expect(tabsOf(page, 1)).toHaveText(['beta']);
    // Side by side, inside the shell: the graph panel is still there.
    const [first, second] = [await group(page, 0).boundingBox(), await group(page, 1).boundingBox()];
    expect(second!.x).toBeGreaterThanOrEqual(first!.x + first!.width - 1);
    await expect(page.locator('[data-graph-root]').first()).toBeVisible();

    // Back to one group, then the lower edge.
    await group(page, 1).getByRole('button', { name: 'Close beta', exact: true }).click();
    await expect(groups(page)).toHaveCount(1);
    await row(page, 'gamma').dblclick();
    await dragToZone(page, tab(page, 0, 'gamma'), 0, 'column');
    await expect(groups(page)).toHaveCount(2);
    await expect(tabsOf(page, 1)).toHaveText(['gamma']);
    const [top, bottom] = [await group(page, 0).boundingBox(), await group(page, 1).boundingBox()];
    expect(bottom!.y).toBeGreaterThanOrEqual(top!.y + top!.height - 1);
  });
});

// 6C: a table open in two groups is one document with one writer.
test.describe('a table in two groups', () => {
  const CSV = 'item,count\nApples,3\nPears,5\n';
  test.use({ prepareWorkspace: async ({}, use) => use((directory: string) => {
    writeFileSync(join(directory, 'alpha.md'), '# alpha\n');
    copyFileSync(join(__dirname, '..', 'examples', 'demo-repo', 'Planner.db'), join(directory, 'Planner.db'));
    writeFileSync(join(directory, 'stock.csv'), CSV);
    // Managed: Neuron may write it.
    mkdirSync(join(directory, '.neuron', 'tables'), { recursive: true });
    writeFileSync(join(directory, '.neuron', 'tables', 'stock.csv.json'), JSON.stringify({ version: 1, columns: {}, view: {} }));
  }) });

  /** Open `name` and split it right, so both groups show it. */
  async function inTwoGroups(page: Page, name: string) {
    await openNote(page, name);
    await expect(tabsOf(page, 0)).toHaveText([name]);
    await splitFromMenu(page, 0, name, 'Split right');
    await expect(groups(page)).toHaveCount(2);
  }

  test('a .db: a cell edited in one group shows in the other at once, and the file has each edit once', async ({ page, workspace }) => {
    await inTwoGroups(page, 'Planner.db');
    for (const index of [0, 1]) await group(page, index).getByRole('button', { name: 'Open Tasks table' }).click();
    const title = (index: number) => group(page, index).locator('table tbody tr').first().locator('td').nth(1).locator('input.vw-cell');
    await expect(title(0)).toHaveValue(await title(1).inputValue());

    // With saves blocked, the other group still shows the edit: it comes from the
    // shared document, not from the file coming back through the watcher.
    const file = join(workspace, 'Planner.db');
    const before = readFileSync(file, 'utf8');
    const win = process.platform === 'win32';
    const block = () => (win ? chmodSync(file, 0o444) : chmodSync(workspace, 0o555));
    const unblock = () => (win ? chmodSync(file, 0o644) : chmodSync(workspace, 0o755));
    block();
    try {
      await page.waitForTimeout(600);
      await title(0).fill('Edited in the first group');
      await title(0).blur();
      await expect(title(1)).toHaveValue('Edited in the first group');
      await expect(group(page, 0).getByRole('alert').filter({ hasText: "Couldn't save Planner.db:" })).toBeVisible();
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally {
      unblock();
    }
    await group(page, 0).getByRole('alert').filter({ hasText: "Couldn't save Planner.db:" }).getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => readFileSync(file, 'utf8').split('Edited in the first group').length - 1).toBe(1);
    await expect(page.getByRole('alert').filter({ hasText: "Couldn't save Planner.db:" })).toHaveCount(0);

    // An edit in the second group builds on the first: neither write loses the other.
    const second = (index: number) => group(page, index).locator('table tbody tr').nth(1).locator('td').nth(1).locator('input.vw-cell');
    await second(1).fill('Edited in the second group');
    await second(1).blur();
    await expect(second(0)).toHaveValue('Edited in the second group');
    await expect(title(0)).toHaveValue('Edited in the first group');
    await expect.poll(() => {
      const text = readFileSync(join(workspace, 'Planner.db'), 'utf8');
      return [text.split('Edited in the first group').length - 1, text.split('Edited in the second group').length - 1];
    }).toEqual([1, 1]);
    // One save state for the file, in both groups' headers.
    for (const index of [0, 1]) await expect(group(page, index).getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible();
  });

  test('a managed CSV: a cell edited in one group shows in the other, and the file has it once', async ({ page, workspace }) => {
    await inTwoGroups(page, 'stock.csv');
    const count = (index: number, row: number) => group(page, index).getByRole('textbox', { name: 'count', exact: true }).nth(row);
    await expect(count(1, 0)).toHaveValue('3');

    await count(0, 0).fill('42');
    await count(0, 0).blur();
    await expect(count(1, 0)).toHaveValue('42');
    await expect.poll(() => readFileSync(join(workspace, 'stock.csv'), 'utf8')).toBe('item,count\nApples,42\nPears,5\n');

    await count(1, 1).fill('7');
    await count(1, 1).blur();
    await expect(count(0, 1)).toHaveValue('7');
    await expect.poll(() => readFileSync(join(workspace, 'stock.csv'), 'utf8')).toBe('item,count\nApples,42\nPears,7\n');
  });
});
