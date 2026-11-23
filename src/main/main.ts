import { app, BrowserWindow, ipcMain, dialog, shell, session, crashReporter, protocol, safeStorage } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { decideOpen, settingsSectionOf, ownsPtyKey, ptyKey, type SettingsSection, type WindowKind } from './workspace-windows';
import { autoUpdater } from 'electron-updater';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { importChromeCookies, cleanupChromeCookieCopies } from './chrome-cookies';
import { requestPublic } from './public-network';
import { encodeSecret, decodeSecret, hasStoredSecret, carriesApiKey, migrateSecretSettings, rendererSettingsValue, noKeychainError, type SecretCodec } from './secret-storage';
import { initHtmxViews, getViewServerOrigin, revokeAllViewSessions, APPROVALS_KEY as VIEW_TRUST_KEY } from './htmx';
import { DEV_URL, isAppContent, isSameOrigin } from './navigation';
import { resolveInside, realpathInside } from './repoPath';
import { folderKey, keyNames, listedWorkspaces, nameOf, startupRecents, uniqueRecents, withName } from './recentRepos';
import { capturePreImage, configureWriteJournal, listJournalEntries, restoreJournalEntry } from './journal';
import { installApplicationMenu } from './menu';
import { copyTemplate, hasNotes, listTemplates, templatesRoot } from './templates';
import { configureUpdater } from './updater';
import { createDiagnosticLogger, errorDetails } from './diagnostic-logger';
import { configureCrashReporter } from './crash-reporter';
import { installDirectory, isInsideInstall, workspacePathFromArgv } from './workspace-argv';
import * as path from 'path';
import * as fs from 'fs';
import { openSafe, mkdirSafeSync, unlinkSafeSync, renameSafe } from './safe-fs';
import * as os from 'os';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { fileKind, isListedFile, isUnlistedText, looksLikeText, needsSniff, SNIFF_BYTES } from './file-kinds';
import { FILE_SCHEME, respondWithFile } from './file-protocol';
import { NOTE_READ_LIMIT, TOO_LARGE_TO_OPEN, TOO_LARGE_TO_SAVE } from './file-limits';
import { createSaveQueue, saveKey, writeAtomically } from './save-file';
import { createSettingsReader } from './settings-file';
import { isWatchLimitError, watchWorkspace } from './workspace-watcher';
import { ENTRY_LIMIT, walkWorkspace, type WorkspaceEntries } from './workspace-walk';
import { moveRefusal, normalizeRelative, samePath, tableMetaMove } from './workspace-rename';
import * as pty from 'node-pty';
import { defaultShell } from './terminal-shell';
import { appendHistory } from './terminal-history';


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
  /** The workspace this window was last told it cannot fully watch, so it is told once. */
  watchLimitNoticed: string | null;
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

// Workspace files (isListedFile): Markdown notes, HTMX views (+ their
// manifests), databases, canvases, Mermaid diagrams, CSV tables, the internal
// shell config, and .neuron configuration/assets (CSV table metadata is
// .neuron/tables/**.json). The renderer uses the same test.

// ==========================================================================
// Settings store — JSON file in userData. Holds the active/recent
// repositories and per-plugin config (including API keys). Never bundled.
// ==========================================================================

interface Settings {
  repositories: { current: string | null; recent: string[]; names?: Record<string, string> };
  seededDemo?: boolean;
  [key: string]: unknown;
}

const settingsFile = () => path.join(app.getPath('userData'), 'neuron-settings.json');
const legacySettingsFile = () => path.join(app.getPath('userData'), 'autonote-settings.json');

// A damaged file is moved aside before anything can write over it, and the
// user is told once, when the app can show a dialog. See ./settings-file.
const settingsReader = createSettingsReader({
  fs,
  file: settingsFile,
  legacyFile: legacySettingsFile,
  notify: (message) => {
    void diagnostics.write({ level: 'warn', category: 'settings.damaged', message });
    void app.whenReady().then(() => dialog.showMessageBox({ type: 'warning', title: 'Neuron', message }));
  },
});

function readSettings(): Settings {
  return { repositories: { current: null, recent: [] }, ...settingsReader.read() } as Settings;
}

function writeSettingsAtomically(file: string, settings: Record<string, unknown>): void {
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* renamed or never created */ }
  }
}

