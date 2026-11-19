import { app, BrowserWindow, ipcMain, dialog, shell, session, crashReporter, protocol } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { decideOpen, settingsSectionOf, ownsPtyKey, ptyKey, type SettingsSection, type WindowKind } from './workspace-windows';
import { autoUpdater } from 'electron-updater';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { importChromeCookies } from './chrome-cookies';
import { initHtmxViews, getViewServerOrigin, revokeAllViewSessions } from './htmx';
import { DEV_URL, isAppContent, isSameOrigin } from './navigation';
import { resolveInside, realpathInside } from './repoPath';
import { folderKey, uniqueRecents } from './recentRepos';
import { capturePreImage, configureWriteJournal, listJournalEntries, restoreJournalEntry } from './journal';
import { installApplicationMenu } from './menu';
import { copyTemplate, hasNotes, listTemplates, templatesRoot } from './templates';
import { configureUpdater } from './updater';
import { createDiagnosticLogger, errorDetails } from './diagnostic-logger';
import { configureCrashReporter } from './crash-reporter';
import { installDirectory, isInsideInstall, workspacePathFromArgv } from './workspace-argv';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileKind, looksLikeText, needsSniff, SNIFF_BYTES } from './file-kinds';
import { authorizeFileUrl, FILE_HEADERS, FILE_SCHEME, parseRange } from './file-protocol';
import { watchWorkspace } from './workspace-watcher';
import { ENTRY_LIMIT, walkWorkspace, type WorkspaceEntries } from './workspace-walk';
import { exec } from 'child_process';
import * as pty from 'node-pty';


const RENDERER_ROOT = pathToFileURL(path.join(__dirname, '../renderer') + path.sep).href;
/**
 * Unpackaged build: the renderer comes from the dev server. The one switch for
 * loading DEV_URL and for letting the app frame navigate to it, so a packaged
 * app never trusts that port, whatever NODE_ENV says.
 */
const IS_DEV = !app.isPackaged;
/**
 * Every window, and the workspace it owns.
 *
 * There is no global "active workspace". A request is served against the
 * workspace of the window that sent it, so one window can never read or write
 * another's files, and opening a second workspace cannot disturb the first.
 */
interface AppWindow {
  window: BrowserWindow;
  kind: WindowKind;
  repo: string | null;
  watcher: { close(): void } | null;
  /** Random, per window: proves a neuron-file:// request came from this window. */
  fileToken: string;
}
const appWindows = new Map<number, AppWindow>();

// Before `ready`, as Electron requires. Streamed so <video> can seek; no fetch
// and no CORS, so page script cannot read these files through it.
protocol.registerSchemesAsPrivileged([{
  scheme: FILE_SCHEME,
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false, corsEnabled: false },
}]);
/** The workspace window used last, for things with no sender (a second launch). */
let lastWorkspaceId: number | null = null;
/** The workspace of the window that last opened Settings, which its Workspaces section marks. */
let settingsOpener: string | null = null;
type Sender = Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender' | 'senderFrame'>;
const entryOf = (event: Sender): AppWindow | null => {
  const entry = appWindows.get(event.sender.id);
  if (!entry || entry.window.isDestroyed()) return null;
  const contents = entry.window.webContents;
  return event.sender === contents && event.senderFrame != null && event.senderFrame === contents.mainFrame ? entry : null;
};
const windowOf = (event: Sender): BrowserWindow | null => {
  const window = entryOf(event)?.window;
  return window && !window.isDestroyed() ? window : null;
};
/** The workspace of the window that sent this request. A sender that is not one of our windows has none. */
const repoOf = (event: Sender): string | null => entryOf(event)?.repo ?? null;
function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
const diagnostics = createDiagnosticLogger(app.getPath('logs'));
let handlingFatalError = false;

// Before anything else, including the handlers below.
//
// Those catch what JavaScript can catch. They cannot catch a crash beneath it:
// a Chromium CHECK() failure calls __debugbreak(), which terminates the process
// with EXCEPTION_BREAKPOINT before any handler runs -- Windows shows its own
// "a breakpoint has been reached" dialog and the log file stays empty. Crashpad
// records those because it runs out-of-process and outlives the crash.
//
// Started here rather than in `ready` because a crash during startup is the one
// most worth having, and Crashpad only sees what happens after it starts.
// Nothing is uploaded; see ./crash-reporter.
const crashDumps = configureCrashReporter(app, crashReporter, app.getPath('logs'));

process.on('uncaughtException', async (error) => {
  if (handlingFatalError) return;
  handlingFatalError = true;
  const details = errorDetails(error);
  await diagnostics.write({ level: 'error', category: 'main.uncaught-exception', ...details });
  // Main-process state is unknown after an uncaught exception. Continuing could
  // corrupt an open workspace, so record it first, explain where the log is,
  // then terminate instead of silently swallowing the failure.
  dialog.showErrorBox(
    'Neuron encountered a fatal error',
    `Neuron must close to protect your workspace. Diagnostic details were saved locally in:\n\n${diagnostics.filePath}`,
  );
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const details = errorDetails(reason);
  void diagnostics.write({ level: 'error', category: 'main.unhandled-rejection', ...details });
});

app.on('render-process-gone', (_event, contents, details) => {
  void diagnostics.write({
    level: 'error',
    category: 'renderer.gone',
    message: `reason=${details.reason}; exitCode=${details.exitCode}; url=${contents.getURL()}`,
  });
});

app.on('child-process-gone', (_event, details) => {
  void diagnostics.write({
    level: 'error',
    category: 'child-process.gone',
    message: `type=${details.type}; reason=${details.reason}; exitCode=${details.exitCode}; name=${details.name ?? 'unknown'}`,
  });
});

// Workspace files: Markdown notes, HTMX views (+ their manifests), databases,
// canvases, Mermaid diagrams, CSV tables, the internal shell
// config, and .neuron configuration/assets (CSV table metadata is .neuron/tables/**.json).
const WORKSPACE_FILE = /(^\.neuron[\/\\].+\.(json|html|css)$|^neuron\.config$|\.neuron\.json$|\.(md|mdx|html|db|canvas|mmd|mermaid|csv)$)/;

// ==========================================================================
// Settings store — JSON file in userData. Holds the active/recent
// repositories and per-plugin config (including API keys). Never bundled.
// ==========================================================================

interface Settings {
  repositories: { current: string | null; recent: string[]; names?: Record<string, string> };
  seededDemo?: boolean;
  [key: string]: unknown;
}

const settingsFile = () => {
  const newPath = path.join(app.getPath('userData'), 'neuron-settings.json');
  const oldPath = path.join(app.getPath('userData'), 'autonote-settings.json');
  if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
    try {
      fs.copyFileSync(oldPath, newPath);
    } catch (e) {
      console.error('Failed to migrate settings file:', e);
    }
  }
  return newPath;
};

function readSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf-8').trim();
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { repositories: { current: null, recent: [] }, ...parsed } as Settings;
    }
  } catch {
    /* first run or unreadable — fall through to defaults */
  }
  return { repositories: { current: null, recent: [] } };
}

function writeSettings(settings: Settings): void {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist settings:', err);
  }
}

// ==========================================================================
// Repository management — the active note root is user-chosen and
// can live anywhere, including a cloud-synced folder.
// ==========================================================================


const INSTALL_FOLDER_MESSAGE = 'That folder is where Neuron is installed. Updates replace it, so choose another folder for your notes.';

