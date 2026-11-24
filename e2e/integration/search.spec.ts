import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// Integration: search and the command palette. Search finds a note by its
// text and opens it at the line; the palette opens a note and runs a command.
// search-graph.spec.ts and workspace.spec.ts hold the detail.

const filler = Array.from({ length: 40 }, (_, i) => `filler line ${i + 1}`).join('\n');
const FILES: Record<string, string> = {
  'alpha.md': '# Alpha\n\nfirst line\nthe zephyr word is here\n',
  'beta.md': `# Beta\n\n${filler}\n\nthe marmalade line\n`,
};

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}) });

const palette = (page: Page) => page.locator('[role="dialog"]');

/** Run a palette entry through the title-bar trigger (see openNote in fixtures). */
async function choose(page: Page, text: string, option: RegExp | string) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  await expect(palette(page)).toBeVisible();
  await palette(page).locator('input').first().fill(text);
  await palette(page).getByRole('option', { name: option }).first().click();
  await expect(palette(page)).toBeHidden();
}

test('search finds a note by its text, shows the line, and opens the note at it', async ({ page }) => {
  await choose(page, 'Search in notes', /Search in notes/);
  const search = page.locator('section[aria-label="Search notes"]');
  await expect(search).toBeVisible();
  await search.getByRole('textbox').first().fill('marmalade');
  const hit = search.locator('[data-search-hit="beta.md"]');
  await expect(hit).toContainText('the marmalade line');
  await expect(search.locator('[data-search-hit="alpha.md"]')).toHaveCount(0);
  await hit.click();
  const marked = page.locator('article.preview-prose [data-revealed]');
  await expect(marked).toHaveText('the marmalade line');
  await expect(marked).toBeInViewport();
});

test('the palette opens a note and runs a command', async ({ page }) => {
  await expect(page.locator('.note-row').first()).toBeVisible();
  await choose(page, 'alpha', 'alpha.md');
  await expect(page.getByLabel('Note path')).toHaveAttribute('title', 'alpha.md');
  await choose(page, 'Show workspace graph', /Show workspace graph/);
  await expect(page.getByRole('complementary', { name: 'Workspace graph' })).toBeVisible();
});
