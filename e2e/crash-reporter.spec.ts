// Crash capture is actually running, and is not configured to upload.
//
// The unit test asserts the options; this asserts Electron accepted them. A
// crash reporter that was never started looks identical to one that was, right
// up until the crash you needed it for.
import { test, expect } from './fixtures';

test('Crashpad is running, with uploads off', async ({ app }) => {
  const state = await app.evaluate(async ({ app: electronApp, crashReporter }) => ({
    uploads: crashReporter.getUploadToServer(),
    dumps: electronApp.getPath('crashDumps'),
    logs: electronApp.getPath('logs'),
  }));

  // The promise Neuron makes about telemetry, checked against the running app
  // rather than the source.
  expect(state.uploads).toBe(false);

  // Beneath the logs folder, so "Open logs folder" reveals dumps too.
  expect(state.dumps.startsWith(state.logs)).toBe(true);
  expect(state.dumps.endsWith('crashes')).toBe(true);
});
