import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { test, expect } from './fixtures';

// Images, audio and text open in surfaces of their own; programs, scripts and
// unknown binaries never open. The binary fixtures are written from code so
// they are exactly what each assertion says they are.

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
/** An RGBA PNG, half red and half transparent. */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const row = Buffer.alloc(1 + width * 4); // filter byte 0, then pixels
  for (let x = 0; x < width; x += 2) { row[1 + x * 4] = 255; row[4 + x * 4] = 255; }
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** One second of 16-bit mono PCM silence. */
function wav(seconds = 1, rate = 8000): Buffer {
  const bytes = Math.round(seconds * rate) * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.alloc(bytes)]);
}

test.use({
  prepareWorkspace: async ({}, use) => use((dir: string) => {
    writeFileSync(join(dir, 'note.md'), '# Note\n');
    writeFileSync(join(dir, 'dot.png'), png(3, 2));
    writeFileSync(join(dir, 'sound.wav'), wav());
    writeFileSync(join(dir, 'data.json'), '{"a": 1}\n');
    writeFileSync(join(dir, 'README'), 'Plain text with no extension.\n');
    writeFileSync(join(dir, 'tool.exe'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]));
    writeFileSync(join(dir, 'run.bat'), '@echo off\r\necho hi\r\n');
    writeFileSync(join(dir, 'blob.xyz'), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10]));
  }),
});

const contents = (page: import('@playwright/test').Page) => page.getByRole('listbox', { name: 'Workspace contents' });
const tabs = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Open notes' });

test('a PNG opens with its natural size, and a WAV plays', async ({ page }) => {
  const list = contents(page);
  await list.getByRole('option', { name: 'dot.png', exact: true }).dblclick({ timeout: 15_000 });
  const surface = page.locator('[data-image-surface]');
  await expect(surface.locator('[data-image-size]')).toHaveText('3 × 2 px');
  await expect.poll(() => surface.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(3);
  await expect(tabs(page).getByRole('button', { name: /^Close / })).toHaveCount(1);

  // The New tab button goes home to the explorer without closing the image.
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(list).toBeVisible();
  await list.getByRole('option', { name: 'sound.wav', exact: true }).dblclick();
  const audio = page.locator('[data-media-surface] audio');
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration), { timeout: 15_000 }).toBeGreaterThan(0.9);
  await expect(page.getByText("This file can't be played here.")).toHaveCount(0);
});

test('a JSON file opens in the editor and an edit saves to disk', async ({ page, workspace }) => {
  await contents(page).getByRole('option', { name: 'data.json', exact: true }).dblclick({ timeout: 15_000 });
  const editor = page.locator('[data-text-surface] .cm-content');
  await expect(editor).toContainText('"a": 1');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('oops');
  await expect.poll(() => readFileSync(join(workspace, 'data.json'), 'utf-8')).toBe('{"a": 1}\noops');
  // Not valid JSON any more: said under the header, and the edit still saved.
  await expect(page.locator('[data-json-error]')).toBeVisible();

  // A file whose name Neuron does not know opens as text because it is text.
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await contents(page).locator('[data-file="README"]').dblclick();
  await expect(page.locator('[data-text-surface] .cm-content')).toContainText('Plain text with no extension.');
});

test('programs, scripts and unknown binaries stay other files and never open', async ({ page, workspace }) => {
  const list = contents(page);
  const tree = page.getByRole('complementary', { name: 'Workspace sidebar' }).locator('[data-sidebar-tree]');
  for (const name of ['tool.exe', 'run.bat', 'blob.xyz']) {
    await expect(list.locator(`[data-other-file="${name}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(tree.locator(`[data-other-file="${name}"]`)).toBeVisible();
    const option = list.getByRole('option', { name, exact: true });
    await option.dblclick();
    await option.press('Enter');
    await tree.locator(`[data-other-file="${name}"] button`).click();
    await expect(tabs(page).getByRole('button', { name: /^Close / })).toHaveCount(0);
    await expect(page.locator('[data-workspace-explorer]')).toBeVisible();
  }
  // The text files beside them do open.
  await expect(list.locator('[data-file="data.json"]')).toBeVisible();

  // And main refuses them whatever the renderer asks.
  const results = await page.evaluate(async () => {
    const bridge = (window as unknown as { electronAPI: { readNote(p: string): Promise<string>; writeNote(p: string, c: string): Promise<{ success: boolean }> } }).electronAPI;
    return {
      reads: await Promise.all(['tool.exe', 'run.bat', 'blob.xyz', 'dot.png'].map((p) => bridge.readNote(p))),
      writes: await Promise.all(['tool.exe', 'run.bat', 'blob.xyz', 'dot.png'].map((p) => bridge.writeNote(p, 'replaced'))),
    };
  });
  expect(results.reads.every((text) => text.startsWith('Error:'))).toBe(true);
  expect(results.writes.map((result) => result.success)).toEqual([false, false, false, false]);
  expect(readFileSync(join(workspace, 'run.bat'), 'utf-8')).toBe('@echo off\r\necho hi\r\n');
});

test('neuron-file:// serves this window its own images and refuses any other token', async ({ page }) => {
  await expect(contents(page).getByRole('option', { name: 'dot.png', exact: true })).toBeVisible({ timeout: 15_000 });
  const outcome = await page.evaluate(async () => {
    const bridge = (window as unknown as { electronAPI: { fileUrl(p: string): string } }).electronAPI;
    const load = (src: string) => new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => resolve('loaded');
      img.onerror = () => resolve('refused');
      img.src = src;
    });
    const good = bridge.fileUrl('dot.png');
    const match = /^neuron-file:\/\/w\/(\d+)\/([0-9a-f]+)\/(.+)$/.exec(good);
    if (!match) return { good, form: false };
    const [, id, token, file] = match;
    const fetched = await fetch(good).then(() => 'read', () => 'refused');
    return {
      form: true,
      good: await load(good),
      otherToken: await load(`neuron-file://w/${id}/${'f'.repeat(token.length)}/${file}`),
      otherWindow: await load(`neuron-file://w/${Number(id) + 1000}/${token}/${file}`),
      noToken: await load(`neuron-file://w/${id}/${file}`),
      traversal: await load(`neuron-file://w/${id}/${token}/${encodeURIComponent('../dot.png')}`),
      program: await load(bridge.fileUrl('tool.exe')),
      fetched,
    };
  });
  expect(outcome).toEqual({
    form: true, good: 'loaded', otherToken: 'refused', otherWindow: 'refused', noToken: 'refused', traversal: 'refused', program: 'refused', fetched: 'refused',
  });
});
