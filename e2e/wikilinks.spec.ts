import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openNote } from './fixtures';

const websiteLinkName = 'Open note projects/Website refresh.mdx';

async function expectWebsiteRefreshOpen(page: Parameters<typeof openNote>[0]) {
  await expect(page.locator('article.preview-prose h1')).toHaveText('Website refresh');
}

test('a resolved wiki-link opens its exact path in reading view', async ({ page }) => {
  await openNote(page, 'Dashboard.mdx');

  await page.getByRole('button', { name: websiteLinkName }).first().click();

  await expectWebsiteRefreshOpen(page);
});

test('a focused wiki-link is keyboard reachable and opens on Enter', async ({ page }) => {
  await openNote(page, 'Dashboard.mdx');
  const link = page.getByRole('button', { name: websiteLinkName }).first();

  expect(await link.evaluate((element) => ({ tag: element.tagName, tabIndex: (element as HTMLElement).tabIndex })))
    .toEqual({ tag: 'BUTTON', tabIndex: 0 });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');

  await expectWebsiteRefreshOpen(page);
});

test('a resolved wiki-link opens from the live editor', async ({ page }) => {
  await openNote(page, 'Dashboard.mdx');
  // The three view modes are one segmented control now, in the pane header or
  // in the layout's editor panel, rather than a "View options" dropdown here
  // and a row of plain buttons there.
  //
  // This test used to drive that dropdown, which set App's own editor mode --
  // and in a workspace with a layout.json the editor is a panel that owns its
  // mode, so the click changed nothing and the assertion below passed against
  // the reading view. It only reaches the live editor now that both spellings
  // of the control are the same control.
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  await expect(page.locator('.cm-live-editor')).toBeVisible();

  // CodeMirror only renders the lines near the viewport, so a link far down the
  // document is not in the DOM until it is scrolled towards.
  const link = page.getByRole('button', { name: websiteLinkName }).first();
  const scroller = page.locator('.cm-scroller').first();
  for (let i = 0; i < 25 && (await link.count()) === 0; i++) {
    await scroller.evaluate((element) => { element.scrollTop += element.clientHeight * 0.8; });
    await page.waitForTimeout(100);
  }
  await link.click();

  await expectWebsiteRefreshOpen(page);
});

test('a unique basename opens its note', async ({ page, workspace }) => {
  mkdirSync(join(workspace, 'projects'), { recursive: true });
  writeFileSync(join(workspace, 'projects', 'Recovery.mdx'), '# Recovery\n');
  writeFileSync(join(workspace, 'basename-link.mdx'), '# Link\n\n[[Recovery]]\n');

  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'basename-link.mdx');
  await page.getByRole('button', { name: 'Open note projects/Recovery.mdx' }).click();

  await expect(page.locator('article.preview-prose h1')).toHaveText('Recovery');
});

test('missing and ambiguous targets are explained, inert, and markup-safe', async ({ page, workspace }) => {
  mkdirSync(join(workspace, 'alpha'), { recursive: true });
  mkdirSync(join(workspace, 'beta'), { recursive: true });
  writeFileSync(join(workspace, 'alpha', 'Shared.mdx'), '# Alpha shared\n');
  writeFileSync(join(workspace, 'beta', 'Shared.mdx'), '# Beta shared\n');
  writeFileSync(join(workspace, "x' onmouseover='alert(1).mdx"), '# Safe target\n');
  writeFileSync(
    join(workspace, 'broken-links.mdx'),
    [
      '# Broken links',
      '',
      '[[No Such Note]]',
      '',
      '[[Shared]]',
      '',
      "[[x' onmouseover='alert(1)]]",
      '',
      '[[<img src=x onerror=alert(1)>]]',
      '',
    ].join('\n'),
  );

  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'broken-links.mdx');

  const missing = page.getByTitle('No note found for "No Such Note"');
  await expect(missing).toBeVisible();
  const missingState = await missing.evaluate((element) => ({
    tag: element.tagName,
    tabIndex: (element as HTMLElement).tabIndex,
    cursor: getComputedStyle(element).cursor,
    text: element.textContent,
    decorationLine: getComputedStyle(element).textDecorationLine,
    borderStyle: getComputedStyle(element).borderStyle,
  }));

  // What matters is that it is not a link and cannot be mistaken for one: a
  // span rather than a button, not reachable by keyboard, no pointer cursor,
  // and it says so in words for anyone who cannot see the styling.
  expect(missingState).toMatchObject({ tag: 'SPAN', tabIndex: -1, cursor: 'default', text: 'No Such Note (missing note)' });

  // And that it is visibly marked as broken. Links render as pills now, so a
  // missing one keeps the pill shape -- a broken link should read as the same
  // kind of thing as a working one -- but dashed and struck through.
  expect(missingState.decorationLine).toContain('line-through');
  expect(missingState.borderStyle).toContain('dashed');

  await expect(page.getByTitle('No note found for "Shared"')).toBeVisible();
  await expect(page.getByRole('button', { name: /Open note .*Shared/ })).toHaveCount(0);

  const hostileResolved = page.getByRole('button', { name: "Open note x' onmouseover='alert(1).mdx" });
  await expect(hostileResolved).toBeVisible();
  const resolvedAttributes = await hostileResolved.evaluate((element) => ({
    className: element.getAttribute('class') ?? '',
    href: element.getAttribute('href'),
    onmouseover: element.getAttribute('onmouseover'),
  }));
  expect(resolvedAttributes.className).not.toContain('onmouseover');
  expect(resolvedAttributes.href).toBeNull();
  expect(resolvedAttributes.onmouseover).toBeNull();

  const hostile = page.getByTitle('No note found for "<img src=x onerror=alert(1)>"');
  await expect(hostile).toBeVisible();
  const attributes = await hostile.evaluate((element) => ({
    className: element.getAttribute('class') ?? '',
    href: element.getAttribute('href'),
    html: element.innerHTML,
  }));
  expect(attributes.className).not.toContain('onerror');
  expect(attributes.href).toBeNull();
  expect(attributes.html).not.toContain('<img');
});
