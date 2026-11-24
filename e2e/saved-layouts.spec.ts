import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Workspace sidebar' });
const trigger = (page: Page) => page.getByRole('button', { name: 'Layouts', exact: true });
const saved = (page: Page) => page.getByRole('group', { name: 'Saved layouts' });

// Opens the menu only if it is closed. Escape does not close it on the macOS
// and Linux runners, and clicking the trigger of an open menu shuts it.
async function switchTo(page: Page, name: string) {
  if (!(await saved(page).isVisible())) await trigger(page).click();
  await saved(page).getByRole('button', { name, exact: true }).click();
  await expect(trigger(page)).toContainText(name);
  // Choosing a layout closes the menu; wait for that, so the next step sees it closed.
  await expect(saved(page)).toBeHidden();
}

test('a new profile starts with three layouts, and switching rearranges the workbench', async ({ page }) => {
  await trigger(page).click();
  for (const name of ['Writing', 'Review', 'Focus']) await expect(saved(page).getByRole('button', { name, exact: true })).toBeVisible();

  await switchTo(page, 'Focus');
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page.locator('footer.status-bar')).toHaveCount(0);

  await switchTo(page, 'Writing');
  await expect(sidebar(page)).toBeVisible();
  await expect(page.locator('footer.status-bar')).toBeVisible();

  await switchTo(page, 'Review');
  await expect(page.locator('[data-dock-group="right:0"]')).toBeVisible();
});

test('a saved layout shows a dot once changed, and Update and Delete name it in curly quotes (8A)', async ({ page }) => {
  await trigger(page).click();
  await page.getByLabel('Save current layout as').fill('Drafting');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(saved(page).getByRole('button', { name: 'Drafting', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Inside the trigger, whose own label hides it from the accessibility tree; found by its label.
  const dot = trigger(page).locator('[aria-label="Changed since it was saved"]');
  await expect(dot).toHaveCount(0);
  // Not changed yet: nothing to update.
  await expect(page.getByRole('button', { name: 'Update “Drafting”', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete “Drafting”', exact: true })).toBeVisible();

  // A change to the arrangement: the dot appears, and Update is offered by name.
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(dot).toHaveCount(1);
  // The press outside closed the menu; wait for that before opening it again.
  await expect(saved(page)).toBeHidden();
  await trigger(page).click();
  const update = page.getByRole('button', { name: 'Update “Drafting”', exact: true });
  await expect(update).toBeVisible();
  await update.click();
  await expect(dot).toHaveCount(0);
  await expect(saved(page)).toBeHidden();
  // Switching away and back brings the updated arrangement: no sidebar.
  await switchTo(page, 'Writing');
  await expect(sidebar(page)).toBeVisible();
  await switchTo(page, 'Drafting');
  await expect(sidebar(page)).toHaveCount(0);

  // Delete asks once, by name, then removes it.
  await trigger(page).click();
  const remove = page.getByRole('button', { name: 'Delete “Drafting”', exact: true });
  await remove.click();
  const confirm = page.getByRole('button', { name: 'Delete “Drafting”? Click again', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(saved(page).getByRole('button', { name: 'Drafting', exact: true })).toHaveCount(0);
  // Nowhere does a stray question mark stand in for a quote.
  await expect(page.getByText(/\?Drafting\?/)).toHaveCount(0);
});

test('the current layout can be saved by name, survives reload, and can be deleted', async ({ page }) => {
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();
  // The terminal takes focus as its shell starts, which would close a menu opened before it.
  await expect(page.locator('.xterm-rows').first()).not.toBeEmpty({ timeout: 60_000 });
  await trigger(page).click();
  const name = page.getByLabel('Save current layout as');

  // A name already in use is refused where it is typed.
  await name.fill('writing');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('That name is already used.');

  await name.fill('With terminal');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(saved(page).getByRole('button', { name: 'With terminal', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await switchTo(page, 'Writing');
  await expect(page.locator('[data-dock-group^="bottom:"]')).toHaveCount(0);

  await page.reload();
  await switchTo(page, 'With terminal');
  await expect(page.locator('[data-dock-group="bottom:0"]')).toBeVisible();

  await trigger(page).click();
  const remove = page.getByRole('button', { name: /^Delete .With terminal./ });
  await remove.click();
  await remove.click();
  await expect(saved(page).getByRole('button', { name: 'With terminal', exact: true })).toHaveCount(0);
  await expect(saved(page).getByRole('button', { name: 'Writing', exact: true })).toBeVisible();
});
