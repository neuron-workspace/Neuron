// The macOS application menu.
//
// On Windows and Linux Neuron has no menu bar: the custom title bar carries
// everything and `setMenuBarVisibility(false)` hides Electron's default. macOS
// is different in kind, not degree. The menu bar belongs to the screen rather
// than the window, an app without one still shows the previous app's menu, and
// the shortcuts users expect to exist — Cmd+Q, Cmd+W, Cmd+, — are menu items
// first and key handlers second. Without this, Cmd+Q did nothing.
//
// Anything with a `role` is handled by Electron and behaves the way the system
// expects, including the items macOS adds itself (Services, Hide Others, the
// window list). Only the two genuinely app-specific commands are wired by hand.
import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

/** Ask the renderer to run one of the app's own commands. */
function send(window: BrowserWindow | null, command: string): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('menu:command', command);
}

/**
 * Show the shortcut, do not claim it.
 *
 * An accelerator registered on a menu item is consumed by the menu before the
 * page ever sees the keystroke. For Cmd+F that would be a regression rather
 * than a feature: find inside the editor is CodeMirror's own binding, and
 * taking Cmd+F away from it would break searching a document to gain a menu
 * label. Cmd+K is the same story with the renderer's chord dispatcher, which
 * already treats Cmd as `mod`.
 *
 * `registerAccelerator: false` displays the shortcut where a Mac user expects
 * to find it while leaving the keystroke itself to the page. Clicking the item
 * still works, through the command channel above.
 */
const shows = (accelerator: string) => ({ accelerator, registerAccelerator: false });

export function buildMacApplicationMenu(getWindow: () => BrowserWindow | null): Menu {
  const name = app.name;

  const template: MenuItemConstructorOptions[] = [
    {
      label: name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          // Cmd+, is the system-wide convention for preferences, and macOS
          // users reach for it before they look for a settings button. Nothing
          // in the renderer binds it, so this one is safe to register.
          label: 'Settings…',
          accelerator: 'Command+,',
          click: () => send(getWindow(), 'settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', ...shows('Command+F'), click: () => send(getWindow(), 'find') },
        { label: 'Search & Commands…', ...shows('Command+K'), click: () => send(getWindow(), 'palette') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        // The reason this task existed: with a frameless window there was no
        // native full screen at all, so neither Ctrl+Cmd+F nor the green
        // button behaved the way every other Mac app does.
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Neuron on GitHub',
          click: () => { void shell.openExternal('https://github.com/neuron-workspace/Neuron'); },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

/**
 * Install the menu this platform should have.
 *
 * Windows and Linux get none, which is what they had before: the in-app title
 * bar is the menu there, and an Electron default menu would only add a second
 * one nobody asked for.
 */
export function installApplicationMenu(getWindow: () => BrowserWindow | null): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(buildMacApplicationMenu(getWindow));
}