function writeSettings(settings: Settings): boolean {
  // The damaged file is still where this would write. Keep it rather than the change.
  if (!settingsReader.canWrite()) return false;
  try {
    writeSettingsAtomically(settingsFile(), settings);
    return true;
  } catch (err) {
    console.error('Failed to persist settings:', err);
    return false;
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
  // In development the demo is in the list, and a workspace copied from it is
  // usually a folder called demo-repo too: two rows reading "demo-repo".
  const base = folderKey(dir) === folderKey(demoRepoPath()) ? 'Demo workspace' : path.basename(dir) || dir;
  return {
    path: dir,
    // By folder, not spelling: a rename made through C:\Notes still names c:\notes\.
    name: nameOf(readSettings().repositories.names, dir) || base,
    cloud: CLOUD_HINTS.some((hint) => lower.includes(hint)),
  };
}

/** The workspace whose window opened Settings, while a window still shows it (in any spelling). */
function openSettingsOpener(): string | null {
  const opener = settingsOpener;
  if (!opener) return null;
  const key = folderKey(opener);
  const open = [...appWindows.values()].some((entry) => entry.kind === 'workspace' && !!entry.repo && folderKey(entry.repo) === key);
  return open ? opener : null;
}

const isFolder = (dir: string): boolean => {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
};

/** Repair saved workspace paths and keep the development demo discoverable. */
function ensureDefaultRepo(): void {
  const settings = readSettings();
  const demo = demoRepoPath();
  const demoExists = isFolder(demo);

  // Folders that are not there stay listed (an unplugged drive comes back);
  // install-folder workspaces go, and two spellings of one folder become one.
  settings.repositories.recent = startupRecents(settings.repositories.recent, isInstallWorkspace);
  // Names saved under a spelling are kept under the folder's identity instead.
  if (settings.repositories.names) settings.repositories.names = keyNames(settings.repositories.names);

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
    // Text files too (JSON, YAML, a README): an open one follows its file on
    // disk the way a note does. The renderer keeps them out of its notes.
    if (isListedFile(relativePath) || isUnlistedText(relativePath) || event === 'unlink') {
      entry.window.webContents.send('notes:changed', event, relativePath);
    }
    // The renderer asks for the full listing again. Not for edits to notes, or
    // every save while typing would re-walk the folder. Other files count even
    // on 'change': the native watcher can report a new file as one.
    if (event !== 'change' || !isListedFile(relativePath)) entry.window.webContents.send('workspace:changed');
  }, {
    // Linux runs out of inotify watches in a large workspace (ENOSPC), and any
    // system can run out of file handles (EMFILE). Neuron goes on without the
    // watcher; the window says so once for this workspace.
    onError: (error) => {
      if (!isWatchLimitError(error) || entry.window.isDestroyed() || entry.watchLimitNoticed === dir) return;
      entry.watchLimitNoticed = dir;
      entry.window.webContents.send('workspace:watch-limit');
    },
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
      // Electron's defaults, stated so a later change cannot drop them unseen.
      // The preload needs nothing but `electron` (contextBridge, ipcRenderer),
      // which is what a sandboxed preload is allowed.
      sandbox: true,
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
  const entry: AppWindow = { window, kind, repo: kind === 'workspace' ? usableRepo(repo) : null, watcher: null, watchLimitNoticed: null, fileToken: randomBytes(32).toString('hex') };
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
  if (entryOf(event)?.kind !== 'settings') return null;
  const opener = openSettingsOpener();
  return opener ? repoInfo(opener) : null;
});
ipcMain.handle('window:set-overlay-colors', (event, colors: { color?: unknown; symbolColor?: unknown } | null) => {
  const window = windowOf(event);
  if ((process.platform !== 'win32' && process.platform !== 'linux') || !window) return;
  if (!isRecord(colors)) return;
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
const safeSettingsKey = (key: unknown): key is string => typeof key === 'string'
  && !['__proto__', 'constructor', 'prototype'].includes(key);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function secretCodec(): SecretCodec {
  return {
    available: safeStorage.isEncryptionAvailable()
      && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  };
}

/** The saved form of a secret, still encrypted. Own properties only. */
function storedSecret(scope: string, field: string): unknown {
  const store = readSettings()[SECRETS_KEY];
  if (!store || typeof store !== 'object' || !Object.hasOwn(store, scope)) return null;
  const scoped = (store as Record<string, unknown>)[scope];
  if (!scoped || typeof scoped !== 'object' || !Object.hasOwn(scoped, field)) return null;
  return (scoped as Record<string, unknown>)[field];
}

function readSecret(scope: string, field: string): string | null {
  return decodeSecret(storedSecret(scope, field), secretCodec());
}

ipcMain.handle('settings:get', (_event, key: string) => {
  if (!entryOf(_event) || !safeSettingsKey(key)) return null;
  // The renderer may never read the secret namespace, by any key that resolves
  // to it. Without this the store would be one settings.get('__secrets') away
  // from being exactly as exposed as before.
  if (key === SECRETS_KEY) return null;
  const settings = readSettings();
  if (Object.hasOwn(settings, key)) {
    const value = settings[key];
    return rendererSettingsValue(key, value);
  }
  return null;
});
ipcMain.handle('settings:set', (event, key: string, value: unknown) => {
  if (!entryOf(event)) return { success: false, error: 'Not available here.' };
  if (!safeSettingsKey(key)) return { success: false, error: 'Invalid settings key.' };
  if (key === SECRETS_KEY) return { success: false, error: 'Reserved key.' };
  // Which HTML views are trusted is written by the trust prompt in main only
  // (htmx/index.ts); a renderer write here would trust a view nobody saw.
  if (key === VIEW_TRUST_KEY) return { success: false, error: 'Reserved key.' };
  // Not only where keys used to live: an apiKey anywhere in any value would be
  // plain text on disk and readable back by every renderer.
  if (carriesApiKey(value)) return { success: false, error: 'Use the secret store for keys.' };
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
  if (!safeSettingsKey(scope) || !safeSettingsKey(field) || !scope || !field || typeof value !== 'string') {
    return { success: false, error: 'Invalid secret reference.' };
  }
  const settings = readSettings();
  const store = (settings[SECRETS_KEY] && typeof settings[SECRETS_KEY] === 'object'
    ? settings[SECRETS_KEY]
    : {}) as Record<string, Record<string, unknown>>;
  const scoped = { ...(store[scope] ?? {}) };
  if (typeof value === 'string' && value.length > 0) {
    const codec = secretCodec();
    if (!codec.available) return { success: false, error: noKeychainError(process.platform) };
    try { scoped[field] = encodeSecret(value, codec); }
    catch { return { success: false, error: 'Could not encrypt the key with the system keychain.' }; }
  }
  else delete scoped[field];
  settings[SECRETS_KEY] = { ...store, [scope]: scoped };
  return writeSettings(settings) ? { success: true } : { success: false, error: 'Could not save the key.' };
});

// Answered from the saved shape: asking whether a key exists never decrypts it.
ipcMain.handle('settings:has-secret', (_event, scope: string, field: string) => !!entryOf(_event)
  && safeSettingsKey(scope) && safeSettingsKey(field) && hasStoredSecret(storedSecret(scope, field), secretCodec()));

// ==========================================================================
// IPC — repository
// ==========================================================================

ipcMain.handle('repository:get-current', (event) => {
  const dir = repoOf(event);
  return dir ? repoInfo(dir) : null;
});

// The open workspace is not "recent": the switcher already shows it on its
// button, and listing it again underneath was the name appearing twice.
// Settings gets every folder once, with its opener marked. A folder that is
// not there is still listed, marked missing, so a drive that is plugged back
// in brings its workspace back.
ipcMain.handle('repository:list-recent', (event) => {
  const entry = entryOf(event);
  if (!entry) return [];
  const recent = readSettings().repositories.recent.filter((p) => typeof p === 'string' && !isInstallWorkspace(p));
  const opener = entry.kind === 'settings' ? openSettingsOpener() : null;
  return listedWorkspaces(recent, entry.repo, opener)
    .map(({ dir, isOpener }) => ({ ...repoInfo(dir), missing: !isFolder(dir), isOpener }));
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
  if (typeof templateId !== 'string') return { error: 'Invalid template id.' };

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
    return { success: false, error: `Folder not found: “${repoInfo(dir).name}” may have been moved, renamed or deleted, or be on a drive that is not connected.` };
  }
  if (!openWorkspace(dir, entryOf(event))) return { success: false, error: INSTALL_FOLDER_MESSAGE };
  return { success: true, repository: repoInfo(dir) };
});

ipcMain.handle('repository:set-name', (_event, dir: string, name: string) => {
  if (!entryOf(_event)) return { success: false, error: 'Not available here.' };
  if (!safeSettingsKey(dir) || typeof name !== 'string') return { success: false, error: 'Invalid workspace name.' };
  const settings = readSettings();
  // Stored by folder identity, so every spelling of the folder shows the name.
  settings.repositories.names = withName(settings.repositories.names, dir, name);
  writeSettings(settings);
  const key = folderKey(dir);
  for (const entry of appWindows.values()) {
    if (entry.repo && folderKey(entry.repo) === key && !entry.window.isDestroyed()) {
      entry.window.webContents.send('repository:changed', repoInfo(entry.repo));
    }
  }
  return { success: true, repository: repoInfo(dir) };
});

ipcMain.handle('repository:remove', (event, dir: string) => {
  if (!entryOf(event)) return { success: false, error: 'Not available here.' };
  if (typeof dir !== 'string') return { success: false, error: 'Invalid workspace path.' };
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
  if (!entryOf(_event) || typeof dir !== 'string') return { success: false };
  const { current, recent } = readSettings().repositories;
  const known = [current, ...recent, ...[...appWindows.values()]
    .filter((entry) => entry.kind === 'workspace' && !entry.window.isDestroyed()).map((entry) => entry.repo)];
  if (!known.some((repo) => repo && folderKey(repo) === folderKey(dir)) || !fs.existsSync(dir)) return { success: false };
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
    return walkRepoFiles(repo).filter(isListedFile);
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
    const results = await Promise.all(batch.map((file) => startsAsText(repo, path.join(repo, file))));
    batch.forEach((file, index) => { if (results[index]) text.push(file); });
  }
  return { ...listing, text };
});

