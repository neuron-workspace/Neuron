import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
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
import { capturePreImage, configureWriteJournal, listJournalEntries, restoreJournalEntry } from './journal';
import { installApplicationMenu } from './menu';
import * as path from 'path';
import * as fs from 'fs';
import chokidar from 'chokidar';
import { exec } from 'child_process';
import * as pty from 'node-pty';


let mainWindow: BrowserWindow | null = null;
let watcher: chokidar.FSWatcher | null = null;

// Workspace files: Markdown notes, HTMX views (+ their manifests), databases,
// canvases, folder mini-apps (neuron.app + neuron.app.json), the internal shell
// config, and .neuron configuration/assets.
const WORKSPACE_FILE = /(^\.neuron[\/\\].+\.(json|html|css)$|^neuron\.config$|\.neuron\.json$|(^|[\/\\])neuron\.app\.json$|\.(md|mdx|html|db|canvas)$)/;

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

function activeRepoPath(): string | null {
  const current = readSettings().repositories.current;
  if (current && fs.existsSync(current) && fs.statSync(current).isDirectory()) return current;
  return null;
}

const CLOUD_HINTS = ['onedrive', 'dropbox', 'google drive', 'icloud', 'box sync'];

function repoInfo(dir: string) {
  const lower = dir.toLowerCase();
  const names = readSettings().repositories.names ?? {};
  const base = path.basename(dir) || dir;
  return {
    path: dir,
    name: names[dir] || base,
    cloud: CLOUD_HINTS.some((hint) => lower.includes(hint)),
  };
}

/** On first launch, auto-open the bundled demo repository if one is present. */
function ensureDefaultRepo(): void {
  const settings = readSettings();
  const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();
  const demo = app.isPackaged
    ? path.join(process.resourcesPath, 'examples', 'demo-repo')
    : path.join(process.cwd(), 'examples', 'demo-repo');
  const demoExists = isDir(demo);

  // Prune repositories whose folders no longer exist (e.g. renamed/removed).
  settings.repositories.recent = settings.repositories.recent.filter(isDir);

  // Always keep the bundled demo repository in the recents list so it stays
  // discoverable on the Repositories page, even after other repos are opened.
  if (demoExists && !settings.repositories.recent.includes(demo)) {
    settings.repositories.recent = [...settings.repositories.recent, demo];
  }

  // Auto-open the demo on a genuine first run (no valid active repo yet).
  if (!settings.seededDemo) {
    const hasValidCurrent = !!settings.repositories.current && isDir(settings.repositories.current);
    if (!hasValidCurrent && demoExists) settings.repositories.current = demo;
    settings.seededDemo = true;
  }

  writeSettings(settings);
}

