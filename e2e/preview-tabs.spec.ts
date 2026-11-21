import { test, expect, closeMenuByClickingOutside, openNote } from './fixtures';
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
  // Shift+F10 is not a context-menu key on macOS, so open the menu with a
  // right-click, which works on every platform.
  await tab(page, 'beta').click({ button: 'right' });
  const keep = page.getByRole('menuitem', { name: 'Keep open' });
  await expect(keep).toBeEnabled();
  await keep.click();
  await expectTabs(page, ['alpha', 'beta'], null);
  // Choosing an item closes the menu. Waiting for that also means the next
  // right-click opens a fresh menu rather than reviving this one mid-way
  // through its closing animation.
  await expect(page.getByRole('menu')).toHaveCount(0);

  await tab(page, 'beta').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Keep open' })).toBeDisabled();
  // Escape does not close menus on the Linux and macOS runners; see the helper.
  await closeMenuByClickingOutside(page);
  await expect(page.getByRole('menu')).toHaveCount(0);

  await row(page, 'gamma').click();
  await expectTabs(page, ['alpha', 'beta', 'gamma'], 'gamma');
  // Closing the preview clears it, and the next click previews afresh.
  await page.getByRole('button', { name: 'Close gamma', exact: true }).click();
  await expectTabs(page, ['alpha', 'beta'], null);
  await row(page, 'gamma').click();
  await expectTabs(page, ['alpha', 'beta', 'gamma'], 'gamma');
});

// Pins today's rule (App.tsx handleSelectNote: "a preview by default"; also
// relied on by editor-split.spec.ts): the palette opens like a single click.
test('opening from the palette is a look, like a single click: it replaces the preview, and editing keeps it', async ({ page, workspace }) => {
  await row(page, 'alpha').dblclick();
  await openNote(page, 'beta');
  await expectTabs(page, ['alpha', 'beta'], 'beta');
  await openNote(page, 'gamma');
  await expectTabs(page, ['alpha', 'gamma'], 'gamma');
  await expect(page.getByLabel('Note path')).toHaveText('gamma.md');

  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  await page.locator('p[data-live-line]').filter({ hasText: 'A paragraph' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Kept.');
  await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
  await expect.poll(() => readFileSync(join(workspace, 'gamma.md'), 'utf8')).toContain('Kept.');
  await expectTabs(page, ['alpha', 'gamma'], null);
  await openNote(page, 'beta');
  await expectTabs(page, ['alpha', 'gamma', 'beta'], 'beta');
});

test('each editor group has a preview of its own', async ({ page }) => {
  const group = (index: number) => page.locator(`[data-editor-group="${index}"]`);
  const groupTabs = (index: number) => group(index).getByRole('navigation', { name: 'Open notes' }).locator('button:not([aria-label])');
  const groupPreview = (index: number) => group(index).locator('[data-preview="true"]');
  await row(page, 'alpha').dblclick();
  await tab(page, 'alpha').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(page.locator('[data-editor-group]')).toHaveCount(2);

  // The new group has focus: single clicks preview there, one tab replacing the next.
  await row(page, 'beta').click();
  await row(page, 'gamma').click();
  await expect(groupTabs(1)).toHaveText(['alpha', 'gamma']);
  await expect(groupPreview(1)).toContainText('gamma');
  await expect(groupPreview(0)).toHaveCount(0);

  // A single click in the other group does not replace this group's preview.
  await group(0).getByRole('button', { name: 'alpha', exact: true }).click();
  await row(page, 'beta').click();
  await expect(groupTabs(0)).toHaveText(['alpha', 'beta']);
  await expect(groupPreview(0)).toContainText('beta');
  await expect(groupPreview(1)).toContainText('gamma');
});