const SNIFF_FILE_LIMIT = 2000;
/** Text files over this open read-only, showing only this much. */
const TEXT_READ_LIMIT = 5 * 1024 * 1024;

/** Whether a file's first SNIFF_BYTES are UTF-8 text with no NUL byte. */
async function startsAsText(repo: string, fullPath: string): Promise<boolean> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await openSafe(repo, fullPath);
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
      const handle = await openSafe(resolved.repo, resolved.fullPath);
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
    // Read whole, so never past NOTE_READ_LIMIT: a 500 MB CSV read into a
    // string would exhaust the main process. The size is checked first and the
    // file is not opened at all past it.
    // One handle for the size check and the read, so both see the same file.
    // Async: opening a workspace reads every note at once, and synchronous
    // reads hold the main thread -- which in Electron is also the browser's UI
    // thread -- for the whole batch. Opening 5,000 freshly written notes on
    // Windows: explorer after 33 s with sync reads, 7-8 s with these.
    const note = await openSafe(resolved.repo, resolved.fullPath);
    try {
      if ((await note.stat()).size > NOTE_READ_LIMIT) return TOO_LARGE_TO_OPEN;
      return await note.readFile('utf-8');
    } finally {
      await note.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Missing files are an expected probe result (e.g. optional .neuron/layout.json);
    // only unexpected failures deserve a stack trace in the logs.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Failed to read note ${relativePath}:`, err);
    return `Error: Could not read note. ${message}`;
  }
});