function setActiveRepo(dir: string): void {
  const settings = readSettings();
  settings.repositories.current = dir;
  settings.repositories.recent = [dir, ...settings.repositories.recent.filter((p) => p !== dir)].slice(0, 8);
  writeSettings(settings);
  revokeAllViewSessions(); // HTMX view tokens are workspace-bound
  setupWatcher();
  if (mainWindow) mainWindow.webContents.send('repository:changed', repoInfo(dir));
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

function setupWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  const dir = activeRepoPath();
  if (!dir) return;

  watcher = chokidar.watch(dir, {
    // Ignore dot-entries except .neuron, the workspace's own config folder.
    ignored: /(^|[\/\\])\.(?!neuron([\/\\]|$))/,
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('all', (event, filePath) => {
    if (!mainWindow) return;
    const relativePath = path.relative(dir, filePath);
    if (WORKSPACE_FILE.test(relativePath)) {
      mainWindow.webContents.send('notes:changed', event, relativePath.replace(/\\/g, '/'));
    }
  });
}

// ==========================================================================
// Window
// ==========================================================================

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(process.cwd(), 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title: 'Neuron',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    // Window chrome is the one part of this app that must not be the same
    // everywhere.
    //
    // Windows and Linux keep the frameless window and the title bar Neuron
    // draws itself. macOS keeps its real frame: `hiddenInset` hides the title
    // bar but leaves the traffic lights, so the window can be moved, zoomed and
    // taken full screen the way every other Mac app can. Going frameless there
    // removed all of that and replaced it with buttons that only look like the
    // system's.
    //
    // trafficLightPosition centres the lights in a 40px bar; the default sits
    // them for a taller one and they end up clipped against the top edge.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 13 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // enables in-app browser tabs (<webview>)
    },
    backgroundColor: '#11181c',
  });

  // Windows and Linux hide Electron's default menu bar entirely; the in-app
  // title bar is the menu there. On macOS the menu bar is not part of the
  // window at all, so hiding it would be meaningless and the real application
  // menu is installed instead.
  if (process.platform !== 'darwin') mainWindow.setMenuBarVisibility(false);
  installApplicationMenu(() => mainWindow);

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // What the renderer is really being told here is "compensate for the maximise
  // bleed", not "the window is maximised".
  //
  // A frameless Windows window overhangs the screen by 8px when maximised, and
  // the title bar pads itself to match. Full screen does not overhang, but
  // entering it from a maximised window fires neither `unmaximize` nor
  // `maximize` and `isMaximized()` keeps reporting true — so the padding stayed
  // and showed up as a strip of empty chrome across the top. Reported as a gap
  // in full screen on Windows, and it was.
  const emitMaxState = () => {
    if (mainWindow) mainWindow.webContents.send('window:chrome-state-changed', chromeState(mainWindow));
  };
  mainWindow.on('maximize', emitMaxState);
  mainWindow.on('unmaximize', emitMaxState);
  mainWindow.on('enter-full-screen', emitMaxState);
  mainWindow.on('leave-full-screen', emitMaxState);

  mainWindow.on('closed', () => {
    killAllPtys();
    mainWindow = null;
  });
  // ...and again on the way out, because 'closed' is not on every exit path.
  // A shell that outlives the app is not a test problem: it is a process the
  // user never sees and cannot stop.
  app.once('before-quit', killAllPtys);

  setupWatcher();
}

// ==========================================================================
// IPC — window controls
// ==========================================================================

/**
 * Whether the renderer should pad its title bar for the maximise bleed.
 *
 * Only a frameless window overhangs the screen when maximised, and only when it
 * is maximised rather than full screen. macOS keeps its native frame, so it
 * never bleeds and never needs the inset; a full-screen window does not bleed
 * either, and treating it as maximised is what put a strip of empty chrome
 * across the top of the window on Windows.
 */
function needsMaximizeInset(window: BrowserWindow): boolean {
  if (process.platform === 'darwin') return false;
  return window.isMaximized() && !window.isFullScreen();
}

/** What the renderer needs to know to draw its chrome correctly. */
function chromeState(window: BrowserWindow) {
  return { inset: needsMaximizeInset(window), fullScreen: window.isFullScreen() };
}

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:chrome-state', () => (mainWindow ? chromeState(mainWindow) : { inset: false, fullScreen: false }));

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
ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
  if (key === SECRETS_KEY) return { success: false, error: 'Reserved key.' };
  const settings = readSettings();
  settings[key] = value;
  writeSettings(settings);
  return { success: true };
});

// Write-only from the renderer's side: it can set a secret and ask whether one
// exists, and it can never read the value back.
ipcMain.handle('settings:set-secret', (_event, scope: string, field: string, value: string) => {
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

ipcMain.handle('settings:has-secret', (_event, scope: string, field: string) => readSecret(scope, field) !== null);

// ==========================================================================
// IPC — repository
// ==========================================================================

ipcMain.handle('repository:get-current', () => {
  const dir = activeRepoPath();
  return dir ? repoInfo(dir) : null;
});

ipcMain.handle('repository:list-recent', () => {
  const recent = readSettings().repositories.recent;
  return recent.filter((p) => fs.existsSync(p)).map(repoInfo);
});

ipcMain.handle('repository:create', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Create or choose a workspace folder',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  seedWelcomeNote(dir);
  setActiveRepo(dir);
  return repoInfo(dir);
});

ipcMain.handle('repository:open', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a workspace folder',
    buttonLabel: 'Open workspace',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  setActiveRepo(dir);
  return repoInfo(dir);
});

