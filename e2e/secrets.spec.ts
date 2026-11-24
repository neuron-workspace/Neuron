import { test, expect, openSettings } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-031. Plugin API keys were readable by any renderer code: they lived in the
// plugin config blob, which settings.get returns, and were then handed back to
// main on every ai:complete call. Plugins are not sandboxed (risk R3), so one
// plugin could read another's key.

/** The refusal, as main words it on this platform (10B: Linux is told how to fix it). */
const NO_KEYCHAIN = "No system keychain is available, so Neuron can't store keys safely on this computer."
  + (process.platform === 'linux' ? ' Install and unlock GNOME Keyring or KWallet, then restart Neuron.' : '');

test('a stored secret is encrypted on disk and cannot be read back by renderer code', async ({ page, app }) => {
  const probe = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const saved = await api.settings.setSecret('anthropic', 'apiKey', 'sk-test-SHOULD-NEVER-LEAK');

    return {
      saved,
      present: await api.settings.hasSecret('anthropic', 'apiKey'),
      viaReservedKey: await api.settings.get('__secrets'),
      viaPluginBlob: JSON.stringify((await api.settings.get('plugins')) ?? {}) + JSON.stringify((await api.settings.get('connectors')) ?? {}),
      // There must be no getter at all, not merely a filtered one.
      getterExists: typeof api.settings.getSecret,
    };
  });

  expect(probe.present).toBe(probe.saved.success);
  if (!probe.saved.success) expect(probe.saved.error).toBe(NO_KEYCHAIN);
  expect(probe.viaReservedKey).toBeNull();
  expect(probe.viaPluginBlob).not.toContain('SHOULD-NEVER-LEAK');
  expect(probe.getterExists).toBe('undefined');
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const raw = readFileSync(join(userData, 'neuron-settings.json'), 'utf8');
  expect(raw).not.toContain('SHOULD-NEVER-LEAK');
  if (probe.saved.success) expect(JSON.parse(raw).__secrets.anthropic.apiKey).toEqual({ v: 1, enc: expect.any(String) });
});

test('the reserved secret namespace cannot be overwritten from the renderer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const saved = await api.settings.setSecret('ai-openai', 'apiKey', 'sk-original');
    // Clobbering the store through the generic setter would erase every key.
    const wrote = await api.settings.set('__secrets', { 'ai-openai': { apiKey: 'sk-attacker' } });
    return { saved, wrote, stillThere: await api.settings.hasSecret('ai-openai', 'apiKey') };
  });

  expect(result.wrote.success).toBe(false);
  expect(result.stillThere).toBe(result.saved.success);
});

test('a key cannot be smuggled into plain settings under any name or depth', async ({ app, page }) => {
  const results = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    return Promise.all([
      api.settings.set('pluginstore:any-plugin:state', { deep: [{ apiKey: 'sk-test-SMUGGLED-1' }] }),
      api.settings.set('connectors', { anthropic: { apiKey: 'sk-test-SMUGGLED-2' } }),
    ]);
  });
  for (const result of results) expect(result).toEqual({ success: false, error: 'Use the secret store for keys.' });
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(readFileSync(join(userData, 'neuron-settings.json'), 'utf8')).not.toContain('SMUGGLED');
});

test('Settings shows the keychain refusal and writes no plaintext key', async ({ app, page }) => {
  await app.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => false; });
  const settings = await openSettings(app, page, 'connectors');
  await settings.getByRole('button', { name: 'Set up Claude', exact: true }).click();
  await settings.getByLabel('Anthropic API key').fill('sk-no-keychain-test');
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings.getByRole('alert')).toHaveText(NO_KEYCHAIN);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(readFileSync(join(userData, 'neuron-settings.json'), 'utf8')).not.toContain('sk-no-keychain-test');
});
