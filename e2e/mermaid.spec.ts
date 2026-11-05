import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openNote } from './fixtures';

test('a Mermaid file renders live and replaces a stale diagram with syntax errors', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'Flow.mmd'), 'flowchart LR\n  Source --> Diagram\n');
  await openNote(page, 'Flow.mmd');

  await expect(page.locator('[data-mermaid-surface]')).toBeVisible();
  await expect(page.locator('[data-mermaid-diagram] svg')).toBeVisible();
  await expect(page.locator('[data-mermaid-diagram]')).toContainText('Source');
  await expect(page.locator('[data-mermaid-diagram]')).toContainText('Diagram');

  const editor = page.getByLabel('Note source');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('this is not a mermaid diagram');

  const error = page.getByRole('alert').filter({ hasText: 'Mermaid render error' });
  await expect(error).toBeVisible();
  await expect(error).toContainText(/diagram|syntax|parse/i);
  await expect(page.locator('[data-mermaid-diagram]')).toHaveCount(0);
});