ipcMain.handle('repository:switch', (_event, dir: string) => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { success: false, error: 'Folder no longer exists.' };
  }
  setActiveRepo(dir);
  return { success: true, repository: repoInfo(dir) };
});

ipcMain.handle('repository:set-name', (_event, dir: string, name: string) => {
  const settings = readSettings();
  const names = { ...(settings.repositories.names ?? {}) };
  const trimmed = name.trim();
  if (trimmed) names[dir] = trimmed;
  else delete names[dir];
  settings.repositories.names = names;
  writeSettings(settings);
  if (mainWindow && settings.repositories.current === dir) {
    mainWindow.webContents.send('repository:changed', repoInfo(dir));
  }
  return { success: true, repository: repoInfo(dir) };
});

ipcMain.handle('repository:remove', (_event, dir: string) => {
  const settings = readSettings();
  settings.repositories.recent = settings.repositories.recent.filter((p) => p !== dir);
  if (settings.repositories.names) delete settings.repositories.names[dir];
  const wasActive = settings.repositories.current === dir;
  if (wasActive) settings.repositories.current = null;
  writeSettings(settings);
  if (wasActive) setupWatcher();
  return { success: true, clearedActive: wasActive };
});

ipcMain.handle('repository:reveal', (_event, dir: string) => {
  shell.showItemInFolder(dir);
  return { success: true };
});

// ==========================================================================
// IPC — notes (operate against the active repository, with traversal guard)
// ==========================================================================

function resolveInRepo(relativePath: string): { repo: string; fullPath: string } | null {
  const repo = activeRepoPath();
  if (!repo) return null;
  const fullPath = path.join(repo, path.normalize(relativePath));
  if (!fullPath.startsWith(repo)) return null; // path traversal guard
  return { repo, fullPath };
}

function walkRepoFiles(repo: string): string[] {
  const files: string[] = [];
  const scanDir = (dir: string) => {
    for (const item of fs.readdirSync(dir)) {
      if (item.startsWith('.')) continue;
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) scanDir(fullPath);
      else files.push(path.relative(repo, fullPath).replace(/\\/g, '/'));
    }
  };
  scanDir(repo);
  return files;
}

ipcMain.handle('notes:list', async () => {
  const repo = activeRepoPath();
  if (!repo) return [];
  try {
    return walkRepoFiles(repo).filter((file) => WORKSPACE_FILE.test(file));
  } catch (err) {
    console.error('Failed to list notes:', err);
  }
  return [];
});

