import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test.skip(process.env.NEURON_SCALE_BENCH !== '1', 'Opt-in workspace scale measurement');
const NOTES = Number(process.env.NEURON_SCALE_NOTES ?? 5000);
const LAST_NOTE = `Note-${String(NOTES - 1).padStart(5, '0')}`;
test.setTimeout(180_000);
// Imported at run time: Playwright loads specs as CommonJS, and the generator is
// an ES module shared with the plain-Node benchmark. Wrapped in a fixture
// function because Playwright reads a bare function in test.use as one.
test.use({ prepareWorkspace: async ({}, use) => use(async (directory: string) => {
  const { generateWorkspace } = await import(pathToFileURL(join(__dirname, '..', 'tools', 'scale-fixture.mjs')).href);
  generateWorkspace(directory, { notes: NOTES, avgBytes: 2048, linksPerNote: 4, tags: 20, dbRows: 10000, canvasNodes: 1000 });
}) });

const painted = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

test(`measure a ${NOTES}-note workspace`, async ({ page, launchTiming }) => {
  // Root folders prove the corpus loaded; enter one to observe actual note cards.
  const explorer = page.locator('[data-workspace-explorer]');
  await explorer.locator('[data-folder="Research"]').click();
  await explorer.locator('[data-folder="Research/Batch-0000"]').click();
  await expect(explorer.locator('[data-file$="Note-00000.md"]')).toBeVisible();
  await painted(page);
  const launchToExplorerMs = performance.now() - launchTiming.startedAt;

  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  const searchStart = performance.now();
  await dialog.getByRole('combobox').or(dialog.locator('input')).first().fill(LAST_NOTE);
  await expect(dialog.getByText(LAST_NOTE, { exact: false }).first()).toBeVisible();
  await painted(page);
  const quickOpenQueryMs = performance.now() - searchStart;
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const dbRow = page.locator('.note-row', { hasText: 'Scale.db' }).first();
  await expect(dbRow).toBeVisible();
  const dbStart = performance.now();
  await dbRow.click();
  // The row counter, not the number of <tr>s: a virtualised table renders only
  // the rows in view, and the benchmark has to measure both versions.
  await expect(page.getByText('10000 / 10000 rows')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('table tbody tr').first().locator('input.vw-cell').first()).toHaveValue('Review milestone 0');
  await painted(page);
  const dbOpenMs = performance.now() - dbStart;

  const scrolling = await page.evaluate(async () => {
    const table = document.querySelector('table');
    if (!table) throw new Error('Table not mounted');
    let scroller: HTMLElement | null = table.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (!scroller) throw new Error('No scrollable table ancestor');
    const target = scroller;
    const deltas: number[] = [];
    const maxScroll = target.scrollHeight - target.clientHeight;
    const startScroll = target.scrollTop;
    await new Promise<void>(resolve => {
      let previous = 0;
      let frame = 0;
      const tick = (now: number) => {
        if (previous) deltas.push(now - previous);
        previous = now;
        target.scrollTop = maxScroll * ((frame % 120) / 119);
        if (++frame <= 240) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const endScroll = target.scrollTop;
    target.scrollTop = startScroll;
    const sorted = [...deltas].sort((a, b) => a - b);
    return { frames: deltas.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: Math.max(...deltas), over33ms: deltas.filter(ms => ms > 33.33).length, maxScroll, endScroll, deltasMs: deltas };
  });
  expect(scrolling.maxScroll).toBeGreaterThan(0);

  const canvasRow = page.locator('.note-row', { hasText: 'Scale.canvas' }).first();
  await expect(canvasRow).toBeVisible();
  const canvasStart = performance.now();
  await canvasRow.click();
  await expect(page.locator('[data-canvas-surface]')).toBeVisible();
  await expect(page.locator('[data-canvas-node]')).toHaveCount(1000, { timeout: 90_000 });
  await painted(page);
  const canvasOpenMs = performance.now() - canvasStart;
  console.log(JSON.stringify({ benchmark: 'workspace-scale', notes: NOTES, dbRows: 10000, canvasNodes: 1000, platform: process.platform, node: process.version, softwareGL: process.env.NEURON_SOFTWARE_GL === '1' || Boolean(process.env.CI && process.platform !== 'win32'), launchToExplorerMs, quickOpenQueryMs, dbOpenMs, canvasOpenMs, scrolling, method: 'Single run; launch includes fixture app setup, folder navigation and Vite startup. Open timings include click and two animation frames. Quick-open measures palette filename search, not body search. Scroll uses scripted scrollTop over 240 rAF intervals.' }));
});