const saveQueue = createSaveQueue();
ipcMain.handle('notes:write', async (_event, relativePath: string, content: string) => {
  if (typeof content !== 'string') return { success: false, error: 'Invalid note content.' };
  const resolved = resolveInRepo(_event, relativePath);
  if (!resolved) return { success: false, error: 'No workspace is open.' };
  const guard = textGuard(relativePath);
  if (guard === 'refuse') return { success: false, error: 'Neuron does not write this kind of file.' };
  // Nothing Neuron writes is read back past the limit, so nothing is written past it.
  if (content.length > NOTE_READ_LIMIT || Buffer.byteLength(content, 'utf-8') > NOTE_READ_LIMIT) return { success: false, error: TOO_LARGE_TO_SAVE };
  // In call order, one at a time per file: see createSaveQueue.
  return saveQueue(saveKey(resolved.fullPath), async () => {
    const tmp = `${resolved.fullPath}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const size = await fs.promises.stat(resolved.fullPath).then((stat) => stat.size, () => -1);
      if (guard === 'text' || guard === 'unknown') {
        // Never write back a file that was opened truncated, or one that is not text.
        if (size > TEXT_READ_LIMIT) return { success: false, error: 'This file is too large to edit in Neuron.' };
        if (guard === 'unknown' && size >= 0 && !(await startsAsText(resolved.repo, resolved.fullPath))) return { success: false, error: 'This file is not text.' };
      } else if (size > NOTE_READ_LIMIT) {
        // Never opened (notes:read refused it), so nothing here is a version of it.
        return { success: false, error: 'This file is too large to edit in Neuron (over 25 MB).' };
      }
      const dir = path.dirname(resolved.fullPath);
      mkdirSafeSync(resolved.repo, dir);
      capturePreImage(resolved.repo, resolved.fullPath, 'overwrite');
      await writeAtomically(resolved.fullPath, content, tmp, { root: resolved.repo });
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to write note ${relativePath}:`, err);
      return { success: false, error: message };
    }
  });
});

