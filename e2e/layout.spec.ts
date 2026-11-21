import { test, expect, setPluginEnabled } from './fixtures';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

async function openTerminal(app: ElectronApplication, page: Page) {
  await setPluginEnabled(app, page, 'Workspace Terminal');
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();
  const terminal = page.getByRole('complementary', { name: 'Bottom plugin peek' }).getByRole('button', { name: 'Terminal', exact: true });
  await expect(terminal).toBeVisible();
  return terminal;
}

async function dragToRight(page: Page, source: Locator) {
  const box = await source.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box!.x + box!.width / 2 + 15, box!.y + box!.height / 2 + 15, { steps: 5 });
    const zone = page.locator('[data-dock-zone="right"]');
    await expect(zone).toHaveAttribute('data-visible', 'true');
    // The right-hand band of the workbench is the right dock's target. The slot
    // itself has no width until the pointer is over that band.
    const area = await page.locator('[data-dragging]').boundingBox();
    expect(area).not.toBeNull();
    const x = area!.x + area!.width * 0.9;
    const y = area!.y + area!.height * 0.4;
    await page.mouse.move(x, y, { steps: 10 });
    // A real pointer keeps sending dragover while it rests on a target; the
    // synthetic drag sends one per move, so move again inside the band.
    await page.mouse.move(x, y + 24, { steps: 4 });
    await expect(zone).toHaveAttribute('data-hover', 'true');
    // The slot animates open and moves what is under the pointer. A resting real
    // pointer keeps sending dragover through that; here it takes one more move.
    await page.waitForTimeout(350);
    await page.mouse.move(x, y + 30, { steps: 3 });
  } finally {
    await page.mouse.up();
  }
}

async function expectTerminalOnRight(page: Page) {
  const right = page.getByRole('complementary', { name: 'Side plugin peek' });
  await expect(right.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Bottom plugin peek' }).getByRole('button', { name: 'Terminal', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const layout = await api.settings.get('layout');
    return { dock: layout?.panels?.['terminal:terminal.panel']?.dock, open: layout?.rightPanel };
  })).toEqual({ dock: 'right', open: true });
}

test('dragging Terminal to the right dock persists its placement', async ({ app, page }) => {
  const terminal = await openTerminal(app, page);
  await dragToRight(page, terminal);
  await expectTerminalOnRight(page);
});

test('Panel options moves Terminal using the keyboard', async ({ app, page }) => {
  await openTerminal(app, page);
  const options = page.getByRole('complementary', { name: 'Bottom plugin peek' }).getByRole('button', { name: 'Panel options' });
  await options.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Move to bottom dock', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Move to left dock', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Move to right dock', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expectTerminalOnRight(page);
});

/** Drag a panel tab to the band of `dock` at the workbench's edge, and drop it there. */
async function dragToDock(page: Page, source: Locator, dock: 'left' | 'right' | 'bottom') {
  await expect(source).toBeVisible();
  // Let the panel settle where the last move put it (it animates, and takes focus).
  await page.waitForTimeout(400);
  const box = await source.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box!.x + box!.width / 2 + 15, box!.y + box!.height / 2 + 15, { steps: 5 });
    const zone = page.locator(`[data-dock-zone="${dock}"]`);
    await expect(zone).toHaveAttribute('data-visible', 'true');
    const area = await page.locator('[data-dragging]').boundingBox();
    expect(area).not.toBeNull();
    const x = area!.x + area!.width * (dock === 'left' ? 0.1 : dock === 'right' ? 0.9 : 0.5);
    const y = area!.y + area!.height * (dock === 'bottom' ? 0.92 : 0.4);
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.move(x + 6, y + (dock === 'bottom' ? 2 : 24), { steps: 4 });
    await expect(zone).toHaveAttribute('data-hover', 'true');
    await page.waitForTimeout(350);
    await page.mouse.move(x + 10, y + (dock === 'bottom' ? 4 : 30), { steps: 3 });
  } finally {
    await page.mouse.up();
  }
}

