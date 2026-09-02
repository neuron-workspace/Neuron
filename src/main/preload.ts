import { contextBridge, ipcRenderer } from 'electron';

interface RepositoryInfo { path: string; name: string; cloud: boolean }
interface AiMessage { role: 'user' | 'assistant'; content: string }

contextBridge.exposeInMainWorld('electronAPI', {
  // The renderer used to sniff this from `navigator.platform`, which is
  // deprecated and describes the browser engine rather than the host. This is
  // the value main actually runs on. A plain string, not the `process` object:
  // exposing that across the bridge would hand the renderer far more than the
  // one fact it needs.
  platform: process.platform,
  // Notes
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (relativePath: string) => ipcRenderer.invoke('notes:read', relativePath),
  writeNote: (relativePath: string, content: string) => ipcRenderer.invoke('notes:write', relativePath, content),
  deleteNote: (relativePath: string) => ipcRenderer.invoke('notes:delete', relativePath),
  createSection: (relativePath: string) => ipcRenderer.invoke('notes:create-section', relativePath),
  journal: {
    list: (relativePath?: string) => ipcRenderer.invoke('journal:list', relativePath),
    restore: (entryId: string) => ipcRenderer.invoke('journal:restore', entryId),
  },
  getNotesDirectory: () => ipcRenderer.invoke('notes:get-dir'),
  logError: (errorData: { phase: string; error_message: string; stack_trace: string; remediation_step: string }) =>
    ipcRenderer.invoke('notes:log-error', errorData),
  onNotesChanged: (callback: (event: 'add' | 'change' | 'unlink', path: string) => void) => {
    const listener = (_event: unknown, type: 'add' | 'change' | 'unlink', path: string) => callback(type, path);
    ipcRenderer.on('notes:changed', listener);
    return () => ipcRenderer.removeListener('notes:changed', listener);
  },

  // Repository
  repository: {
    getCurrent: () => ipcRenderer.invoke('repository:get-current'),
    listRecent: () => ipcRenderer.invoke('repository:list-recent'),
    create: () => ipcRenderer.invoke('repository:create'),
    open: () => ipcRenderer.invoke('repository:open'),
    switch: (dir: string) => ipcRenderer.invoke('repository:switch', dir),
    setName: (dir: string, name: string) => ipcRenderer.invoke('repository:set-name', dir, name),
    remove: (dir: string) => ipcRenderer.invoke('repository:remove', dir),
    reveal: (dir: string) => ipcRenderer.invoke('repository:reveal', dir),
    onChanged: (callback: (repo: RepositoryInfo) => void) => {
      const listener = (_event: unknown, repo: RepositoryInfo) => callback(repo);
      ipcRenderer.on('repository:changed', listener);
      return () => ipcRenderer.removeListener('repository:changed', listener);
    },
  },

  // Workspace templates — a template is a folder under `examples`, copied into
  // wherever the user chooses.
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    create: (templateId: string) => ipcRenderer.invoke('templates:create', templateId),
  },

  // Window controls
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    // Was a bare "is it maximised" boolean. That was not enough to draw the
    // chrome correctly: full screen needs different treatment from maximised on
    // both platforms, and conflating them is what left a gap across the top of
    // a full-screen window on Windows.
    // Menu items the macOS application menu owns but the renderer performs.
    // Clicking "Search & Commands…" has to reach the palette; the keystroke
    // itself is deliberately left to the page, so this carries only clicks.
    onMenuCommand: (callback: (command: string) => void) => {
      const listener = (_event: unknown, command: string) => callback(command);
      ipcRenderer.on('menu:command', listener);
      return () => ipcRenderer.removeListener('menu:command', listener);
    },
    chromeState: () => ipcRenderer.invoke('window:chrome-state'),
    onChromeStateChanged: (callback: (state: { inset: boolean; fullScreen: boolean }) => void) => {
      const listener = (_event: unknown, state: { inset: boolean; fullScreen: boolean }) => callback(state);
      ipcRenderer.on('window:chrome-state-changed', listener);
      return () => ipcRenderer.removeListener('window:chrome-state-changed', listener);
    },
  },

  // Settings (generic key/value for plugin config + state)
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    // Write-only by design: a secret can be stored and its presence checked,
    // never read back into the renderer.
    setSecret: (scope: string, field: string, value: string) => ipcRenderer.invoke('settings:set-secret', scope, field, value),
    hasSecret: (scope: string, field: string) => ipcRenderer.invoke('settings:has-secret', scope, field),
  },

  // Privileged plugin capabilities
  ai: {
    complete: (request: { provider: string; model?: string; system?: string; messages: AiMessage[]; config?: Record<string, string> }) =>
      ipcRenderer.invoke('ai:complete', request),
  },
  net: {
    request: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) =>
      ipcRenderer.invoke('plugin:net-request', req),
  },
  terminal: {
    run: (cmd: string) => ipcRenderer.invoke('terminal:run', cmd),
    // `key` names the terminal, not the shell: reattaching with the same key
    // returns the same shell and its scrollback, and a new key is a new
    // terminal with its own.
    spawn: (opts: { cols?: number; rows?: number; key?: string }) => ipcRenderer.invoke('terminal:spawn', opts),
    history: (id: number) => ipcRenderer.invoke('terminal:history', id),
    write: (id: number, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: number, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: number) => ipcRenderer.invoke('terminal:kill', id),
    onData: (callback: (id: number, data: string) => void) => {
      const listener = (_event: unknown, id: number, data: string) => callback(id, data);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
    onExit: (callback: (id: number, exitCode: number) => void) => {
      const listener = (_event: unknown, id: number, exitCode: number) => callback(id, exitCode);
      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.removeListener('terminal:exit', listener);
    },
  },
  views: {
    file: (relativePath: string) => ipcRenderer.invoke('views:file', relativePath),
  },
  htmxViews: {
    open: (relativePath: string, theme?: 'light' | 'dark') => ipcRenderer.invoke('htmx-views:open', relativePath, theme),
    approve: (relativePath: string, scope: 'always' | 'once') => ipcRenderer.invoke('htmx-views:approve', relativePath, scope),
    close: (sessionId: string) => ipcRenderer.invoke('htmx-views:close', sessionId),
    resetApproval: (relativePath: string) => ipcRenderer.invoke('htmx-views:reset-approval', relativePath),
  },
  cookies: {
    importChrome: (domain?: string) => ipcRenderer.invoke('cookies:import-chrome', domain),
  },
});