ipcMain.handle('notes:delete', async (_event, relativePath: string) => {
  const resolved = resolveInRepo(_event, relativePath);
  if (!resolved) return { success: false, error: 'No workspace is open.' };
  try {
    const stat = fs.lstatSync(resolved.fullPath);
    if (stat.isDirectory()) return { success: false, error: 'Use the folder delete for folders.' };
    if (stat.isFile()) capturePreImage(resolved.repo, resolved.fullPath, 'delete');
    unlinkSafeSync(resolved.repo, resolved.fullPath);
    return { success: true };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { success: true };
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to delete note ${relativePath}:`, err);
    return { success: false, error: message };
  }
});

/**
 * Rename `fromFull` to `toFull`. A case-only rename goes through a temporary
 * name, which Windows and macOS need to change only the case. A rename held
 * for a moment (the watcher, an indexer) is retried, as a save's is.
 */
async function moveEntry(repo: string, fromFull: string, toFull: string, caseOnly: boolean): Promise<void> {
  const once = async (a: string, b: string) => {
    for (let attempt = 1; ; attempt++) {
      try { await renameSafe(repo, a, b); return; } catch (error) {
        if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
      }
    }
  };
  mkdirSafeSync(repo, path.dirname(toFull));
  if (!caseOnly) { await once(fromFull, toFull); return; }
  const between = `${fromFull}.${randomBytes(6).toString('hex')}.tmp`;
  await once(fromFull, between);
  await once(between, toFull);
}

// Rename or move a file or folder: every entry point (F2, the menus, Move to…,
// dragging onto a folder) comes here. Both paths are guarded like every other
// file handler, nothing is overwritten, a folder never goes into itself, and a
// managed CSV's settings in .neuron/tables/ go with it. The renderer rewrites
// links afterwards through notes:write-links.
ipcMain.handle('workspace:rename', async (event, from: string, to: string) => {
  if (typeof from !== 'string' || typeof to !== 'string') return { success: false, error: 'Invalid path.' };
  const source = resolveInRepo(event, from);
  const target = resolveInRepo(event, to);
  if (!source || !target) return { success: false, error: 'That path is outside this workspace.' };
  const fromPath = normalizeRelative(from);
  const toPath = normalizeRelative(to);
  const ignoreCase = process.platform === 'win32' || process.platform === 'darwin';
  let stat: fs.Stats;
  try { stat = fs.lstatSync(source.fullPath); } catch { return { success: false, error: `“${fromPath}” is no longer there.` }; }
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return { success: false, error: 'Neuron only renames files and folders.' };
  const folder = stat.isDirectory();
  const refusal = moveRefusal(fromPath, toPath, folder, ignoreCase);
  if (refusal) return { success: false, error: refusal };
  if (fromPath === toPath) return { success: true };
  if (!folder && (fileKind(fromPath) === 'blocked' || fileKind(toPath) === 'blocked')) return { success: false, error: 'Neuron doesn’t rename programs or scripts.' };
  const caseOnly = samePath(fromPath, toPath, ignoreCase);
  const name = toPath.slice(toPath.lastIndexOf('/') + 1);
  if (!caseOnly && fs.existsSync(target.fullPath)) return { success: false, error: `“${name}” already exists there. Choose another name.` };
  // After any save of this file still queued, so that save cannot land at the old name.
  return saveQueue(saveKey(source.fullPath), async () => {
    try {
      // Journalled as what left the old path, so version history can bring it
      // back there. A folder of more than 200 files is not: the move loses no
      // content, and it would push the rest of the history out.
      const files = folder ? walkWorkspace(source.fullPath, { limit: 201 }).files.map((file) => path.join(source.fullPath, file)) : [source.fullPath];
      if (files.length <= 200) for (const file of files) capturePreImage(source.repo, file, 'delete');
      await moveEntry(source.repo, source.fullPath, target.fullPath, caseOnly);
      const meta = tableMetaMove(fromPath, toPath, folder);
      const metaFrom = meta && resolveInRepo(event, meta.from);
      const metaTo = meta && resolveInRepo(event, meta.to);
      if (metaFrom && metaTo && fs.existsSync(metaFrom.fullPath) && (caseOnly || !fs.existsSync(metaTo.fullPath))) {
        await moveEntry(metaFrom.repo, metaFrom.fullPath, metaTo.fullPath, caseOnly).catch((error) => console.error(`Failed to move table settings for ${fromPath}:`, error));
      }
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to rename ${fromPath} to ${toPath}:`, err);
      return { success: false, error: `Could not rename “${fromPath}”. ${message}` };
    }
  });
});