/** Where the app has stored a panel, by its tab's key. */
function storedDock(page: Page, key: string) {
  return page.evaluate(async (panel) => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const layout = await api.settings.get('layout');
    return layout?.panels?.[panel] ? { dock: layout.panels[panel].dock, group: layout.panels[panel].group } : null;
  }, key);
}

test('a panel dragged to each dock edge lands in that dock, and dropped on another group\'s tabs joins it', async ({ page }) => {
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  const history = (dock: string) => page.locator(`[data-dock-group^="${dock}:"]`).getByRole('button', { name: 'Version history', exact: true });
  await expect(history('right')).toBeVisible();
  const key = (await history('right').getAttribute('data-panel-key'))!;

  for (const [from, to] of [['right', 'left'], ['left', 'bottom'], ['bottom', 'right']] as const) {
    await dragToDock(page, history(from), to);
    await expect(history(to)).toBeVisible();
    await expect(history(from)).toHaveCount(0);
    await expect.poll(() => storedDock(page, key)).toEqual({ dock: to, group: 0 });
  }

  // Split into a group of its own, then drag it back onto the first group's tab strip.
  await history('right').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split into its own group', exact: true }).click();
  await expect(page.locator('[data-dock-group^="right:"]')).toHaveCount(2);
  await expect(page.locator('[data-dock-group="right:1"]').getByRole('button', { name: 'Version history', exact: true })).toBeVisible();
  const source = page.locator('[data-dock-group="right:1"]').getByRole('button', { name: 'Version history', exact: true });
  const strip = page.locator('[data-dock-group="right:0"]').getByLabel('Panel tabs');
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2 + 15, { steps: 5 });
    const to = (await strip.boundingBox())!;
    const x = to.x + to.width - 30;
    const y = to.y + to.height / 2;
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.move(x + 4, y, { steps: 3 });
  } finally {
    await page.mouse.up();
  }
  await expect(page.locator('[data-dock-group^="right:"]')).toHaveCount(1);
  await expect(page.locator('[data-dock-group="right:0"]').getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  await expect(page.locator('[data-dock-group="right:0"]').getByRole('button', { name: 'Version history', exact: true })).toBeVisible();
  await expect.poll(() => storedDock(page, key)).toEqual({ dock: 'right', group: 0 });
});

test('the floating graph docks when its grip is dragged to the edge of the workbench', async ({ page }) => {
  await page.getByRole('button', { name: 'Show graph', exact: true }).click();
  const floating = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(floating).toBeVisible();
  const grip = floating.getByRole('button', { name: 'Move graph', exact: true });
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box.x - 40, box.y + 20, { steps: 5 });
    // The graph reports its pointer to the workbench, which shows the dock slot under it.
    const area = (await page.locator('[data-dragging="float"]').boundingBox())!;
    const zone = page.locator('[data-dock-zone="bottom"]');
    await page.mouse.move(area.x + area.width / 2, area.y + area.height - 10, { steps: 10 });
    await expect(zone).toHaveAttribute('data-hover', 'true');
  } finally {
    await page.mouse.up();
  }
  await expect(floating).toHaveCount(0);
  const docked = page.locator('[data-dock-group^="bottom:"]').getByRole('button', { name: 'Graph', exact: true });
  await expect(docked).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(async () => {
    const layout = await (window as unknown as { electronAPI: any }).electronAPI.settings.get('layout');
    return { dock: layout?.panels?.['graph:graph.panel']?.dock, open: layout?.bottomPanel, overlay: layout?.graphOverlay };
  })).toEqual({ dock: 'bottom', open: true, overlay: false });
});

test('dragging the sidebar to the right puts it after the editor', async ({ page }) => {
  await dragToRight(page, page.getByRole('button', { name: 'Move sidebar', exact: true }));
  await expect.poll(async () => {
    const sidebar = await page.getByRole('complementary', { name: 'Workspace sidebar' }).boundingBox();
    const main = await page.locator('main').boundingBox();
    return !!sidebar && !!main && sidebar.x >= main.x + main.width;
  }).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    return (await api.settings.get('layout'))?.sidebarSide;
  })).toBe('right');
});
