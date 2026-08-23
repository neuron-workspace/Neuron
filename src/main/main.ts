import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import { autoUpdater } from 'electron-updater';
import { importChromeCookies } from './chrome-cookies';
import { initHtmxViews, getViewServerOrigin, revokeAllViewSessions } from './htmx';
import { DEV_URL, isAppContent, isSameOrigin } from './navigation';
import { capturePreImage, configureWriteJournal, listJournalEntries, restoreJournalEntry } from './journal';
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
    frame: false, // custom in-app title bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // enables in-app browser tabs (<webview>)
    },
    backgroundColor: '#11181c',
  });

  mainWindow.setMenuBarVisibility(false);

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  const emitMaxState = () => {
    if (mainWindow) mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', emitMaxState);
  mainWindow.on('unmaximize', emitMaxState);

  mainWindow.on('closed', () => {
    killAllPtys();
    mainWindow = null;
  });

  setupWatcher();
}

// ==========================================================================
// IPC — window controls
// ==========================================================================

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);

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
// IPC — interactive PTY terminals (node-pty). One pty per renderer terminal;
// output is streamed back over `terminal:data`. Used by the terminal panel.
// ==========================================================================

const ptys = new Map<number, pty.IPty>();
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
}

ipcMain.handle('terminal:spawn', (_event, opts: { cols?: number; rows?: number } = {}) => {
  const id = nextPtyId++;
  const proc = pty.spawn(defaultShell(), [], {
    name: 'xterm-color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: activeRepoPath() || process.cwd(),
    env: process.env as { [key: string]: string },
  });
  ptys.set(id, proc);
  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:data', id, data);
  });
  proc.onExit(({ exitCode }) => {
    ptys.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:exit', id, exitCode);
  });
  return id;
});

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
    try {
      // Non-secret settings only -- baseUrl, model. An apiKey arriving from the
      // renderer is dropped rather than used: trusting one is what made every
      // plugin able to read every other plugin's key. The real key is read here,
      // from a store the renderer cannot see.
      const { apiKey: _rendererSuppliedKey, ...config } = request.config ?? {};
      const apiKey = request.pluginId ? readSecret(request.pluginId, 'apiKey') : null;
      if (request.provider === 'anthropic') {
        if (!apiKey) return { success: false, error: 'Add an Anthropic API key in the plugin settings.' };
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: request.model || 'claude-opus-4-8',
            max_tokens: 2048,
            system: request.system,
            messages: request.messages,
          }),
        });
        const data = (await res.json()) as {
          content?: { type: string; text?: string }[];
          stop_reason?: string;
          error?: { message?: string };
        };
        if (!res.ok) return { success: false, error: data.error?.message || `Request failed (${res.status}).` };
        if (data.stop_reason === 'refusal') {
          return { success: false, error: 'The model declined to respond to this request.' };
        }
        const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        return { success: true, text };
      }

      if (request.provider === 'local') {
        // Local model endpoint (e.g. Ollama). Expects an OpenAI-style chat response.
        const endpoint = config.endpoint || 'http://localhost:11434/v1/chat/completions';
        const messages = request.system
          ? [{ role: 'system', content: request.system }, ...request.messages]
          : request.messages;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: request.model || config.model || 'llama3', messages, stream: false }),
        });
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
          message?: { content?: string };
          error?: { message?: string } | string;
        };
        if (!res.ok) {
          const message = typeof data.error === 'string' ? data.error : data.error?.message;
          return { success: false, error: message || `Local model request failed (${res.status}).` };
        }
        const text = data.choices?.[0]?.message?.content ?? data.message?.content ?? '';
        return { success: true, text };
      }

      if (request.provider === 'openai') {
        if (!apiKey) return { success: false, error: 'Add an OpenAI API key in the plugin settings.' };
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: request.model || 'gpt-4o',
            messages: request.system
              ? [{ role: 'system', content: request.system }, ...request.messages]
              : request.messages,
          }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) return { success: false, error: data.error?.message || `Request failed (${res.status}).` };
        const text = data.choices?.[0]?.message?.content ?? '';
        return { success: true, text };
      }

      if (request.provider === 'google') {
        if (!apiKey) return { success: false, error: 'Add a Gemini API key in the plugin settings.' };
        const model = request.model || 'gemini-1.5-flash';
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: request.messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
            systemInstruction: request.system ? {
              parts: [{ text: request.system }]
            } : undefined,
          }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) return { success: false, error: data.error?.message || `Request failed (${res.status}).` };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return { success: true, text };
      }

      if (request.provider === 'openrouter') {
        if (!apiKey) return { success: false, error: 'Add an OpenRouter API key in the plugin settings.' };
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://github.com/GoogleDeepMind/neuron',
            'X-Title': 'Neuron',
          },
          body: JSON.stringify({
            model: request.model || 'google/gemini-2.5-flash',
            messages: request.system
              ? [{ role: 'system', content: request.system }, ...request.messages]
              : request.messages,
          }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) return { success: false, error: data.error?.message || `Request failed (${res.status}).` };
        const text = data.choices?.[0]?.message?.content ?? '';
        return { success: true, text };
      }

      return { success: false, error: `Unknown AI provider "${request.provider}".` };
    } catch (err: unknown) {
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
