import { chmodSync, copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { test, expect, openNote } from './fixtures';

// Files on disk (review module 2): the 25 MB read ceiling, open text files
// following outside edits, the choice offered when a file changes outside
// Neuron while an edit made here is not on disk, and canvas images streamed
// from disk.

const demo = resolve(__dirname, '..', 'examples', 'demo-repo');

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
/** A valid RGBA PNG, padded past `bytes` with a private ancillary chunk that decoders skip. */
function png(width: number, height: number, bytes = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 2) { row[1 + x * 4] = 255; row[4 + x * 4] = 255; }
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...(bytes > 0 ? [chunk('prVt', Buffer.alloc(bytes))] : []),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Make saves of `file` fail, as a read-only file does: on Windows the rename
 * and the in-place fallback fail with EPERM; elsewhere a read-only folder
 * stops the temporary file being created. Returns the undo.
 */
function blockSaves(workspace: string, file: string) {
  const win = process.platform === 'win32';
  if (win) chmodSync(file, 0o444); else chmodSync(workspace, 0o555);
  return () => (win ? chmodSync(file, 0o644) : chmodSync(workspace, 0o755));
}

const contents = (page: import('@playwright/test').Page) => page.getByRole('listbox', { name: 'Workspace contents' });

test.describe('the 25 MB ceiling', () => {
  test.use({
    prepareWorkspace: async ({}, use) => use((dir: string) => {
      writeFileSync(join(dir, 'control.md'), '# Control\n\nquokkafjord lives here.\n');
      // 26 MB, with a word near the top that only a read of the file would find.
      const head = '# Huge\n\nzebracadabra is in this note.\n\n';
      writeFileSync(join(dir, 'huge.md'), head + 'lorem ipsum dolor sit amet\n'.repeat(Math.ceil((26 * 1024 * 1024) / 27)));
    }),
  });

  test('a note over 25 MB is listed, never read, and refused when opened', async ({ page, workspace }) => {
    const size = statSync(join(workspace, 'huge.md')).size;
    expect(size).toBeGreaterThan(25 * 1024 * 1024);
    await expect(page.locator('.note-row', { hasText: 'huge' }).first()).toBeVisible({ timeout: 15_000 });

    // Search reads note contents: the small note's word is found, the large one's is not.
    await page.getByRole('button', { name: /Search & commands/ }).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input').first().fill('Search in notes');
    await dialog.getByText('Search in notes', { exact: true }).first().click();
    const search = page.locator('section[aria-label="Search notes"]');
    const box = search.getByRole('textbox').first();
    await box.fill('quokkafjord');
    await expect(search.getByText('control.md', { exact: false }).first()).toBeVisible();
    await box.fill('zebracadabra');
    await expect(search.getByText('huge.md', { exact: false })).toHaveCount(0);

    await openNote(page, 'huge.md');
    const message = page.locator('[data-too-large]');
    await expect(message).toHaveText('This file is too large to open in Neuron (over 25 MB).');
    await expect(page.locator('.cm-content')).toHaveCount(0);
    await expect(page.getByText('zebracadabra')).toHaveCount(0);

    // Main refuses it whatever the renderer asks, and the file is untouched.
    const answers = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI: { readNote(p: string): Promise<string>; writeNote(p: string, c: string): Promise<{ success: boolean; error?: string }> } }).electronAPI;
      return { read: await api.readNote('huge.md'), write: await api.writeNote('huge.md', 'replaced') };
    });
    expect(answers.read).toBe('Error: This file is too large to open in Neuron (over 25 MB).');
    expect(answers.write.success).toBe(false);
    expect(statSync(join(workspace, 'huge.md')).size).toBe(size);
  });
});

