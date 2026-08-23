import { test, expect } from './fixtures';

// T-031. Plugin API keys were readable by any renderer code: they lived in the
// plugin config blob, which settings.get returns, and were then handed back to
// main on every ai:complete call. Plugins are not sandboxed (risk R3), so one
// plugin could read another's key.

test('a stored secret cannot be read back by renderer code', async ({ page }) => {
  const probe = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    await api.settings.setSecret('ai-claude', 'apiKey', 'sk-test-SHOULD-NEVER-LEAK');

    return {
      present: await api.settings.hasSecret('ai-claude', 'apiKey'),
      viaReservedKey: await api.settings.get('__secrets'),
      viaPluginBlob: JSON.stringify((await api.settings.get('plugins')) ?? {}),
      // There must be no getter at all, not merely a filtered one.
      getterExists: typeof api.settings.getSecret,
    };
  });

  expect(probe.present).toBe(true);
  expect(probe.viaReservedKey).toBeNull();
  expect(probe.viaPluginBlob).not.toContain('SHOULD-NEVER-LEAK');
  expect(probe.getterExists).toBe('undefined');
});

test('the reserved secret namespace cannot be overwritten from the renderer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    await api.settings.setSecret('ai-openai', 'apiKey', 'sk-original');
    // Clobbering the store through the generic setter would erase every key.
    const wrote = await api.settings.set('__secrets', { 'ai-openai': { apiKey: 'sk-attacker' } });
    return { wrote, stillThere: await api.settings.hasSecret('ai-openai', 'apiKey') };
  });

  expect(result.wrote.success).toBe(false);
  expect(result.stillThere).toBe(true);
});