// Links rewritten after a rename, a move or a new duplicate name: each note
// written whole, one save at a time per file like notes:write, and journalled
// on its own (never folded into an edit made a moment ago), so version history
// can undo exactly this. Notes only, and only ones that are there.
ipcMain.handle('notes:write-links', async (event, edits: unknown) => {
  if (!Array.isArray(edits) || !edits.length || edits.length > 10_000) return { success: false, error: 'Invalid link changes.' };
  const repo = repoOf(event);
  if (!repo) return { success: false, error: 'No workspace is open.' };
  const checked: { fullPath: string; content: string }[] = [];
  for (const edit of edits as unknown[]) {
    const item = edit as { path?: unknown; content?: unknown } | null;
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || typeof item.content !== 'string') return { success: false, error: 'Invalid link changes.' };
    if (!/\.mdx?$/i.test(item.path)) return { success: false, error: 'Links are rewritten in notes only.' };
    if (Buffer.byteLength(item.content, 'utf-8') > NOTE_READ_LIMIT) return { success: false, error: TOO_LARGE_TO_SAVE };
    const resolved = resolveInRepo(event, item.path);
    if (!resolved) return { success: false, error: 'That path is outside this workspace.' };
    checked.push({ fullPath: resolved.fullPath, content: item.content });
  }
  let written = 0;
  for (const edit of checked) {
    const ok = await saveQueue(saveKey(edit.fullPath), async () => {
      if (!fs.existsSync(edit.fullPath)) return false;
      capturePreImage(repo, edit.fullPath, 'overwrite', { coalesce: false });
      await writeAtomically(edit.fullPath, edit.content, `${edit.fullPath}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`, { root: repo });
      return true;
    }).catch((error) => { console.error('Failed to rewrite links:', error); return false; });
    if (ok) written++;
  }
  return { success: written === checked.length, written };
});

// Version history. Reads the write journal captured on every overwrite/delete.
// Main-process only and deliberately not reachable from a view: the journal holds
// pre-images from across the whole workspace, so exposing it to a capability-scoped
// view would hand it file contents outside its path policy (DECISIONS.md D20).
ipcMain.handle('journal:list', (_event, relativePath?: string) => {
  const repo = repoOf(_event);
  if (!repo || (relativePath !== undefined && !resolveInRepo(_event, relativePath))) return [];
  const entries = listJournalEntries(repo);
  return relativePath ? entries.filter((e) => e.relativePath === relativePath) : entries;
});