ipcMain.handle('notes:read', async (_event, relativePath: string) => {
  const resolved = resolveInRepo(relativePath);
  if (!resolved) return 'Error: No workspace is open.';
  try {
    return fs.readFileSync(resolved.fullPath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Missing files are an expected probe result (e.g. optional .neuron/layout.json);
    // only unexpected failures deserve a stack trace in the logs.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Failed to read note ${relativePath}:`, err);
    return `Error: Could not read note. ${message}`;
  }
});

ipcMain.handle('notes:write', async (_event, relativePath: string, content: string) => {
  const resolved = resolveInRepo(relativePath);
  if (!resolved) return { success: false, error: 'No workspace is open.' };
  try {
    const dir = path.dirname(resolved.fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    capturePreImage(resolved.repo, resolved.fullPath, 'overwrite');
    // Atomic write: a crash mid-write must never leave a half-written note or database.
    const tmp = `${resolved.fullPath}.tmp`;
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, resolved.fullPath);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to write note ${relativePath}:`, err);
    return { success: false, error: message };
  }
});

ipcMain.handle('notes:delete', async (_event, relativePath: string) => {
  const resolved = resolveInRepo(relativePath);
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
  const repo = activeRepoPath();
  if (!repo) return [];
  const entries = listJournalEntries(repo);
  return relativePath ? entries.filter((e) => e.relativePath === relativePath) : entries;
});

ipcMain.handle('journal:restore', (_event, entryId: string) => {
  const repo = activeRepoPath();
  if (!repo) return { success: false, error: 'No workspace is open.' };
  const result = restoreJournalEntry(repo, entryId);
  return result.success ? { success: true } : { success: false, error: result.error };
});

ipcMain.handle('notes:create-section', async (_event, relativePath: string) => {
  const resolved = resolveInRepo(relativePath);
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

ipcMain.handle('notes:get-dir', () => activeRepoPath());

// ==========================================================================
// IPC — surface file helpers
// ==========================================================================

// Read a workspace image for .canvas file nodes as a data URL.
// ponytail: whole-file base64 over IPC — fine for note-sized images; switch to a custom protocol if galleries get huge.
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' };
ipcMain.handle('views:file', (_event, relativePath: string) => {
  const resolved = resolveInRepo(relativePath);
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

// Pull Chrome's cookies into the in-app browser's persistent session so the
// user stays logged in without signing in again.
ipcMain.handle('cookies:import-chrome', (_event, domain?: string) =>
  importChromeCookies(session.fromPartition('persist:neuron-browser'), domain),
);

ipcMain.handle('terminal:run', async (_event, cmd: string) => {
  const dir = activeRepoPath() || process.cwd();
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
let windowPtyId: number | null = null;
let nextPtyId = 1;

const defaultShell = () =>
  process.platform === 'win32'
    ? process.env.COMSPEC || 'cmd.exe'
    : process.env.SHELL || '/bin/bash';

function killAllPtys() {
  for (const p of ptys.values()) {
    try { p.kill(); } catch { /* already gone */ }
  }
  ptys.clear();
  ptyHistory.clear();
  windowPtyId = null;
}

ipcMain.handle('terminal:spawn', (_event, opts: { cols?: number; rows?: number } = {}) => {
  if (windowPtyId != null) {
    const existing = ptys.get(windowPtyId);
    if (existing) {
      try {
        existing.resize(Math.max(1, opts.cols ?? 80), Math.max(1, opts.rows ?? 24));
        return windowPtyId;
      } catch { /* pty closed; replace it below */ }
    }
    ptys.delete(windowPtyId);
    ptyHistory.delete(windowPtyId);
    windowPtyId = null;
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
      cwd: activeRepoPath() || process.cwd(),
      env: process.env as { [key: string]: string },
    });
  } catch (error) {
    throw new Error(`could not start ${defaultShell()}: ${(error as Error).message}`);
  }
  ptys.set(id, proc);
  ptyHistory.set(id, '');
  windowPtyId = id;
  proc.onData((data) => {
    const history = (ptyHistory.get(id) ?? '') + data;
    ptyHistory.set(id, history.length > TERMINAL_HISTORY_LIMIT ? history.slice(-TERMINAL_HISTORY_LIMIT) : history);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:data', id, data);
  });
  proc.onExit(({ exitCode }) => {
    ptys.delete(id);
    ptyHistory.delete(id);
    if (windowPtyId === id) windowPtyId = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:exit', id, exitCode);
  });
  return id;
});

ipcMain.handle('terminal:history', (_event, id: number) => ptyHistory.get(id) ?? '');

ipcMain.handle('terminal:write', (_event, id: number, data: string) => {
  try { ptys.get(id)?.write(data); } catch { /* pty closed */ }
});

ipcMain.handle('terminal:resize', (_event, id: number, cols: number, rows: number) => {
  try { ptys.get(id)?.resize(Math.max(1, cols), Math.max(1, rows)); } catch { /* pty closed */ }
});

ipcMain.handle('terminal:kill', (_event, id: number) => {
  const proc = ptys.get(id);
  if (proc) { try { proc.kill(); } catch { /* already gone */ } ptys.delete(id); }
});

// ==========================================================================
// IPC — privileged network + AI (routed through main to avoid CORS and to
// keep API keys out of the renderer bundle). Used by plugins.
// ==========================================================================

interface AiMessage { role: 'user' | 'assistant'; content: string }

ipcMain.handle(
  'ai:complete',
  async (
    _event,
    request: { provider: string; pluginId?: string; model?: string; system?: string; messages: AiMessage[]; config?: Record<string, string> },
  ) => {
    // Non-secret settings only -- baseUrl, model. An apiKey arriving from the
    // renderer is destructured off and dropped: trusting one is what let every
    // plugin read every other plugin's key. The real key is read here, from a
    // store the renderer cannot see.
    const { apiKey: _rendererSuppliedKey, ...config } = request.config ?? {};
    const apiKey = request.pluginId ? readSecret(request.pluginId, 'apiKey') : null;

    const needsKey = (label: string) =>
      ({ success: false, error: `Add ${label} API key in the plugin settings.` });

    try {
      let model;
      switch (request.provider) {
        case 'anthropic': {
          if (!apiKey) return needsKey('an Anthropic');
          model = createAnthropic({ apiKey })(request.model || 'claude-opus-4-8');
          break;
        }
        case 'openai': {
          if (!apiKey) return needsKey('an OpenAI');
          model = createOpenAI({ apiKey })(request.model || 'gpt-4o');
          break;
        }
        case 'google': {
          if (!apiKey) return needsKey('a Google');
          model = createGoogleGenerativeAI({ apiKey })(request.model || 'gemini-2.0-flash');
          break;
        }
        case 'openrouter': {
          if (!apiKey) return needsKey('an OpenRouter');
          model = createOpenRouter({ apiKey })(request.model || 'openai/gpt-4o');
          break;
        }
        case 'local': {
          // A local endpoint is whatever the user is running -- Ollama, LM
          // Studio, their own box -- so the base URL is theirs to set and a key
          // is usually absent. Never hardcode a vendor here.
          model = createOpenAICompatible({
            name: 'local',
            baseURL: config.baseUrl || 'http://localhost:11434/v1',
            apiKey: apiKey ?? 'local',
          })(request.model || config.model || 'llama3');
          break;
        }
        default:
          return { success: false, error: `Unknown AI provider "${request.provider}".` };
      }

      const { text } = await generateText({
        model,
        system: request.system,
        messages: request.messages,
        maxOutputTokens: 2048,
      });
      return { success: true, text };
    } catch (err: unknown) {
      // Provider errors carry request context and sometimes the key itself.
      // Surface the message only, never the object.
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },
);

ipcMain.handle(
  'plugin:net-request',
  async (_event, req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
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
// IPC — error ledger (.agents/errors.json)
// ==========================================================================

ipcMain.handle(
  'notes:log-error',
  async (_event, errorData: { phase: string; error_message: string; stack_trace: string; remediation_step: string }) => {
    try {
      const errorFile = path.join(process.cwd(), '.agents', 'errors.json');
      let errors: unknown[] = [];
      if (fs.existsSync(errorFile)) {
        const content = fs.readFileSync(errorFile, 'utf-8').trim();
        if (content) errors = JSON.parse(content);
      }
      errors.push({ timestamp: new Date().toISOString(), ...errorData });
      fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2), 'utf-8');
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to log error to ledger:', err);
      return { success: false, error: message };
    }
  },
);

// ==========================================================================
// Security — harden every web-contents, especially the in-app browser
// <webview>. The main process is the authoritative gate: renderer-set webview
// options can't weaken these.
// ==========================================================================

app.on('web-contents-created', (_event, contents) => {
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
    const allowed = isAppContent(url);
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
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

initHtmxViews({
  getRepoRoot: activeRepoPath,
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

app.on('ready', () => {
  configureWriteJournal(app.getPath('userData'));
  ensureDefaultRepo();
  createWindow();
  // GitHub-backed auto-update for NSIS builds. Store builds
  // (process.windowsStore) update through the Store, so skip them; dev skips too.
  if (app.isPackaged && app.getName() === 'neuron' && !(process as NodeJS.Process & { windowsStore?: boolean }).windowsStore) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('Update check failed:', err));
  }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
