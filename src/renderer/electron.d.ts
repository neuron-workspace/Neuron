import type { SettingsSection } from '../main/workspace-windows';
import type { WorkspaceEntries } from '../main/workspace-walk';

export type { WorkspaceEntries };

export interface RepositoryInfo {
  path: string;
  name: string;
  cloud: boolean;
}

/** A workspace in a window's list: Recent in a workspace window, every known one in Settings. */
export interface RecentWorkspace extends RepositoryInfo {
  /** Its folder is not there now (moved, deleted, or on a drive that is not connected). */
  missing: boolean;
  /** Settings only: the workspace whose window opened Settings, while that window shows it. */
  isOpener: boolean;
}

/**
 * A workspace template: a folder that gets copied into wherever the user picks.
 * Adding one means dropping a directory into `examples/` — there is no registry
 * to keep in step.
 */
export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  source: string;
  noteCount: number;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiCompleteRequest {
  /** A connector id. Main answers with that connector's stored settings; the key itself never crosses IPC. */
  provider: string;
  model?: string;
  system?: string;
  messages: AiMessage[];
}

export interface AiCompleteResult {
  success: boolean;
  text?: string;
  error?: string;
}

export interface NetRequestResult {
  success: boolean;
  status?: number;
  body?: string;
  error?: string;
}

/** Result of opening an HTMX view: ready to render, awaiting approval, or failed. */
export interface JournalEntry {
  id: string;
  relativePath: string;
  operation: 'overwrite' | 'delete';
  createdAt: number;
  originalBytes: number;
  state: 'captured' | 'skipped';
  skipReason?: 'file-too-large';
}

export type HtmxViewOpenResult =
  | { status: 'ready'; sessionId: string; url: string; partition: string; name: string }
  | { status: 'needs-approval'; name: string; permissions: string[]; description?: string; readPaths: string[]; writePaths: string[] }
  | { status: 'error'; message: string };

/** Whether the toolbar should be hidden for native full screen. */
export interface WindowChromeState {
  fullScreen: boolean;
}

export interface ElectronAPI {
  /** The host main is running on, straight from `process.platform`. */
  platform: NodeJS.Platform;
  diagnostics: {
    openLogs(): Promise<{ success: boolean; error?: string }>;
  };

  // Notes
  listNotes: () => Promise<string[]>;
  /** Every file and folder in the workspace, notes or not. */
  listEntries: () => Promise<WorkspaceEntries>;
  /** Show a workspace file in the system file manager. Never opens it. */
  revealInFolder: (relativePath: string) => Promise<{ success: boolean }>;
  /** A neuron-file:// URL for a workspace image, video or audio file ('' without a workspace). */
  fileUrl: (relativePath: string) => string;
  /** A file or folder appeared or went away. */
  onWorkspaceChanged: (callback: () => void) => () => void;
  /** The workspace watcher stopped: the system ran out of folder watches or file handles. */
  onWatchLimit: (callback: () => void) => () => void;
  /** A file's text, or a message starting "Error:" (TOO_LARGE_TO_OPEN past 25 MB for a note or document). */
  readNote: (relativePath: string) => Promise<string>;
  writeNote: (relativePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  deleteNote: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  createSection: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  getNotesDirectory: () => Promise<string | null>;
  logError: (errorData: {
    phase: 'COMPILATION' | 'RUNTIME' | 'IPC';
    error_message: string;
    stack_trace: string;
    remediation_step: string;
  }) => Promise<{ success: boolean; error?: string }>;
  /** A note or Neuron document changed on disk, or a text file (JSON, YAML, ...), which is not a note; or anything went away. */
  onNotesChanged: (callback: (event: 'add' | 'change' | 'unlink', path: string) => void) => () => void;

  // Repository
  repository: {
    getCurrent: () => Promise<RepositoryInfo | null>;
    listRecent: () => Promise<RecentWorkspace[]>;
    create: () => Promise<RepositoryInfo | null>;
    open: () => Promise<RepositoryInfo | null>;
    switch: (dir: string) => Promise<{ success: boolean; error?: string; repository?: RepositoryInfo }>;
    setName: (dir: string, name: string) => Promise<{ success: boolean; repository: RepositoryInfo }>;
    remove: (dir: string) => Promise<{ success: boolean; clearedActive: boolean }>;
    reveal: (dir: string) => Promise<{ success: boolean }>;
    onChanged: (callback: (repo: RepositoryInfo | null) => void) => () => void;
  };

  templates: {
    list: () => Promise<WorkspaceTemplate[]>;
    /** null if the user cancelled the folder picker. */
    create: (templateId: string) => Promise<{ repository?: RepositoryInfo; error?: string } | null>;
  };

  // Window controls
  windowControls: {
    setOverlayColors: (colors: { color: string; symbolColor: string }) => Promise<void>;
    openPage: (section: SettingsSection) => Promise<{ success: boolean }>;
    /** Settings is already open and another window asked for this section. Validate before use. */
    onShowSection: (callback: (section: string) => void) => () => void;
    openerWorkspace: () => Promise<RepositoryInfo | null>;
    onMenuCommand: (callback: (command: string) => void) => () => void;
    chromeState: () => Promise<WindowChromeState>;
    toggleFullScreen: () => Promise<void>;
    onChromeStateChanged: (callback: (state: WindowChromeState) => void) => () => void;
  };

  // Settings
  settings: {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<{ success: boolean }>;
    onChanged: (callback: (key: string) => void) => () => void;
    /** Store a secret in the main process. There is no getter, deliberately. */
    setSecret: (scope: string, field: string, value: string) => Promise<{ success: boolean; error?: string }>;
    hasSecret: (scope: string, field: string) => Promise<boolean>;
  };

  // Privileged plugin capabilities
  ai: {
    complete: (request: AiCompleteRequest) => Promise<AiCompleteResult>;
  };
  net: {
    request: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => Promise<NetRequestResult>;
  };
  terminal: {
    /**
     * Attach to the terminal named by `key`, starting a shell if it has none.
     * The same key returns the same shell; a new key is a new terminal.
     */
    spawn: (opts: { cols?: number; rows?: number; key?: string }) => Promise<number>;
    history: (id: number) => Promise<string>;
    write: (id: number, data: string) => Promise<void>;
    resize: (id: number, cols: number, rows: number) => Promise<void>;
    /** ConPTY details on Windows, for xterm's `windowsPty` option; null elsewhere. */
    windowsPty: () => Promise<{ backend: 'conpty'; buildNumber: number } | null>;
    kill: (id: number) => Promise<void>;
    onData: (callback: (id: number, data: string) => void) => () => void;
    onExit: (callback: (id: number, exitCode: number) => void) => () => void;
  };
  htmxViews: {
    open: (relativePath: string, theme?: 'light' | 'dark') => Promise<HtmxViewOpenResult>;
    approve: (relativePath: string, scope: 'always' | 'once') => Promise<{ success: boolean; error?: string }>;
    close: (sessionId: string) => Promise<{ success: boolean }>;
    resetApproval: (relativePath: string) => Promise<{ success: boolean }>;
  };
  journal: {
    list: (relativePath?: string) => Promise<JournalEntry[]>;
    restore: (entryId: string) => Promise<{ success: boolean; error?: string }>;
  };
  cookies: {
    importChrome: (domain: string) => Promise<{ success: boolean; imported?: number; skipped?: number; error?: string }>;
  };
}


declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