ipcMain.handle('journal:restore', (_event, entryId: string) => {
  const repo = repoOf(_event);
  if (!repo) return { success: false, error: 'No workspace is open.' };
  if (typeof entryId !== 'string') return { success: false, error: 'Invalid journal entry.' };
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

/**
 * neuron-file:// -- workspace images, video and audio (canvas image cards
 * included) for the window that owns the token in the URL. See
 * respondWithFile in ./file-protocol.
 */
function serveWorkspaceFile(request: Request): Promise<Response> {
  return respondWithFile(request, (id) => {
    const entry = appWindows.get(id);
    return entry && !entry.window.isDestroyed() ? { token: entry.fileToken, repo: entry.repo } : null;
  });
}

// Pull Chrome's cookies into the in-app browser's persistent session so the
// user stays logged in without signing in again.
ipcMain.handle('cookies:import-chrome', (_event, domain: unknown) =>
  entryOf(_event) && typeof domain === 'string' ? importChromeCookies(session.fromPartition('persist:neuron-browser'), domain)
    : { success: false, error: 'Not available here.' },
);

// ==========================================================================
// IPC — interactive PTY terminals (node-pty). One pty per window;
// output is streamed back over `terminal:data`. Used by the terminal panel.
// ==========================================================================

const ptys = new Map<number, pty.IPty>();
const ptyHistory = new Map<number, string>();

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
  if (!isRecord(opts) || (opts.key !== undefined && typeof opts.key !== 'string')
    || (opts.cols !== undefined && !Number.isInteger(opts.cols)) || (opts.rows !== undefined && !Number.isInteger(opts.rows))) {
    throw new Error('Invalid terminal options.');
  }
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
  // PowerShell on Windows; a login shell on macOS and Linux (terminal-shell.ts).
  const launch = defaultShell(process.platform, process.env, onPath);
  try {
    proc = pty.spawn(launch.shell, launch.args, {
      name: 'xterm-color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: repoOf(_event) || process.cwd(),
      env: process.env as { [key: string]: string },
    });
  } catch (error) {
    throw new Error(`could not start ${launch.shell}: ${(error as Error).message}`);
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
  if (!ownsPty(_event, id) || typeof data !== 'string') return;
  try { ptys.get(id)?.write(data); } catch { /* pty closed */ }
});

ipcMain.handle('terminal:resize', (_event, id: number, cols: number, rows: number) => {
  if (!ownsPty(_event, id) || !Number.isInteger(cols) || !Number.isInteger(rows)) return;
  try { ptys.get(id)?.resize(Math.max(1, cols), Math.max(1, rows)); } catch { /* pty closed */ }
});
// ConPTY wraps long lines itself. xterm.js reflows them again on resize unless
// told it is attached to ConPTY -- which is what split a prompt path across two
// lines after narrowing the panel. node-pty uses ConPTY on every Windows build
// Electron supports (Windows 10 and later), so the build number is all the renderer needs.
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

function migrateConnectorSecrets(): void {
  const codec = secretCodec();
  if (!codec.available) return;
  // Rewrite both names: the former copy-based migration left a plaintext backup.
  for (const file of [settingsFile(), legacySettingsFile()]) {
    if (!fs.existsSync(file)) continue;
    try {
      const original = JSON.parse(fs.readFileSync(file, 'utf-8'));
      // Not a settings object: readSettings moves it aside, so leave it as it is.
      if (!isRecord(original)) continue;
      const migrated = migrateSecretSettings(original, codec);
      if (JSON.stringify(migrated) !== JSON.stringify(original)) writeSettingsAtomically(file, migrated);
    } catch {
      console.error('Could not migrate saved keys to the system keychain.');
    }
  }
}

ipcMain.handle(
  'ai:complete',
  async (
    event,
    request: { provider?: unknown; model?: unknown; system?: unknown; messages?: unknown },
  ) => {
    if (!entryOf(event)) return { success: false, error: 'Not available here.' };
    if (!isRecord(request) || typeof request.provider !== 'string'
      || (request.model !== undefined && typeof request.model !== 'string')
      || (request.system !== undefined && typeof request.system !== 'string')
      || !Array.isArray(request.messages) || !request.messages.every((m) => isRecord(m)
        && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) {
      return { success: false, error: 'Invalid AI request.' };
    }
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
    if (!isRecord(req) || typeof req.url !== 'string'
      || (req.method !== undefined && typeof req.method !== 'string')
      || (req.body !== undefined && typeof req.body !== 'string')
      || (req.headers !== undefined && (!isRecord(req.headers) || !Object.values(req.headers).every((v) => typeof v === 'string')))) {
      return { success: false, error: 'Invalid network request.' };
    }
    try {
      return { success: true, ...await requestPublic(req) };
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
    if (!isRecord(errorData) || !(['phase', 'error_message', 'stack_trace', 'remediation_step'] as const).every((key) => typeof errorData[key] === 'string')) {
      return { success: false, error: 'Invalid diagnostic data.' };
    }
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
    webPreferences.nodeIntegrationInSubFrames = false;
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
  const guardNavigation = (event: Electron.Event, url: string) => {
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
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);

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
  cleanupChromeCookieCopies();
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
  migrateConnectorSecrets();
  ensureDefaultRepo();
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
