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