function isInstallWorkspace(dir: string): boolean {
  return app.isPackaged && isInsideInstall(dir, installDirectory(app.getPath('exe')));
}

async function refuseInstallWorkspace(dir: string, parent: BrowserWindow | null): Promise<boolean> {
  if (!isInstallWorkspace(dir)) return false;
  const options = { type: 'warning' as const, message: INSTALL_FOLDER_MESSAGE };
  if (parent) await dialog.showMessageBox(parent, options);
  else await dialog.showMessageBox(options);
  return true;
}

/** A folder that can be a workspace right now, or null. */
function usableRepo(dir: string | null | undefined): string | null {
  return dir && !isInstallWorkspace(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
}

/** The workspace to reopen on launch: the one used last. */
function savedRepo(): string | null {
  return usableRepo(readSettings().repositories.current);
}

const CLOUD_HINTS = ['onedrive', 'dropbox', 'google drive', 'icloud', 'box sync'];

function demoRepoPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'examples', 'demo-repo')
    : path.join(process.cwd(), 'examples', 'demo-repo');
}

function repoInfo(dir: string) {
  const lower = dir.toLowerCase();
  const names = readSettings().repositories.names ?? {};
  // In development the demo is in the list, and a workspace copied from it is
  // usually a folder called demo-repo too: two rows reading "demo-repo".
  const base = folderKey(dir) === folderKey(demoRepoPath()) ? 'Demo workspace' : path.basename(dir) || dir;
  return {
    path: dir,
    name: names[dir] || base,
    cloud: CLOUD_HINTS.some((hint) => lower.includes(hint)),
  };
}

/** Repair saved workspace paths and keep the development demo discoverable. */
function ensureDefaultRepo(): void {
  const settings = readSettings();
  const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();
  const demo = demoRepoPath();
  const demoExists = isDir(demo);

  // Prune repositories whose folders no longer exist (e.g. renamed/removed),
  // and collapse entries that are the same folder spelled differently.
  settings.repositories.recent = uniqueRecents(settings.repositories.recent.filter((p) => !isInstallWorkspace(p) && isDir(p)), null);

  if (settings.repositories.current && isInstallWorkspace(settings.repositories.current)) {
    settings.repositories.current = null;
  }

  // Only the checkout's demo is a writable workspace; packaged templates are copied.
  if (!app.isPackaged && demoExists && !settings.repositories.recent.some((p) => folderKey(p) === folderKey(demo))) {
    settings.repositories.recent = [...settings.repositories.recent, demo];
  }

  // A first run no longer silently adopts the bundled demo. It used to, which
  // meant the app opened writing into its own installation directory -- inside
  // Program Files for a packaged build, and inside the git checkout for a
  // developer, where every edit showed up as a change to the repository. The
  // workspace is the user's, so they choose where it lives; leaving `current`
  // unset is what makes the chooser appear.
  if (!settings.seededDemo) settings.seededDemo = true;

  writeSettings(settings);
}

/** Record a workspace as the one to reopen, and at the top of Recent. */
function rememberRepo(dir: string): void {
  const settings = readSettings();
  settings.repositories.current = dir;
  settings.repositories.recent = [dir, ...uniqueRecents(settings.repositories.recent, dir)].slice(0, 8);
  writeSettings(settings);
}

/** Point one window at a workspace (or at none). */
function bindRepo(entry: AppWindow, dir: string | null): void {
  revokeAllViewSessions(); // HTMX view tokens are workspace-bound
  // A shell's working directory is fixed when it starts, so this window's
  // shells belong to the workspace it is leaving. Ending them lets the panel
  // start new ones rooted in the workspace it now shows.
  disposeWindowPtys(entry.window.webContents.id);
  entry.repo = dir;
  setupWatcher(entry);
  if (!entry.window.isDestroyed()) entry.window.webContents.send('repository:changed', dir ? repoInfo(dir) : null);
}

/**
 * Open a workspace without disturbing one that is already open.
 *
 * Already on screen: that window comes forward. Asked for by an empty first-run
 * window: it takes the folder. Otherwise the folder gets a window of its own.
 */
function openWorkspace(dir: string, from: AppWindow | null): boolean {
  if (!usableRepo(dir)) return false;
  rememberRepo(dir);
  const decision = decideOpen(
    dir,
    [...appWindows.entries()].map(([id, entry]) => ({ id, kind: entry.kind, repo: entry.repo })),
    from ? from.window.webContents.id : null,
    folderKey,
  );
  if (decision.action === 'new') { createWindow('workspace', dir); return true; }
  const target = appWindows.get(decision.id);
  if (!target) return false;
  if (decision.action === 'adopt') bindRepo(target, dir);
  focusWindow(target.window);
  return true;
}

function seedWelcomeNote(dir: string): void {
  try {
    const entries = fs.readdirSync(dir).filter((f) => /\.(md|mdx)$/.test(f));
    if (entries.length > 0) return; // don't overwrite an existing workspace
    const welcome = `# Welcome to ${path.basename(dir)}\n\nThis is your Neuron workspace — just a folder of local \`.md\`/\`.mdx\` files.\n\nLink notes with [[Another note]] and group them into sections (folders).\n`;
    fs.writeFileSync(path.join(dir, 'welcome.mdx'), welcome, 'utf-8');
  } catch (err) {
    console.error('Failed to seed welcome note:', err);
  }
}

// ==========================================================================
// File watcher — re-initializes against the active repository.
// ==========================================================================

function setupWatcher(entry: AppWindow) {
  if (entry.watcher) {
    entry.watcher.close();
    entry.watcher = null;
  }
  const dir = entry.repo;
  if (!dir) return;

  entry.watcher = watchWorkspace(dir, (event, relativePath) => {
    if (entry.window.isDestroyed()) return;
    if (WORKSPACE_FILE.test(relativePath) || event === 'unlink') {
      entry.window.webContents.send('notes:changed', event, relativePath);
    }
    // The renderer asks for the full listing again. Not for edits to notes, or
    // every save while typing would re-walk the folder. Other files count even
    // on 'change': the native watcher can report a new file as one.
    if (event !== 'change' || !WORKSPACE_FILE.test(relativePath)) entry.window.webContents.send('workspace:changed');
  });
}

// ==========================================================================
// Window
// ==========================================================================

