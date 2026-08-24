import { test, expect } from './fixtures';

// Layout primitives for MDX notes: Grid, Row, Col, Card, Stat, Divider.
// The renderer is a line parser, not an MDX compiler, so the thing that can
// silently break is children arriving as raw text instead of being re-parsed.

test('layout components render, nest, and re-parse their children', async ({ page }) => {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill('Dashboard.mdx');
  await dialog.getByText('Dashboard.mdx', { exact: false }).first().click();
  await expect(dialog).toBeHidden();

  // Scope to the document, not `.preview-prose.first()` -- several elements
  // carry that class and the first one is the properties panel.
  const doc = page.locator('.preview-prose');

  await expect(doc.locator('.grid').first()).toBeVisible();
  expect(await doc.locator('.grid').count()).toBeGreaterThanOrEqual(2);
  expect(await doc.locator('.flex').count()).toBeGreaterThan(2);

  // Cards are sections with their own heading.
  expect(await doc.locator('section').count()).toBeGreaterThan(3);
  await expect(doc.getByText('Today', { exact: true }).first()).toBeVisible();

  // Children were re-parsed: a task checkbox inside a Card is a real input, and
  // a DbView inside a Card is a real table. Raw text would give neither.
  expect(await doc.locator('input[type="checkbox"]').count()).toBeGreaterThan(0);
  expect(await doc.locator('table').count()).toBeGreaterThan(0);

  // No component tag survived as literal prose.
  const text = await doc.first().innerText() + await doc.last().innerText();
  expect(text).not.toContain('<Grid');
  expect(text).not.toContain('<Card');
  expect(text).not.toContain('<Stat');
});

test('an unknown attribute value falls back instead of reaching the DOM', async ({ page, workspace }) => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  // A note is untrusted content, so a value must never become a class name.
  writeFileSync(join(workspace, 'hostile-layout.mdx'),
    ['<Grid cols="9999" gap="p-96 fixed inset-0 z-50">', '', 'trapped', '', '</Grid>', ''].join('\n'));

  await page.locator('button[aria-label="Refresh explorer"]').click();
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill('hostile-layout');
  await dialog.getByText('hostile-layout', { exact: false }).first().click();
  await expect(dialog).toBeHidden();

  const grid = page.locator('.preview-prose .grid').first();
  await expect(grid).toBeVisible();
  const cls = (await grid.getAttribute('class')) ?? '';
  expect(cls).not.toContain('fixed');
  expect(cls).not.toContain('inset-0');
  expect(cls).not.toContain('p-96');
  expect(cls).not.toContain('9999');
});
