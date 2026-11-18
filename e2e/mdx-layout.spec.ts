import { test, expect, openNote } from './fixtures';

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
  await expect(doc.getByText('Move today', { exact: true }).first()).toBeVisible();
  // A Card nested inside another Card -- the case that breaks if children are
  // parsed once and not recursively.
  await expect(doc.getByText('Questions for Friday', { exact: true }).first()).toBeVisible();
  const nested = doc.locator('.mdx-card .mdx-card').first();
  await expect(nested).toHaveCSS('border-top-width', '0px');
  await expect(nested).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(doc.locator('.mdx-card h3').first()).toHaveCSS('text-transform', 'none');
  await expect(doc.locator('.mdx-card h3').first()).toHaveCSS('font-weight', '600');

  // Children were re-parsed: a task checkbox inside a Card is a real input, and
  // a DbView inside a Card is a real table. Raw text would give neither.
  expect(await doc.locator('input[type="checkbox"]').count()).toBeGreaterThan(0);
  expect(await doc.locator('table').count()).toBeGreaterThan(0);

  // A Callout re-parses its children too. It used to render them as one raw
  // string, so a list came out as literal dashes and `code` as literal
  // backticks -- which is most of what a callout is used for.
  const callout = doc.locator('.callout', { hasText: 'Not built yet' }).last();
  expect(await callout.locator('li').count()).toBeGreaterThan(0);

  // No component tag survived as literal prose, and no backtick did either:
  // every one in this note marks inline code, so a surviving backtick means
  // something was rendered as text that should have been parsed.
  const text = await doc.first().innerText() + await doc.last().innerText();
  expect(text).not.toContain('<Grid');
  expect(text).not.toContain('<Card');
  expect(text).not.toContain('<Stat');
  expect(text).not.toContain('`');
});

test('badges, numeric columns, cell spans and flashcard toggling preserve their semantics', async ({ page, workspace }) => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  writeFileSync(join(workspace, 'mdx-variants.mdx'), [
    ...['success', 'info', 'warning', 'error', 'neutral', 'default', 'plain', 'mystery'].map((type) => `<Badge type="${type}" text="${type}" />`), '',
    '<Grid cols="3">', '<Cell cols="2">', 'Spanning cell', '</Cell>', '<Cell>', 'Other cell', '</Cell>', '</Grid>', '',
    '| Name | Count | Mixed |', '| --- | --- | --- |', '| Ada | -1.5 | 3 |', '| Lin | +12 | pending |', '',
    '<Flashcard front="A question">', 'A hidden answer.', '</Flashcard>', '',
  ].join('\n'));
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'mdx-variants.mdx');
  const badges = page.locator('[data-badge-kind]');
  await expect(badges).toHaveCount(8);
  for (const [i, kind] of ['success', 'info', 'warning', 'error', 'neutral', 'neutral', 'neutral', 'info'].entries()) {
    await expect(badges.nth(i)).toHaveAttribute('data-badge-kind', kind);
  }
  await expect(page.locator('.preview-prose th').nth(1)).toHaveCSS('text-align', 'right');
  await expect(page.locator('.preview-prose td').nth(1)).toHaveCSS('font-variant-numeric', 'tabular-nums');
  await expect(page.locator('.preview-prose th').nth(2)).toHaveCSS('text-align', 'left');
  await expect(page.locator('.col-span-2')).toHaveCSS('grid-column-end', 'span 2');
  await expect(page.locator('.col-span-2').locator('..')).toHaveCSS('display', 'contents');
  for (const mode of ['Reading', 'Live']) {
    await page.getByRole('button', { name: mode, exact: true }).first().click();
    await expect(page.getByText('A hidden answer.', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await expect(page.getByText('A hidden answer.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide answer', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Hide answer', exact: true }).click();
    await expect(page.getByText('A hidden answer.', { exact: true })).toHaveCount(0);
  }
});

test('each callout kind renders with its own kind and an icon', async ({ page, workspace }) => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  writeFileSync(join(workspace, 'callout-kinds.mdx'), [
    '<Callout type="tip" title="Done">', 'All set.', '</Callout>', '',
    '<Callout type="note">', 'Untitled info.', '</Callout>', '',
    '<Callout type="Caution" title="Careful">', 'Mind this.', '</Callout>', '',
    '<Callout type="danger" title="Broke">', 'It failed.', '</Callout>', '',
    '<Callout type="mystery" title="Unknown">', 'Falls back.', '</Callout>', '',
  ].join('\n'));

  await page.locator('button[aria-label="Refresh explorer"]').click();
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill('callout-kinds');
  await dialog.getByText('callout-kinds', { exact: false }).first().click();
  await expect(dialog).toBeHidden();

  const callouts = page.locator('.preview-prose .callout');
  await expect(callouts).toHaveCount(5);
  const kinds = ['success', 'info', 'warning', 'error', 'info'];
  for (const [i, kind] of kinds.entries()) {
    await expect(callouts.nth(i)).toHaveAttribute('data-callout-kind', kind);
    await expect(callouts.nth(i).locator('svg.callout-icon[aria-hidden="true"]')).toHaveCount(1);
  }
  // Without a title the kind is the box's only name.
  await expect(page.getByRole('note', { name: 'Info', exact: true })).toBeVisible();
  await expect(callouts.nth(0)).not.toHaveAttribute('aria-label', /./);
});

test('nested prose preserves source paragraph gaps and an even callout background', async ({ page, workspace }) => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const prose = ['First source line.', 'Second source line.', '', 'Separate paragraph.'];
  writeFileSync(join(workspace, 'nested-rhythm.mdx'), [
    ...prose, '', '<Callout title="Nested rhythm">', ...prose, '</Callout>', '',
    '<Card title="Nested rhythm">', ...prose, '</Card>', '',
    '<Flashcard front="Nested rhythm">', ...prose, '</Flashcard>', '',
  ].join('\n'));
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  for (const preset of ['light', 'graphite']) {
    await page.evaluate((preset) => (window as any).electronAPI.settings.set('appearance', { preset, markdownOverrides: {} }), preset);
    await page.reload();
    await openNote(page, 'nested-rhythm.mdx');
    for (const mode of ['Reading', 'Live']) {
      await page.getByRole('button', { name: mode, exact: true }).first().click();
      await page.getByRole('button', { name: 'Show answer', exact: true }).click();
      const topGap = await page.locator('.preview-prose > [data-gap] + p').first().evaluate((p) => getComputedStyle(p).marginTop);
      for (const container of ['.callout-body', '.mdx-card', '.mdx-flashcard-answer']) {
        const paragraphs = page.locator(`${container} > p`);
        await expect(paragraphs).toHaveCount(3);
        await expect(paragraphs.nth(1)).toHaveCSS('margin-top', '0px');
        await expect(paragraphs.nth(0)).toHaveCSS('margin-bottom', '0px');
        await expect(page.locator(`${container} > [data-gap] + p`)).toHaveCount(1);
        await expect(paragraphs.nth(2)).toHaveCSS('margin-top', topGap);
        expect(parseFloat(topGap)).toBeGreaterThan(0);
      }
      const first = page.locator('.callout-body > p').first();
      await first.hover();
      await expect(first).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await page.getByRole('button', { name: 'Hide answer', exact: true }).click();
    }
  }
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
