import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: canvas and the other file surfaces. Each kind of file opens in
// its own surface. surfaces.spec.ts, open-files.spec.ts, all-files.spec.ts,
// mermaid.spec.ts and surface-errors.spec.ts hold the detail.

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
/** A 3 by 2 RGBA PNG. */
function png(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(3, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(1 + 3 * 4, 255);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const contents = (page: Page) => page.getByRole('listbox', { name: 'Workspace contents' });

test('a canvas opens as a board with its cards in view', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Idea board' }).first().click();
  const board = page.locator('[data-canvas-surface]');
  await expect(board).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0);
  const cards = page.locator('[data-canvas-node]');
  await expect(cards.first()).toBeVisible();
  const view = (await board.boundingBox())!;
  const first = (await cards.first().boundingBox())!;
  expect(first.x).toBeGreaterThanOrEqual(view.x - 2);
  expect(first.x + first.width).toBeLessThanOrEqual(view.x + view.width + 2);
});

test('an image opens at its size, and a JSON file opens as text and saves an edit', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'dot.png'), png());
  writeFileSync(join(workspace, 'data.json'), '{"a": 1}\n');
  await page.getByRole('button', { name: 'Refresh explorer' }).click();

  await contents(page).getByRole('option', { name: 'dot.png', exact: true }).dblclick({ timeout: 15_000 });
  await expect(page.locator('[data-image-surface] [data-image-size]')).toHaveText('3 × 2 px');

  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await contents(page).getByRole('option', { name: 'data.json', exact: true }).dblclick();
  const editor = page.locator('[data-text-surface] .cm-content');
  await expect(editor).toContainText('"a": 1');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('oops');
  await expect.poll(() => readFileSync(join(workspace, 'data.json'), 'utf-8')).toBe('{"a": 1}\noops');
  // Not valid JSON any more: said under the header, and the edit still saved.
  await expect(page.locator('[data-json-error]')).toBeVisible();
});

test('a Mermaid file draws its diagram', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'Flow.mmd'), 'flowchart LR\n  Source --> Diagram\n');
  await openNote(page, 'Flow.mmd');
  await expect(page.locator('[data-mermaid-surface]')).toBeVisible();
  await expect(page.locator('[data-mermaid-diagram] svg')).toBeVisible();
  await expect(page.locator('[data-mermaid-diagram]')).toContainText('Diagram');
});
