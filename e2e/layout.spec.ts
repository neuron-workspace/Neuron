import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

async function openTerminal(page: Page) {
  await page.getByRole('button', { name: 'Plugins & integrations', exact: true }).first().click();
  await page.getByPlaceholder('Search plugins').fill('Workspace Terminal');
  const enabled = page.getByRole('switch', { name: 'Enable Workspace Terminal' });
  await expect(enabled).toBeVisible();
  await enabled.check();
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
    const target = await zone.boundingBox();
    expect(target).not.toBeNull();
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 10 });
    // A real pointer keeps sending dragover while it rests on a target; the
    // synthetic drag sends one per move, so move again inside the zone.
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2 + 24, { steps: 4 });
    await expect(zone).toHaveAttribute('data-hover', 'true');
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

test('dragging Terminal to the right dock persists its placement', async ({ page }) => {
  const terminal = await openTerminal(page);
  await dragToRight(page, terminal);
  await expectTerminalOnRight(page);
});

test('Panel options moves Terminal using the keyboard', async ({ page }) => {
  await openTerminal(page);
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