function createWindow(kind: WindowKind = 'workspace', repo: string | null = savedRepo(), section?: SettingsSection): AppWindow {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(process.cwd(), 'build', 'icon.png');
  // Set only by e2e/fixtures.ts: a test run opens a hundred windows, and each one
  // used to land on top of whatever the developer was doing and take the
  // keyboard. In this mode the window is placed off-screen and shown without
  // focus. It must still render and run timers at full speed while nobody can
  // see it, or tests that wait on a frame would stall.
  const testInBackground = !app.isPackaged && process.env.NEURON_E2E_BACKGROUND === '1';

  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    ...(testInBackground ? { x: -32000, y: -32000, show: false } : {}),
    minWidth: 720,
    minHeight: 560,
    title: 'Neuron',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    // Windows and Linux: the OS draws the frame and the window buttons
    // (Window Controls Overlay) beside Neuron's 40px toolbar. A frameless window
    // overhung the screen when maximised and needed a padding hack, which then
    // left a strip across the top in full screen. 39px leaves the toolbar's
    // bottom border visible under the buttons. macOS keeps its traffic lights.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 13 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { height: 39, color: '#f3f4f6', symbolColor: '#171a1f' } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // enables in-app browser tabs (<webview>)
      ...(testInBackground ? { backgroundThrottling: false } : {}),
    },
    backgroundColor: '#f3f4f6',
  });
  if (testInBackground) window.once('ready-to-show', () => { if (!window.isDestroyed()) window.showInactive(); });
  // Settings is a smaller window with no workspace of its own.
  if (kind !== 'workspace') { window.setMinimumSize(760, 520); window.setSize(1000, 720); }
  const entry: AppWindow = { window, kind, repo: kind === 'workspace' ? usableRepo(repo) : null, watcher: null, fileToken: randomBytes(32).toString('hex') };
  const id = window.webContents.id;
  appWindows.set(id, entry);
  if (kind === 'workspace') lastWorkspaceId = id;

  // Windows and Linux hide Electron's default menu bar entirely; the in-app
  // title bar is the menu there. On macOS the menu bar is not part of the
  // window at all, so hiding it would be meaningless and the real application
  // menu is installed instead.
  if (process.platform !== 'darwin') window.setMenuBarVisibility(false);
  installApplicationMenu(() => BrowserWindow.getFocusedWindow());

  const query: Record<string, string> | null = kind === 'workspace' ? null : { window: kind, ...(section ? { section } : {}) };
  if (IS_DEV) {
    void window.loadURL(query ? DEV_URL + (DEV_URL.includes('?') ? '&' : '?') + new URLSearchParams(query).toString() : DEV_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), query ? { query } : undefined);
  }

  // Full screen hides the toolbar; editors also use these events to remeasure.
  // The event says which way it went. On Windows isFullScreen() still reports
  // the old state while enter-full-screen fires, so asking would hide nothing.
  const emitChromeState = (fullScreen: boolean) => {
    if (!window.isDestroyed()) window.webContents.send('window:chrome-state-changed', { fullScreen });
  };
  window.on('enter-full-screen', () => emitChromeState(true));
  window.on('leave-full-screen', () => emitChromeState(false));
  // The workspace used last is the one the next launch reopens.
  window.on('focus', () => {
    if (entry.kind !== 'workspace') return;
    lastWorkspaceId = id;
    if (entry.repo && readSettings().repositories.current !== entry.repo) {
      const settings = readSettings();
      settings.repositories.current = entry.repo;
      writeSettings(settings);
    }
  });

  window.on('closed', () => {
    disposeWindowPtys(id);
    entry.watcher?.close();
    entry.watcher = null;
    appWindows.delete(id);
    if (lastWorkspaceId === id) lastWorkspaceId = null;
    if (kind === 'settings') settingsOpener = null;
  });
  // ...and again on the way out, because 'closed' is not on every exit path.
  // A shell that outlives the app is not a test problem: it is a process the
  // user never sees and cannot stop.
  app.once('before-quit', killAllPtys);

  setupWatcher(entry);
  return entry;
}

// ==========================================================================
// IPC — window controls
// ==========================================================================

/** What the renderer needs to know to draw its chrome correctly. */
function chromeState(window: BrowserWindow) {
  return { fullScreen: window.isFullScreen() };
}

ipcMain.handle('window:chrome-state', (event) => {
  const window = windowOf(event);
  return window ? chromeState(window) : { fullScreen: false };
});
// Windows and Linux have no application menu, so its togglefullscreen role does
// not exist there; F11 and the palette reach full screen through this.
ipcMain.handle('window:toggle-fullscreen', (event) => {
  const window = windowOf(event);
  window?.setFullScreen(!window.isFullScreen());
});
// Settings, Plugins and Workspaces are about the app, not one workspace, so
// they are sections of one Settings window, brought forward if already open.
ipcMain.handle('window:open-page', (event, asked: unknown) => {
  const from = entryOf(event);
  const section = settingsSectionOf(asked);
  if (!from || !section) return { success: false };
  // Asked from Settings itself, the workspace it describes stays the same.
  if (from.kind === 'workspace') settingsOpener = from.repo;
  const open = [...appWindows.values()].find((entry) => entry.kind === 'settings');
  if (open && !open.window.isDestroyed()) open.window.webContents.send('settings:show-section', section);
  focusWindow((open ?? createWindow('settings', null, section)).window);
  return { success: true };
});
// Only the opener's name and folder cross over, and only while a window still
// has it open: Settings gets no file access to it.
ipcMain.handle('window:opener-workspace', (event) => {
  if (entryOf(event)?.kind !== 'settings' || !settingsOpener) return null;
  const opener = settingsOpener;
  const open = [...appWindows.values()].some((entry) => entry.kind === 'workspace' && entry.repo === opener);
  return open ? repoInfo(opener) : null;
});
ipcMain.handle('window:set-overlay-colors', (event, colors: { color?: unknown; symbolColor?: unknown } | null) => {
  const window = windowOf(event);
  if ((process.platform !== 'win32' && process.platform !== 'linux') || !window) return;
  if (typeof colors?.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(colors.color)
    || typeof colors?.symbolColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(colors.symbolColor)) return;
  window.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor });
});

// ==========================================================================
// IPC — settings (generic key/value; used for plugin config + state)
// ==========================================================================

// Secrets live under this one key and are readable ONLY by the main process.
// Everything else in the settings file is renderer-readable through
// settings:get, which is exactly how API keys leaked: plugin config -- apiKey
// included -- was loaded into renderer state and then handed back to main on
// every ai:complete call. Any renderer code could read every plugin's key, and
// plugins are not sandboxed (risk R3), so one plugin could read another's.
const SECRETS_KEY = '__secrets';

