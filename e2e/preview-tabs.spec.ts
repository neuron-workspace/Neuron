import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ prepareWorkspace: async ({}, use) => use((directory: string) => {
  for (const name of ['alpha', 'beta', 'gamma']) writeFileSync(join(directory, `${name}.md`), `# ${name}\n\nA paragraph in ${name}.\n`);
}) });

const strip = (page: Page) => page.getByRole('navigation', { name: 'Open notes' });
// The tab buttons themselves: the close, new-tab and website buttons are labelled.
const tabs = (page: Page) => strip(page).locator('button:not([aria-label])');
const tab = (page: Page, name: string) => strip(page).getByRole('button', { name, exact: true });
const row = (page: Page, name: string) => page.locator('[data-sidebar-tree]').getByRole('button', { name, exact: true });

async function expectTabs(page: Page, names: string[], preview: string | null) {
  await expect(tabs(page)).toHaveText(names);
  if (preview === null) await expect(strip(page).locator('[data-preview="true"]')).toHaveCount(0);
  else {
    const previewTab = strip(page).locator('[data-preview="true"]');
    await expect(previewTab).toHaveCount(1);
    await expect(previewTab).toContainText(preview);
    await expect(previewTab.locator('span.italic')).toHaveCSS('font-style', 'italic');
    await expect(tab(page, preview)).toHaveAttribute('title', `${preview}.md (preview: double-click to keep)`);
  }
}

test('single clicks in the tree reuse one preview tab; a double click keeps it', async ({ page }) => {
  await row(page, 'alpha').click();
  await row(page, 'beta').click();
  await row(page, 'gamma').click();
  await expectTabs(page, ['gamma'], 'gamma');
  await expect(page.getByLabel('Note path')).toHaveText('gamma.md');

  await row(page, 'gamma').dblclick();
  await expectTabs(page, ['gamma'], null);
  await row(page, 'alpha').click();
  await expectTabs(page, ['gamma', 'alpha'], 'alpha');
  // Selecting the kept tab leaves the preview where it is.
  await tab(page, 'gamma').click();
  await expectTabs(page, ['gamma', 'alpha'], 'alpha');
  // The next single click replaces the preview in place.
  await row(page, 'beta').click();
  await expectTabs(page, ['gamma', 'beta'], 'beta');
});

test('editing in Live keeps the preview; switching modes does not', async ({ page, workspace }) => {
  await row(page, 'alpha').click();
  await expectTabs(page, ['alpha'], 'alpha');
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  await expect(page.locator('[data-live-preview]')).toBeVisible();
  await expectTabs(page, ['alpha'], 'alpha');

  await page.locator('p[data-live-line]').filter({ hasText: 'A paragraph' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Edited.');
  await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
  await expect.poll(() => readFileSync(join(workspace, 'alpha.md'), 'utf8')).toContain('Edited.');
  await expectTabs(page, ['alpha'], null);
  await row(page, 'beta').click();
  await expectTabs(page, ['alpha', 'beta'], 'beta');
});

test('double-clicking the tab or "Keep open" in its menu keeps it', async ({ page }) => {
  await row(page, 'alpha').click();
  await tab(page, 'alpha').dblclick();
  await expectTabs(page, ['alpha'], null);

  await row(page, 'beta').click();
  await expectTabs(page, ['alpha', 'beta'], 'beta');
  // From the keyboard: the tab is focusable and Shift+F10 opens its menu.
  await tab(page, 'beta').focus();
  await page.keyboard.press('Shift+F10');
  const keep = page.getByRole('menuitem', { name: 'Keep open' });
  await expect(keep).toBeEnabled();
  await keep.click();
  await expectTabs(page, ['alpha', 'beta'], null);

  await tab(page, 'beta').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Keep open' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await row(page, 'gamma').click();
  await expectTabs(page, ['alpha', 'beta', 'gamma'], 'gamma');
  // Closing the preview clears it, and the next click previews afresh.
  await page.getByRole('button', { name: 'Close gamma', exact: true }).click();
  await expectTabs(page, ['alpha', 'beta'], null);
  await row(page, 'gamma').click();
  await expectTabs(page, ['alpha', 'beta', 'gamma'], 'gamma');
});
