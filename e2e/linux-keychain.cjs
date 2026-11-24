// Preloaded (`-r`) into the end-to-end app on the Linux runner, by e2e/fixtures.ts.
//
// Playwright starts Electron with its own preload first, and that preload calls
// app.commandLine.appendSwitch('password-store', 'basic') (with the rest of its
// Chromium test switches). A later appendSwitch replaces the value, so its
// "basic" beat the `--password-store=gnome-libsecret` that fixtures.ts passed
// on the command line: the app came up with Chromium's plain-text store, saw no
// keychain, and the key tests skipped while ci.yml's own probe (plain
// `electron`, no Playwright) found gnome-libsecret on the same session bus.
//
// This runs after Playwright's preload and before the app, so the keychain ci.yml
// starts is the one the app gets. It selects a real backend; it does not fake
// encryption, and it is never loaded outside Linux CI.
const path = require('node:path');
const { app } = require('electron');

app.commandLine.appendSwitch('password-store', 'gnome-libsecret');

// Leave process.argv as the app would see it without this file: drop `-r <this file>`.
const index = process.argv.findIndex((arg) => path.resolve(arg) === __filename);
if (index > 0 && (process.argv[index - 1] === '-r' || process.argv[index - 1] === '--require')) {
  process.argv.splice(index - 1, 2);
}