test.describe('outside changes', () => {
  test.use({
    prepareWorkspace: async ({}, use) => use((dir: string) => {
      writeFileSync(join(dir, 'note.md'), '# Note\n\nFirst version.\n');
      writeFileSync(join(dir, 'data.json'), '{"version": 1}\n');
      copyFileSync(join(demo, 'Planner.db'), join(dir, 'Planner.db'));
    }),
  });

  test('an open JSON file shows a change made on disk (2D)', async ({ page, workspace }) => {
    await contents(page).getByRole('option', { name: 'data.json', exact: true }).dblclick({ timeout: 15_000 });
    const editor = page.locator('[data-text-surface] .cm-content');
    await expect(editor).toContainText('"version": 1');
    writeFileSync(join(workspace, 'data.json'), '{"version": 2}\n');
    await expect(editor).toContainText('"version": 2', { timeout: 10_000 });
    await expect(page.locator('[data-external-change]')).toHaveCount(0);
  });

  /** Open note.md in Live mode and make an edit that cannot be saved. */
  async function unsavedEdit(page: import('@playwright/test').Page, workspace: string) {
    const file = join(workspace, 'note.md');
    await openNote(page, 'note.md');
    await page.getByRole('button', { name: 'Live', exact: true }).first().click();
    const line = page.locator('p[data-live-line]').filter({ hasText: 'First version.' });
    await expect(line).toBeVisible();
    const unblock = blockSaves(workspace, file);
    // Let the watcher's report of the permission change come and go first.
    await page.waitForTimeout(600);
    try {
      await line.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
      await page.keyboard.insertText(' Mine.');
      // Live mode hands the edit over when the line loses focus.
      await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
      await expect(page.getByRole('status').filter({ hasText: 'Save failed' }).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      unblock();
    }
    expect(readFileSync(file, 'utf8')).toBe('# Note\n\nFirst version.\n');
    // Someone else changes the file while ours is not on disk.
    writeFileSync(file, '# Note\n\nTheirs.\n');
    const bar = page.locator('[data-external-change="note.md"]');
    await expect(bar).toContainText('note.md changed outside Neuron.', { timeout: 10_000 });
    return { file, bar };
  }

  test('a note changed outside while an edit is not saved asks; Keep my version writes ours (6B)', async ({ page, workspace }) => {
    const { file, bar } = await unsavedEdit(page, workspace);
    // Nothing is written for the file until the user chooses, edits included.
    await page.locator('p[data-live-line]').filter({ hasText: 'First version. Mine.' }).click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await page.keyboard.insertText(' More.');
    await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
    await page.waitForTimeout(1000);
    expect(readFileSync(file, 'utf8')).toBe('# Note\n\nTheirs.\n');
    await expect(page.locator('p[data-live-line]').filter({ hasText: 'First version. Mine. More.' })).toBeVisible();

    await bar.getByRole('button', { name: 'Keep my version' }).click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => readFileSync(file, 'utf8')).toBe('# Note\n\nFirst version. Mine. More.\n');
  });

  test('Use the file on disk drops the unsaved edit and takes the outside version (6B)', async ({ page, workspace }) => {
    const { file, bar } = await unsavedEdit(page, workspace);
    await bar.getByRole('button', { name: 'Use the file on disk' }).click();
    await expect(bar).toHaveCount(0);
    const line = page.locator('p[data-live-line]').filter({ hasText: 'Theirs.' });
    await expect(line).toBeVisible();
    await expect(page.getByText('Mine.')).toHaveCount(0);
    expect(readFileSync(file, 'utf8')).toBe('# Note\n\nTheirs.\n');

    // And editing goes on as normal from the outside version.
    await line.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await page.keyboard.insertText(' Then here.');
    await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
    await expect.poll(() => readFileSync(file, 'utf8')).toBe('# Note\n\nTheirs. Then here.\n');
  });

  test('a database changed outside while an edit is not saved asks; Keep my version writes ours (6B)', async ({ page, workspace }) => {
    const file = join(workspace, 'Planner.db');
    await openNote(page, 'Planner.db');
    await page.getByRole('button', { name: 'Open Tasks table' }).click();
    const cell = page.locator('table tbody tr').first().locator('td').nth(1).locator('input.vw-cell');
    await expect(cell).toBeVisible();
    const original = readFileSync(file, 'utf8');
    expect(original).toContain('Write the announcement post');

    const unblock = blockSaves(workspace, file);
    await page.waitForTimeout(600);
    try {
      await cell.fill('Edited in Neuron');
      await cell.blur();
      await expect(page.getByRole('alert').filter({ hasText: "Couldn't save Planner.db:" })).toBeVisible();
    } finally {
      unblock();
    }
    writeFileSync(file, original.replace('Write the announcement post', 'Changed outside Neuron'));
    const bar = page.locator('[data-external-change="Planner.db"]');
    await expect(bar).toContainText('Planner.db changed outside Neuron.', { timeout: 10_000 });
    // The table keeps the local edit until the user chooses.
    await expect(cell).toHaveValue('Edited in Neuron');
    await page.waitForTimeout(800);
    expect(readFileSync(file, 'utf8')).toContain('Changed outside Neuron');

    await bar.getByRole('button', { name: 'Keep my version' }).click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => {
      const text = readFileSync(file, 'utf8');
      return text.includes('Edited in Neuron') && !text.includes('Changed outside Neuron');
    }).toBe(true);
  });
});

test.describe('canvas images', () => {
  test.use({
    prepareWorkspace: async ({}, use) => use((dir: string) => {
      writeFileSync(join(dir, 'big.png'), png(40, 20, 11 * 1024 * 1024));
      writeFileSync(join(dir, 'Board.canvas'), JSON.stringify({
        nodes: [
          { id: 'big', type: 'file', file: 'big.png', x: 0, y: 0, width: 320, height: 200 },
          { id: 'gone', type: 'file', file: 'gone.png', x: 400, y: 0, width: 320, height: 200 },
        ],
        edges: [],
      }, null, 2));
    }),
  });

  test('a canvas image card shows an image over 10 MB, streamed from disk (7A)', async ({ page, workspace }) => {
    expect(statSync(join(workspace, 'big.png')).size).toBeGreaterThan(10 * 1024 * 1024);
    await page.locator('.note-row', { hasText: 'Board' }).first().click();
    const image = page.locator('[data-canvas-node] img[alt="big.png"]');
    await expect(image).toBeVisible({ timeout: 15_000 });
    await expect(image).toHaveAttribute('src', /^neuron-file:\/\//);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 }).toBe(40);
    // A card whose image is not there still says so.
    await expect(page.getByText('File not found: gone.png')).toBeVisible();
  });
});