function readSecret(scope: string, field: string): string | null {
  const store = readSettings()[SECRETS_KEY];
  if (!store || typeof store !== 'object') return null;
  const scoped = (store as Record<string, unknown>)[scope];
  if (!scoped || typeof scoped !== 'object') return null;
  const value = (scoped as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

ipcMain.handle('settings:get', (_event, key: string) => {
  if (!entryOf(_event)) return null;
  // The renderer may never read the secret namespace, by any key that resolves
  // to it. Without this the store would be one settings.get('__secrets') away
  // from being exactly as exposed as before.
  if (key === SECRETS_KEY) return null;
  const settings = readSettings();
  if (key in settings) {
    const value = settings[key];
    return key === SECRETS_KEY ? null : value;
  }
  return null;
});
ipcMain.handle('settings:set', (event, key: string, value: unknown) => {
  if (!entryOf(event)) return { success: false, error: 'Not available here.' };
  if (key === SECRETS_KEY) return { success: false, error: 'Reserved key.' };
  const settings = readSettings();
  settings[key] = value;
  writeSettings(settings);
  // Settings are shared by every window; the others reload what changed. Only
  // the key is sent, never the value.
  for (const [id, entry] of appWindows) {
    if (id !== event.sender.id && !entry.window.isDestroyed()) entry.window.webContents.send('settings:changed', key);
  }
  return { success: true };
});

// Write-only from the renderer's side: it can set a secret and ask whether one
// exists, and it can never read the value back.
ipcMain.handle('settings:set-secret', (_event, scope: string, field: string, value: string) => {
  if (!entryOf(_event)) return { success: false, error: 'Not available here.' };
  if (typeof scope !== 'string' || typeof field !== 'string' || !scope || !field) {
    return { success: false, error: 'Invalid secret reference.' };
  }
  const settings = readSettings();
  const store = (settings[SECRETS_KEY] && typeof settings[SECRETS_KEY] === 'object'
    ? settings[SECRETS_KEY]
    : {}) as Record<string, Record<string, string>>;
  const scoped = { ...(store[scope] ?? {}) };
  if (typeof value === 'string' && value.length > 0) scoped[field] = value;
  else delete scoped[field];
  settings[SECRETS_KEY] = { ...store, [scope]: scoped };
  writeSettings(settings);
  return { success: true };
});

ipcMain.handle('settings:has-secret', (_event, scope: string, field: string) => !!entryOf(_event) && readSecret(scope, field) !== null);

// ==========================================================================
// IPC — repository
// ==========================================================================

ipcMain.handle('repository:get-current', (event) => {
  const dir = repoOf(event);
  return dir ? repoInfo(dir) : null;
});

// The open workspace is not "recent": the switcher already shows it on its
// button, and listing it again underneath was the name appearing twice.
ipcMain.handle('repository:list-recent', (event) => {
  if (!entryOf(event)) return [];
  const recent = readSettings().repositories.recent;
  return uniqueRecents(recent.filter((p) => !isInstallWorkspace(p) && fs.existsSync(p)), repoOf(event)).map(repoInfo);
});

ipcMain.handle('repository:create', async (event) => {
  const parent = windowOf(event);
  if (!parent) return null;
  const result = await dialog.showOpenDialog(parent, {
    title: 'Create or choose a workspace folder',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  if (await refuseInstallWorkspace(dir, parent)) return null;
  seedWelcomeNote(dir);
  if (!openWorkspace(dir, entryOf(event))) return null;
  return repoInfo(dir);
});

ipcMain.handle('templates:list', (event) =>
  entryOf(event) ? listTemplates(templatesRoot(app.isPackaged, process.resourcesPath)) : []);

/**
 * Copy a template into a folder the user picks, then open it.
 *
 * The copy is the point: the bundled template stays pristine and read-only
 * inside the installation, and the user gets their own writable notes wherever
 * they keep their files. Opening the bundled folder directly is what put the
 * app's own installation directory on the writing end of every edit.
 */
ipcMain.handle('templates:create', async (event, templateId: string) => {
  const parent = windowOf(event);
  if (!parent) return null;

  const templates = listTemplates(templatesRoot(app.isPackaged, process.resourcesPath));
  const template = templates.find((t) => t.id === templateId);
  if (!template) return { error: `No template called "${templateId}".` };

  const result = await dialog.showOpenDialog(parent, {
    title: `Where should the ${template.name} workspace go?`,
    buttonLabel: 'Create here',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const dir = result.filePaths[0];
  if (await refuseInstallWorkspace(dir, parent)) return null;
  // Refuse rather than merge. Copying a template over someone's existing notes
  // is not something they can undo from in here.
  if (hasNotes(dir)) {
    return { error: 'That folder already contains notes. Choose an empty folder, or open it directly instead.' };
  }

  try {
    copyTemplate(template.source, dir);
  } catch (err) {
    return { error: `Could not create the workspace: ${(err as Error).message}` };
  }

  if (!openWorkspace(dir, entryOf(event))) return null;
  return { repository: repoInfo(dir) };
});

ipcMain.handle('repository:open', async (event) => {
  const parent = windowOf(event);
  if (!parent) return null;
  const result = await dialog.showOpenDialog(parent, {
    title: 'Open a workspace folder',
    buttonLabel: 'Open workspace',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  if (await refuseInstallWorkspace(dir, parent)) return null;
  if (!openWorkspace(dir, entryOf(event))) return null;
  return repoInfo(dir);
});

ipcMain.handle('repository:switch', (event, dir: string) => {
  if (typeof dir !== 'string' || !entryOf(event)) return { success: false, error: 'Folder no longer exists.' };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { success: false, error: 'Folder no longer exists.' };
  }
  if (!openWorkspace(dir, entryOf(event))) return { success: false, error: INSTALL_FOLDER_MESSAGE };
  return { success: true, repository: repoInfo(dir) };
});

ipcMain.handle('repository:set-name', (_event, dir: string, name: string) => {
  if (!entryOf(_event)) return { success: false, error: 'Not available here.' };
  const settings = readSettings();
  const names = { ...(settings.repositories.names ?? {}) };
  const trimmed = name.trim();
  if (trimmed) names[dir] = trimmed;
  else delete names[dir];
  settings.repositories.names = names;
  writeSettings(settings);
  for (const entry of appWindows.values()) {
    if (entry.repo === dir && !entry.window.isDestroyed()) entry.window.webContents.send('repository:changed', repoInfo(dir));
  }
  return { success: true, repository: repoInfo(dir) };
});

ipcMain.handle('repository:remove', (event, dir: string) => {
  if (!entryOf(event)) return { success: false, error: 'Not available here.' };
  const settings = readSettings();
  const key = folderKey(dir);
  settings.repositories.recent = settings.repositories.recent.filter((p) => folderKey(p) !== key);
  for (const named of Object.keys(settings.repositories.names ?? {})) {
    if (folderKey(named) === key) delete settings.repositories.names![named];
  }
  if (settings.repositories.current && folderKey(settings.repositories.current) === key) settings.repositories.current = null;
  writeSettings(settings);
  const entry = entryOf(event);
  const wasActive = !!entry?.repo && folderKey(entry.repo) === key;
  for (const workspace of appWindows.values()) {
    if (workspace.kind === 'workspace' && workspace.repo && folderKey(workspace.repo) === key) bindRepo(workspace, null);
  }
  return { success: true, clearedActive: wasActive };
});

ipcMain.handle('repository:reveal', (_event, dir: string) => {
  if (!entryOf(_event)) return { success: false };
  shell.showItemInFolder(dir);
  return { success: true };
});

// ==========================================================================
// IPC — notes (operate against the active repository, with traversal guard)
// ==========================================================================

function resolveInRepo(event: Sender, relativePath: string): { repo: string; fullPath: string } | null {
  const repo = repoOf(event);
  if (!repo) return null;
  const fullPath = resolveInside(repo, relativePath);
  if (!fullPath || !realpathInside(repo, fullPath)) return null;
  return { repo, fullPath };
}

// `.neuron` is walked although other dot-folders are not: `.neuron/layout.json`
// is the one file in there a person would want to edit by hand, and the watcher
// already reports it.
function walkRepoFiles(repo: string): string[] {
  return walkWorkspace(repo).files;
}

ipcMain.handle('notes:list', async (_event) => {
  const repo = repoOf(_event);
  if (!repo) return [];
  try {
    return walkRepoFiles(repo).filter((file) => WORKSPACE_FILE.test(file));
  } catch (err) {
    console.error('Failed to list notes:', err);
  }
  return [];
});

// Everything in the workspace, for the file tree and the explorer. Separate
// from notes:list because the renderer reads every listed note into memory.
ipcMain.handle('workspace:entries', async (event): Promise<WorkspaceEntries> => {
  const repo = repoOf(event);
  if (!repo) return { files: [], folders: [], info: {}, skipped: 0, truncated: false, text: [] };
  const listing = walkWorkspace(repo, { limit: ENTRY_LIMIT });
  // A name the kind table does not know opens as text only if it starts as
  // text. Bounded: past the cap such files simply stay other files.
  const unknown = listing.files.filter((file) => fileKind(file) === 'other' && needsSniff(file)).slice(0, SNIFF_FILE_LIMIT);
  const text: string[] = [];
  for (let i = 0; i < unknown.length; i += 32) {
    const batch = unknown.slice(i, i + 32);
    const results = await Promise.all(batch.map((file) => startsAsText(path.join(repo, file))));
    batch.forEach((file, index) => { if (results[index]) text.push(file); });
  }
  return { ...listing, text };
});

const SNIFF_FILE_LIMIT = 2000;
/** Text files over this open read-only, showing only this much. */
const TEXT_READ_LIMIT = 5 * 1024 * 1024;

/** Whether a file's first SNIFF_BYTES are UTF-8 text with no NUL byte. */
async function startsAsText(fullPath: string): Promise<boolean> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    const sample = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(sample, 0, SNIFF_BYTES, 0);
    return looksLikeText(sample.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * What notes:read and notes:write may touch, by kind. Programs and scripts,
 * known binaries and media never go through them: media is served by
 * neuron-file:// and the rest is never opened. A name the kind table does not
 * know is allowed only while its content is text.
 */
const READ_WRITE_REFUSED = new Set(['blocked', 'image', 'video', 'audio']);
function textGuard(relativePath: string): 'refuse' | 'text' | 'unknown' | 'free' {
  const kind = fileKind(relativePath);
  if (READ_WRITE_REFUSED.has(kind)) return 'refuse';
  if (kind === 'other') return needsSniff(relativePath) ? 'unknown' : 'refuse';
  return kind === 'text' ? 'text' : 'free';
}

// The base of this window's neuron-file:// URLs, for its preload. Only the
// main frame of a workspace window gets it.
ipcMain.on('workspace:file-base', (event) => {
  const entry = entryOf(event);
  event.returnValue = entry && entry.kind === 'workspace'
    ? `${FILE_SCHEME}://w/${event.sender.id}/${entry.fileToken}/`
    : null;
});

// Shows a workspace file in the system file manager. Never opens it: the
// workspace may be someone else's and hold programs.
ipcMain.handle('workspace:reveal', (event, relativePath: string) => {
  const resolved = resolveInRepo(event, relativePath);
  if (!resolved || !fs.existsSync(resolved.fullPath)) return { success: false };
  shell.showItemInFolder(resolved.fullPath);
  return { success: true };
});

ipcMain.handle('notes:read', async (_event, relativePath: string) => {
  const resolved = resolveInRepo(_event, relativePath);
  if (!resolved) return 'Error: No workspace is open.';
  const guard = textGuard(relativePath);
  if (guard === 'refuse') return 'Error: Neuron does not open this kind of file as text.';
  try {
    if (guard === 'text' || guard === 'unknown') {
      // At most TEXT_READ_LIMIT; the renderer opens a larger file read-only.
      const handle = await fs.promises.open(resolved.fullPath, 'r');
      try {
        const size = (await handle.stat()).size;
        const buffer = Buffer.alloc(Math.min(size, TEXT_READ_LIMIT));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const bytes = buffer.subarray(0, bytesRead);
        if (guard === 'unknown' && !looksLikeText(bytes.subarray(0, SNIFF_BYTES))) return 'Error: This file is not text.';
        return bytes.toString('utf-8');
      } finally {
        await handle.close();
      }
    }
    // Async: opening a workspace reads every note at once, and synchronous
    // reads hold the main thread -- which in Electron is also the browser's UI
    // thread -- for the whole batch. Opening 5,000 freshly written notes on
    // Windows: explorer after 33 s with sync reads, 7-8 s with these.
    return await fs.promises.readFile(resolved.fullPath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Missing files are an expected probe result (e.g. optional .neuron/layout.json);
    // only unexpected failures deserve a stack trace in the logs.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Failed to read note ${relativePath}:`, err);
    return `Error: Could not read note. ${message}`;
  }
});

ipcMain.handle('notes:write', async (_event, relativePath: string, content: string) => {
  const resolved = resolveInRepo(_event, relativePath);
  if (!resolved) return { success: false, error: 'No workspace is open.' };
  const guard = textGuard(relativePath);
  if (guard === 'refuse') return { success: false, error: 'Neuron does not write this kind of file.' };
  const tmp = `${resolved.fullPath}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    if (guard === 'text' || guard === 'unknown') {
      // Never write back a file that was opened truncated, or one that is not text.
      const size = await fs.promises.stat(resolved.fullPath).then((stat) => stat.size, () => -1);
      if (size > TEXT_READ_LIMIT) return { success: false, error: 'This file is too large to edit in Neuron.' };
      if (guard === 'unknown' && size >= 0 && !(await startsAsText(resolved.fullPath))) return { success: false, error: 'This file is not text.' };
    }
    const dir = path.dirname(resolved.fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    capturePreImage(resolved.repo, resolved.fullPath, 'overwrite');
    // Atomic write: a crash mid-write must never leave a half-written note or database.
    fs.writeFileSync(tmp, content, 'utf-8');
    // On Windows a rename over a file another process holds open (the file
    // watcher, an indexer, antivirus) fails with EPERM/EBUSY/EACCES for a few
    // milliseconds. Retry briefly instead of dropping the user's edit.
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, resolved.fullPath); break; }
      catch (renameError) {
        const code = (renameError as NodeJS.ErrnoException).code;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) {
          throw renameError;
        }
        if (attempt >= 5) {
          // Still held open: write in place rather than lose the edit.
          fs.writeFileSync(resolved.fullPath, content, 'utf-8');
          break;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
      }
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to write note ${relativePath}:`, err);
    return { success: false, error: message };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* renamed or already gone */ }
  }
});

ipcMain.handle('notes:delete', async (_event, relativePath: string) => {
  const resolved = resolveInRepo(_event, relativePath);
  if (!resolved) return { success: false, error: 'No workspace is open.' };
  try {
    if (fs.existsSync(resolved.fullPath)) {
      capturePreImage(resolved.repo, resolved.fullPath, 'delete');
      fs.unlinkSync(resolved.fullPath);
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to delete note ${relativePath}:`, err);
    return { success: false, error: message };
  }
});

// Version history. Reads the write journal captured on every overwrite/delete.
// Main-process only and deliberately not reachable from a view: the journal holds
// pre-images from across the whole workspace, so exposing it to a capability-scoped
// view would hand it file contents outside its path policy (DECISIONS.md D20).
ipcMain.handle('journal:list', (_event, relativePath?: string) => {
  const repo = repoOf(_event);
  if (!repo) return [];
  const entries = listJournalEntries(repo);
  return relativePath ? entries.filter((e) => e.relativePath === relativePath) : entries;
});

ipcMain.handle('journal:restore', (_event, entryId: string) => {
  const repo = repoOf(_event);
  if (!repo) return { success: false, error: 'No workspace is open.' };
  const result = restoreJournalEntry(repo, entryId);
  return result.success ? { success: true } : { success: false, error: result.error };
});

ipcMain.handle('notes:create-section', async (_event, relativePath: string) => {
  const resolved = resolveInRepo(_event, relativePath);
  if (!resolved) return { success: false, error: 'No workspace is open.' };
  try {
    fs.mkdirSync(resolved.fullPath, { recursive: true });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create section ${relativePath}:`, err);
    return { success: false, error: message };
  }
});

ipcMain.handle('notes:get-dir', (event) => repoOf(event));

// ==========================================================================
// IPC — surface file helpers
// ==========================================================================

// Read a workspace image for .canvas file nodes as a data URL.
// ponytail: whole-file base64 over IPC — fine for note-sized images; switch to a custom protocol if galleries get huge.
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' };
ipcMain.handle('views:file', (_event, relativePath: string) => {
  const resolved = resolveInRepo(_event, relativePath);
  if (!resolved) return { success: false, error: 'No workspace is open.' };
  try {
    if (!fs.existsSync(resolved.fullPath)) return { success: false, error: `File not found: ${relativePath}` };
    const mime = IMAGE_MIME[path.extname(resolved.fullPath).slice(1).toLowerCase()];
    if (!mime) return { success: false, error: `Not an image: ${relativePath}` };
    return { success: true, dataUrl: `data:${mime};base64,${fs.readFileSync(resolved.fullPath).toString('base64')}` };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

/**
 * neuron-file:// -- workspace images, video and audio for the window that owns
 * the token in the URL (see ./file-protocol). 404 for a missing file, 403 for
 * anything refused, 206 for a range.
 */
async function serveWorkspaceFile(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 403 });
  const decision = authorizeFileUrl(request.url, (id) => {
    const entry = appWindows.get(id);
    return entry && !entry.window.isDestroyed() ? { token: entry.fileToken, repo: entry.repo } : null;
  });
  if (!decision.ok) return new Response(null, { status: 403 });
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(decision.fullPath); } catch { return new Response(null, { status: 404 }); }
  if (!stat.isFile()) return new Response(null, { status: 403 });
  const headers: Record<string, string> = { ...FILE_HEADERS, 'Content-Type': decision.mime, 'Accept-Ranges': 'bytes' };
  const range = parseRange(request.headers.get('range'), stat.size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
  const start = range ? range.start : 0;
  const end = range ? range.end : stat.size - 1;
  const length = Math.max(0, end - start + 1);
  headers['Content-Length'] = String(length);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  const body = request.method === 'HEAD' || length === 0
    ? null
    : Readable.toWeb(fs.createReadStream(decision.fullPath, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}

// Pull Chrome's cookies into the in-app browser's persistent session so the
// user stays logged in without signing in again.
ipcMain.handle('cookies:import-chrome', (_event, domain?: string) =>
  entryOf(_event) ? importChromeCookies(session.fromPartition('persist:neuron-browser'), domain)
    : { success: false, error: 'Not available here.' },
);

ipcMain.handle('terminal:run', async (_event, cmd: string) => {
  if (!entryOf(_event)) return { success: false, stdout: '', stderr: 'Not available here.', code: 1 };
  const dir = repoOf(_event) || process.cwd();
  return new Promise((resolve) => {
    exec(cmd, { cwd: dir }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        stdout: stdout || '',
        stderr: stderr || '',
        code: error?.code ?? 0,
      });
    });
  });
});

// ==========================================================================
// IPC — interactive PTY terminals (node-pty). One pty per window;
// output is streamed back over `terminal:data`. Used by the terminal panel.
// ==========================================================================

const ptys = new Map<number, pty.IPty>();
const ptyHistory = new Map<number, string>();
const TERMINAL_HISTORY_LIMIT = 200 * 1024;

/**
 * One shell per terminal, identified by a key the renderer chooses.
 *
 * This replaces a single shell per window. That model fixed a real bug -- a
 * panel that remounted used to abandon its shell, losing any command queued
 * against it -- but it went too far: every terminal on screen then shared one
 * shell, so a workspace whose layout declares a terminal AND the terminal panel
 * showed the same session twice, echoing each other keystroke for keystroke.
 *
 * A key separates the two questions. The same key means "this is the terminal I
 * had before", so a remount reattaches and keeps its scrollback. A different key
 * means a genuinely different terminal, with its own shell. Tabs are just more
 * keys.
 */
const ptyByKey = new Map<string, number>();
/** Which window started each pty. A window may only drive its own shells. */
const ptyOwner = new Map<number, number>();
const ownsPty = (event: Sender, id: number) => !!entryOf(event) && ptyOwner.get(id) === event.sender.id;
let nextPtyId = 1;

/** The first of these that exists on PATH, or null. */
function onPath(candidates: string[]): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    for (const dir of dirs) {
      try {
        const full = path.join(dir, candidate);
        if (fs.existsSync(full)) return full;
      } catch { /* unreadable PATH entry */ }
    }
  }
  return null;
}

/**
 * PowerShell on Windows, not cmd.
 *
 * Notes are written once and opened on whatever machine the workspace lands on,
 * so a `<Run />` button saying `ls` is the normal case rather than a mistake.
 * cmd.exe answers that with "'ls' is not recognized"; PowerShell ships `ls`,
 * `pwd`, `cat` and `rm` as aliases, so the same note works on all three
 * platforms without pretending Windows is Linux.
 *
 * pwsh is preferred because it is the maintained one. COMSPEC remains the last
 * resort for a machine with neither, which is not a machine PowerShell was ever
 * removed from -- it is one where PATH is unusual.
 */
const defaultShell = () => {
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/bash';
  return onPath(['pwsh.exe', 'powershell.exe']) ?? process.env.COMSPEC ?? 'cmd.exe';
};

/**
 * Sequences that mean "what came before this is gone".
 *
 *   ESC[2J  erase the screen        ESC[3J  erase the scrollback
 *   ESC c   full reset
 *
 * Kept out of the append below so the intent is readable rather than a regex
 * in a hot path.
 */
const CLEARS_SCREEN = /\x1b\[[23]J|\x1bc/g;

/**
 * Add pty output to the replayable history.
 *
 * The history exists so a panel that remounts does not show an empty pane; it
 * is replayed verbatim on attach. That made `cls` look broken: the shell
 * cleared the screen, but the erased output was still in this buffer and came
 * straight back on the next attach. Anything before the last clear is gone as
 * far as the user is concerned, so it goes here too.
 */
function appendHistory(history: string, data: string): string {
  let next = history + data;

  CLEARS_SCREEN.lastIndex = 0;
  let cut = -1;
  for (let m = CLEARS_SCREEN.exec(next); m; m = CLEARS_SCREEN.exec(next)) cut = m.index;
  if (cut >= 0) next = next.slice(cut);

  return next.length > TERMINAL_HISTORY_LIMIT ? next.slice(-TERMINAL_HISTORY_LIMIT) : next;
}

/**
 * End every shell, so the next attach starts one in the current workspace.
 *
 * All of them, not just the focused one: a shell cannot change the directory it
 * was started in, so after opening a different workspace every existing shell is
 * pointing at the old one.
 */
function disposeWindowPtys(ownerId: number): void {
  for (const [key, id] of [...ptyByKey]) {
    if (!ownsPtyKey(ownerId, key)) continue;
    try { ptys.get(id)?.kill(); } catch { /* already gone */ }
    ptys.delete(id);
    ptyHistory.delete(id);
    ptyOwner.delete(id);
    ptyByKey.delete(key);
  }
}

function killAllPtys() {
  for (const p of ptys.values()) {
    try { p.kill(); } catch { /* already gone */ }
  }
  ptys.clear();
  ptyHistory.clear();
  ptyByKey.clear();
  ptyOwner.clear();
}

ipcMain.handle('terminal:spawn', (_event, opts: { cols?: number; rows?: number; key?: string } = {}) => {
  if (!entryOf(_event)) throw new Error('terminals are only available to app windows');
  const owner = _event.sender;
  const key = ptyKey(owner.id, opts.key || 'default');
  const known = ptyByKey.get(key);
  if (known != null) {
    const existing = ptys.get(known);
    if (existing) {
      try {
        existing.resize(Math.max(1, opts.cols ?? 80), Math.max(1, opts.rows ?? 24));
        return known;
      } catch { /* pty closed; replace it below */ }
    }
    ptys.delete(known);
    ptyHistory.delete(known);
    ptyByKey.delete(key);
  }

  const id = nextPtyId++;
  // A shell that cannot start used to leave an empty black rectangle and no
  // explanation anywhere the user could see. Let the failure reach the caller
  // so the panel can print it.
  let proc: pty.IPty;
  try {
    proc = pty.spawn(defaultShell(), [], {
      name: 'xterm-color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: repoOf(_event) || process.cwd(),
      env: process.env as { [key: string]: string },
    });
  } catch (error) {
    throw new Error(`could not start ${defaultShell()}: ${(error as Error).message}`);
  }
  ptys.set(id, proc);
  ptyHistory.set(id, '');
  ptyByKey.set(key, id);
  ptyOwner.set(id, owner.id);
  proc.onData((data) => {
    ptyHistory.set(id, appendHistory(ptyHistory.get(id) ?? '', data));
    if (!owner.isDestroyed()) owner.send('terminal:data', id, data);
  });
  proc.onExit(({ exitCode }) => {
    ptys.delete(id);
    ptyHistory.delete(id);
    ptyOwner.delete(id);
    if (ptyByKey.get(key) === id) ptyByKey.delete(key);
    if (!owner.isDestroyed()) owner.send('terminal:exit', id, exitCode);
  });
  return id;
});

ipcMain.handle('terminal:history', (_event, id: number) => (ownsPty(_event, id) ? ptyHistory.get(id) ?? '' : ''));

ipcMain.handle('terminal:write', (_event, id: number, data: string) => {
  if (!ownsPty(_event, id)) return;
  try { ptys.get(id)?.write(data); } catch { /* pty closed */ }
});

ipcMain.handle('terminal:resize', (_event, id: number, cols: number, rows: number) => {
  if (!ownsPty(_event, id)) return;
  try { ptys.get(id)?.resize(Math.max(1, cols), Math.max(1, rows)); } catch { /* pty closed */ }
});
// ConPTY wraps long lines itself. xterm.js reflows them again on resize unless
// told it is attached to ConPTY -- which is what split a prompt path across two
// lines after narrowing the panel. node-pty uses ConPTY on every Windows build
// Electron 42 supports, so the build number is all the renderer needs.
ipcMain.handle('terminal:windows-pty', (event) => {
  if (!entryOf(event)) return null;
  if (process.platform !== 'win32') return null;
  const buildNumber = Number(os.release().split('.')[2]);
  return Number.isFinite(buildNumber) ? { backend: 'conpty' as const, buildNumber } : null;
});

ipcMain.handle('terminal:kill', (_event, id: number) => {
  const proc = ownsPty(_event, id) ? ptys.get(id) : undefined;
  if (proc) { try { proc.kill(); } catch { /* already gone */ } ptys.delete(id); }
});

// ==========================================================================
// IPC — privileged network + AI (routed through main to avoid CORS and to
// keep API keys out of the renderer bundle). Used by plugins.
// ==========================================================================

interface AiMessage { role: 'user' | 'assistant'; content: string }

/** Names for the messages below; the connector ids are the provider names. */
const CONNECTOR_NAMES: Record<string, string> = { anthropic: 'Claude', openai: 'OpenAI', google: 'Gemini', openrouter: 'OpenRouter', local: 'Local model' };

/** A connector's non-secret settings (endpoint, model), saved by Settings › Connectors. */
function connectorValues(id: string): Record<string, string> {
  const all = readSettings().connectors;
  const values = all && typeof all === 'object' ? (all as Record<string, unknown>)[id] : null;
  if (!values || typeof values !== 'object') return {};
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

// Connectors are global and their secrets are filed under the connector id.
// They used to be filed under each plugin's id; copy those across once, and
// leave the old entries where they are. Once only, or a Disconnect would be
// undone by the next launch.
const LEGACY_SECRET_SCOPES: Record<string, string> = { anthropic: 'ai-claude', openai: 'ai-openai', google: 'ai-gemini', openrouter: 'ai-openrouter', local: 'ai-local' };
function migrateConnectorSecrets(): void {
  const settings = readSettings();
  if (settings.connectorSecretsMigrated === true) return;
  const store = (settings[SECRETS_KEY] && typeof settings[SECRETS_KEY] === 'object' ? settings[SECRETS_KEY] : {}) as Record<string, Record<string, unknown>>;
  const next: Record<string, Record<string, unknown>> = { ...store };
  for (const [connector, legacy] of Object.entries(LEGACY_SECRET_SCOPES)) {
    const old = store[legacy];
    if (!old || typeof old !== 'object') continue;
    const scoped = { ...(next[connector] ?? {}) };
    for (const [field, value] of Object.entries(old)) {
      if (typeof value === 'string' && value && typeof scoped[field] !== 'string') scoped[field] = value;
    }
    next[connector] = scoped;
  }
  settings[SECRETS_KEY] = next;
  settings.connectorSecretsMigrated = true;
  writeSettings(settings);
}

ipcMain.handle(
  'ai:complete',
  async (
    event,
    request: { provider?: unknown; model?: unknown; system?: unknown; messages?: unknown },
  ) => {
    if (!entryOf(event)) return { success: false, error: 'Not available here.' };
    const provider = typeof request?.provider === 'string' ? request.provider : '';
    if (!Object.prototype.hasOwnProperty.call(CONNECTOR_NAMES, provider)) return { success: false, error: `Unknown AI provider "${provider}".` };
    const messages = Array.isArray(request.messages)
      ? request.messages.filter((m): m is AiMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      : [];
    if (messages.length === 0) return { success: false, error: 'Nothing to send.' };
    const system = typeof request.system === 'string' ? request.system : undefined;
    const requestedModel = typeof request.model === 'string' ? request.model : '';

    // Everything comes from the connector's own settings, never from the
    // request: a key or endpoint supplied by renderer code is not trusted.
    const values = connectorValues(provider);
    const apiKey = readSecret(provider, 'apiKey');
    const endpoint = (values.endpoint ?? '').trim();
    const configured = provider === 'local' ? endpoint.length > 0 : apiKey !== null;
    if (!configured) return { success: false, error: `${CONNECTOR_NAMES[provider]} is not set up. Set it up in Settings › Connectors.` };
    const modelName = requestedModel || values.model || '';

    try {
      let model;
      switch (provider) {
        case 'anthropic':
          model = createAnthropic({ apiKey: apiKey! })(modelName || 'claude-opus-4-8');
          break;
        case 'openai':
          model = createOpenAI({ apiKey: apiKey! })(modelName || 'gpt-4o');
          break;
        case 'google':
          model = createGoogleGenerativeAI({ apiKey: apiKey! })(modelName || 'gemini-2.0-flash');
          break;
        case 'openrouter':
          model = createOpenRouter({ apiKey: apiKey! })(modelName || 'openai/gpt-4o');
          break;
        default: {
          // A local endpoint is whatever the user is running -- Ollama, LM
          // Studio, their own box -- so the URL is theirs to set and a key is
          // usually absent. The field asks for the chat completions URL; the
          // client wants the base it hangs that path on.
          if (!/^https?:\/\//i.test(endpoint)) return { success: false, error: 'The Local model endpoint must be an http(s) URL.' };
          model = createOpenAICompatible({
            name: 'local',
            baseURL: endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/i, ''),
            apiKey: apiKey ?? 'local',
          })(modelName || 'llama3');
          break;
        }
      }

      const { text } = await generateText({
        model,
        system,
        messages,
        maxOutputTokens: 2048,
      });
      return { success: true, text };
    } catch (err: unknown) {
      // Provider errors carry request context and sometimes the key itself.
      // Surface the message only, never the object, and never the key in it.
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: apiKey ? message.split(apiKey).join('[key]') : message };
    }
  },
);

ipcMain.handle(
  'plugin:net-request',
  async (_event, req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
    if (!entryOf(_event)) return { success: false, error: 'Not available here.' };
    try {
      if (!/^https?:\/\//.test(req.url)) return { success: false, error: 'Only http(s) URLs are allowed.' };
      const res = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body });
      const text = await res.text();
      return { success: true, status: res.status, body: text };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },
);

// ==========================================================================
// IPC — renderer-reported errors join the same local diagnostic log.
// ==========================================================================

ipcMain.handle(
  'notes:log-error',
  async (_event, errorData: { phase: string; error_message: string; stack_trace: string; remediation_step: string }) => {
    if (!entryOf(_event)) return { success: false, error: 'Not available here.' };
    const success = await diagnostics.write({
      level: 'error',
      category: `renderer.${errorData.phase || 'unknown'}`,
      message: errorData.error_message,
      stack: errorData.stack_trace,
    });
    return success ? { success: true } : { success: false, error: 'Could not write diagnostic log' };
  },
);

ipcMain.handle('diagnostics:open-logs', async (event) => {
  if (!entryOf(event)) return { success: false, error: 'Not available here.' };
  const error = await shell.openPath(diagnostics.directory);
  return error ? { success: false, error } : { success: true };
});

// ==========================================================================
// Security — harden every web-contents, especially the in-app browser
// <webview>. The main process is the authoritative gate: renderer-set webview
// options can't weaken these.
// ==========================================================================

app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_preloadEvent, preloadPath, error) => {
    void diagnostics.write({
      level: 'error',
      category: 'renderer.preload-error',
      message: `Preload failed: ${preloadPath}; ${error.message}`,
      stack: error.stack,
    });
  });
  contents.on('unresponsive', () => {
    void diagnostics.write({
      level: 'warn',
      category: 'renderer.unresponsive',
      message: `Renderer became unresponsive; url=${contents.getURL()}`,
    });
  });

  // 1. Force-safe options on any <webview> before it attaches: no preload, no
  //    Node, context isolation + sandbox on. (Electron security checklist #17.)
  contents.on('will-attach-webview', (_e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });

  // Is this webContents an HTMX view (served from the loopback view server)?
  const isHtmxView = () => {
    const origin = getViewServerOrigin();
    return isSameOrigin(contents.getURL(), origin);
  };

  // 2. Never let a page spawn a new Electron window. HTMX views may not open
  //    anything at all (popups are an exfiltration channel for untrusted
  //    content); other pages hand http(s) popups to the OS browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (!isHtmxView() && /^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 3. The app's own frame may not be navigated away from its bundled content
  //    (clickjacking / drive-by nav). An HTMX view webview is pinned to its own
  //    session on the view server. The browser <webview> may roam.
  contents.on('will-navigate', (event, url) => {
    if (isHtmxView()) {
      const origin = getViewServerOrigin();
      if (!isSameOrigin(url, origin)) event.preventDefault();
      return;
    }
    if (contents.getType() === 'webview') return;
    const allowed = isAppContent(url, RENDERER_ROOT, process.platform === 'win32', IS_DEV);
    if (!allowed) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  // 4. Deny all permission requests (camera, mic, geolocation, …) from the
  //    embedded browser; scoped to the webview session so the app is untouched.
  if (contents.getType() === 'webview') {
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  }
});

// Single instance: launching Neuron again must focus the existing window,
// not spawn a rival process. Two instances share the same user-data
// directory, which corrupts caches ("Unable to move the cache: Access is
// denied") and makes the second launch look like the app failed to start.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', (_event, commandLine) => {
  const workspace = workspacePathFromArgv(commandLine, app.isPackaged, isInstallWorkspace);
  // A second launch with a folder opens it (in its own window unless it is
  // already on screen); without one it brings the app forward.
  if (workspace && openWorkspace(workspace, null)) return;
  const last = (lastWorkspaceId !== null ? appWindows.get(lastWorkspaceId) : undefined) ?? [...appWindows.values()][0];
  if (last) focusWindow(last.window);
});

initHtmxViews({
  getRepoRoot: repoOf,
  getSetting: (key) => {
    const settings = readSettings();
    return key in settings ? settings[key] : null;
  },
  setSetting: (key, value) => {
    const settings = readSettings();
    settings[key] = value;
    writeSettings(settings);
  },
});

/**
 * Whether this build carries a real code signature.
 *
 * Only macOS is asked, and only because Squirrel.Mac refuses to install into an
 * app it cannot validate — an ad-hoc signature, which is what these builds have,
 * is not one. `CodeResources` exists for any signed bundle; a Developer ID adds
 * a provisioning profile, but its absence is not what decides this.
 */
function hasCodeSignature(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    // Contents/MacOS/<exe> -> Contents
    const contents = path.dirname(path.dirname(app.getPath('exe')));
    return fs.existsSync(path.join(contents, '_CodeSignature', 'CodeResources'))
      && fs.existsSync(path.join(contents, 'embedded.provisionprofile'));
  } catch {
    return false;
  }
}

app.on('ready', () => {
  void diagnostics.startSession({
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
  });
  // Recorded so the log says where the dumps are. A native crash writes a dump
  // and nothing else -- if the two are not findable together, whoever reads the
  // log later has no reason to think a dump exists at all.
  void diagnostics.write({
    level: 'info',
    category: 'app.crash-dumps',
    message: `Native crash dumps (local only, never uploaded): ${crashDumps}`,
  });
  configureWriteJournal(app.getPath('userData'));
  ensureDefaultRepo();
  migrateConnectorSecrets();
  const workspace = workspacePathFromArgv(process.argv, app.isPackaged, isInstallWorkspace);
  if (workspace && usableRepo(workspace)) rememberRepo(workspace);
  protocol.handle(FILE_SCHEME, serveWorkspaceFile);
  createWindow();
  // GitHub-backed in-app updates. What counts as an update, and whether to look
  // at all, lives in ./updater so the rules are testable without Electron --
  // every branch there is a case where getting it wrong either offers an update
  // that cannot install or silently offers none.
  if (app.getName() === 'neuron') {
    const decision = configureUpdater(autoUpdater, {
      platform: process.platform,
      packaged: app.isPackaged,
      windowsStore: !!(process as NodeJS.Process & { windowsStore?: boolean }).windowsStore,
      version: app.getVersion(),
      signed: hasCodeSignature(),
    });
    if (decision.check) {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('Update check failed:', err));
    }
  }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (appWindows.size === 0) createWindow();
});
