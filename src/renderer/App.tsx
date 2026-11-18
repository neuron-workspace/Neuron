import { cn } from './lib/utils';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eye, FileCode2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import MDXPreview from './components/MDXPreview';
import { CalloutIcon } from './components/mdx-components';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import Workbench from './components/Workbench';
import FloatingGraph from './components/FloatingGraph';
import RepositoryOnboarding from './components/RepositoryOnboarding';
import { nextUntitled } from './lib/untitled';
import { NEW_FILE_KINDS, startingCompanions, startingContent } from './lib/new-file';
import { isCsvPath, tableMetaPath } from './lib/csv-table';
import { closeTab as closeTabIn, EMPTY_TABS, keepTab, openTab, removeMissing, type TabState } from './lib/tabs';
import { noteTags } from './lib/note-tags';
import CommandPalette from './components/CommandPalette';
import NoteTabs from './components/NoteTabs';
import SettingsWindow from './views/SettingsWindow';
import WorkspaceSettingsDialog, { type WorkspaceSettingsSection } from './views/WorkspaceSettingsDialog';
import { workspaceApps } from './views/PluginsPage';
import type { SettingsSection } from '../main/workspace-windows';
import ComponentGallery from './views/ComponentGallery';
import { TooltipProvider } from './components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { PluginProvider, usePlugins } from './plugins/host';
import { builtinPlugins } from './plugins/builtin';
import { getSurface } from './surfaces';
import LayoutSurface from './surfaces/LayoutSurface';
import './surfaces/HtmxViewSurface'; // registers the .html view surface
import './surfaces/DbSurface'; // registers the .db database surface
import './surfaces/CanvasSurface'; // registers the .canvas JSON Canvas surface
import './surfaces/MermaidSurface'; // registers the Mermaid diagram surface
import './surfaces/CsvSurface'; // registers the .csv table surface
import { SurfaceBoundary } from './surfaces/SurfaceBoundary';
import { EDIT_MODES, EDITOR_MODE_SLOT, type EditMode } from './surfaces/panels';
import { Segmented } from './components/ui/segmented';
import BrowserView from './components/BrowserView';
import { DEFAULT_BINDINGS, eventToChord, resolveBindings, type Bindings } from './lib/keybindings';
import { DEFAULT_LAYOUT, resolveLayout, resolveSavedLayouts, sameLayout, SEED_LAYOUTS, workspacePanelsPatch, type SavedLayout, type WorkbenchLayout } from './lib/layout';
import { hasLayoutTree, parseWorkspacePanels, sameJson } from './surfaces/layout';
import LayoutSwitcher from './components/LayoutSwitcher';
import SideNote from './components/SideNote';
import { Panel as SplitPanel, PanelGroup as SplitGroup, PanelResizeHandle as SplitHandle } from 'react-resizable-panels';
import WorkspaceExplorer from './views/WorkspaceExplorer';
import { ExplorerProvider } from './lib/explorer-state';
import {
  addRecent, pruneRecents, recentsKey, resolveRecents, type RecentEntry,
} from './lib/workspace-explorer';
import { registerTerminalOpener } from './lib/terminal-bus';
import { useTerminalToggle } from './lib/useTerminalToggle';
import { type SidebarMode } from './components/ActivityRail';

/** Hands the terminal toggle to the global shortcut handler. Renders nothing. */
function TerminalShortcut({ toggleRef, layout, onLayoutChange, onOpenPlugins }: { toggleRef: { current: (() => void) | null }; layout: WorkbenchLayout; onLayoutChange: (patch: Partial<WorkbenchLayout>) => void; onOpenPlugins: () => void }) {
  const { toggle } = useTerminalToggle(layout, onLayoutChange, onOpenPlugins);
  toggleRef.current = toggle;
  return null;
}

/**
 * Applies the sidebar and terminal settings of .neuron/layout.json once the
 * stored layout and the plugin panels are both in, then reports it is done.
 * Renders nothing; it lives inside PluginProvider to see the panel list.
 */
function WorkspacePanelsApplier({ content, layoutReady, layout, onLayoutChange, onDone }: { content: string | null; layoutReady: boolean; layout: WorkbenchLayout; onLayoutChange: (patch: Partial<WorkbenchLayout>) => void; onDone: () => void }) {
  const { panels, panelsReady } = usePlugins();
  useEffect(() => {
    if (content === null || !layoutReady || !panelsReady) return;
    const patch = workspacePanelsPatch(panels, layout, parseWorkspacePanels(content));
    if (patch) onLayoutChange(patch);
    onDone();
  }, [content, layoutReady, panelsReady, panels, layout, onLayoutChange, onDone]);
  return null;
}

interface PropertiesSettings { removeEmpty: boolean; showInReading: boolean; collapsedByDefault: boolean }
const DEFAULT_PROPERTIES_SETTINGS: PropertiesSettings = { removeEmpty: true, showInReading: true, collapsedByDefault: false };

const isUrl = (s: string | null): s is string => !!s && /^https?:\/\//.test(s);

// The workspace's own config lives in a .neuron folder at the workspace root.
const SHELL_CONFIG = '.neuron/layout.json';
const notInConfig = (path: string) => path !== '.neuron' && !path.startsWith('.neuron/');
const NO_FILES: string[] = [];
import type { RepositoryInfo, WorkspaceEntries } from './electron.d';
import { applyTheme, DEFAULT_APPEARANCE, normalizeAppearance, PRESETS, type Appearance } from './lib/theme';

interface NoteData { path: string; content: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
// Settings, Plugins and Workspaces are sections of the Settings window, so the
// main area always shows something the sidebar's Files, Tags and Graph act on.
type View = 'notes' | 'gallery';
// The same three modes the layout shell offers, under the same names. This was
// 'raw' here and 'split' there, presented as a dropdown here and a button row
// there, so the identical choice looked and read like two different features
// depending on whether the workspace happened to have a layout.json.
type EditorMode = EditMode;

// Default content for new .html views. Plain HTML + htmx attributes;
// Neuron serves it from the local view server with the neuron-view stylesheet.
const HTMX_VIEW_TEMPLATE = `<h1>New HTMX view</h1>
<p>This is ordinary HTML with <a href="https://htmx.org">htmx</a> attributes.
It talks to Neuron's local API — see <code>GET /api/v1/context</code>.</p>

<section class="neuron-grid cols-3">
  <div class="neuron-card" hx-get="/api/v1/fragments/workspace-summary" hx-trigger="load" hx-swap="innerHTML">
    Loading…
  </div>
</section>

<section class="neuron-card">
  <form hx-get="/api/v1/search" hx-target="#search-results"
        hx-trigger="submit, input changed delay:300ms from:#query">
    <label for="query">Search notes</label>
    <input id="query" class="neuron-input" name="query" type="search" autocomplete="off" />
  </form>
  <div id="search-results"></div>
</section>
`;

const NEURON_CONFIG_TEMPLATE = `{
  "direction": "horizontal",
  "children": [
    { "size": 20, "panel": { "type": "tree" } },
    { "size": 52, "group": { "direction": "vertical", "children": [
      { "size": 70, "panel": { "type": "editor" } },
      { "size": 30, "panel": { "type": "terminal" } }
    ] } },
    { "size": 28, "panel": { "type": "graph", "scope": "active", "title": "Linked notes" } }
  ]
}
`;

export default function App() {
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [recents, setRecents] = useState<RepositoryInfo[]>([]);
  const [repoReady, setRepoReady] = useState(false);

  const [notes, setNotes] = useState<string[]>([]);
  // The open tabs, which one is the preview, and which one is showing: one
  // state, because each change to the strip moves more than one of them.
  const [tabState, setTabState] = useState<TabState>(EMPTY_TABS);
  const { tabs: openTabs, preview: previewTab, selected: selectedNote } = tabState;
  const [noteContent, setNoteContent] = useState('');
  const [notesData, setNotesData] = useState<NoteData[]>([]);
  const [entries, setEntries] = useState<WorkspaceEntries | null>(null);
  const [view, setView] = useState<View>('notes');
  const [editorModes, setEditorModes] = useState<Record<string, EditorMode>>({});
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);

  // The workspace explorer.
  //
  // `atHome` is deliberately its own flag rather than being inferred from
  // `selectedNote === null`. Having no file open implies the explorer, but the
  // reverse is not true: opening a new tab must show it WITHOUT
  // closing anyone's tabs, so home has to be a place you can navigate to while
  // a note is still open. Conflating the two is how the explorer either refuses
  // to appear or refuses to go away.
  const [atHome, setAtHome] = useState(false);
  const [explorerFolder, setExplorerFolder] = useState('');
  // listNotes returns files only; retain newly created empty directories per workspace.
  const [createdFolders, setCreatedFolders] = useState<string[]>([]);
  const foldersLoadedFor = useRef<string | null>(null);
  const [revealedFolder, setRevealedFolder] = useState<string | null>(null);
  const creatingUntitled = useRef(false);
  const [explorerRecents, setExplorerRecents] = useState<RecentEntry[]>([]);

  // Workbench layout: which shell regions are visible. Persisted per user.
  const [layout, setLayout] = useState<WorkbenchLayout>(DEFAULT_LAYOUT);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('files');
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const zenPrevRef = useRef<WorkbenchLayout | null>(null);
  const lastEscapeRef = useRef(0);

  const commitLayout = useCallback((next: WorkbenchLayout) => {
    layoutRef.current = next;
    setLayout(next);
    void window.electronAPI?.settings.set('layout', next);
  }, []);

  const patchLayout = useCallback((patch: Partial<WorkbenchLayout>) => {
    const prev = layoutRef.current;
    let next = { ...prev, ...patch };
    if (patch.zen === true && !prev.zen) {
      // Entering zen: hide the chrome, remember what to restore.
      zenPrevRef.current = prev;
      next = { ...next, activityBar: false, sidebar: false, leftPanel: false, rightPanel: false, bottomPanel: false };
    } else if (patch.zen === false && prev.zen) {
      next = { ...(zenPrevRef.current ?? DEFAULT_LAYOUT), zen: false };
    }
    commitLayout(next);
  }, [commitLayout]);

  // The workspace's starting arrangement waits for this, or the stored layout
  // arriving afterwards would replace it.
  const [layoutReady, setLayoutReady] = useState(!window.electronAPI);
  useEffect(() => {
    void window.electronAPI?.settings.get<Partial<WorkbenchLayout>>('layout').then((stored) => {
      if (stored) setLayout(resolveLayout(stored));
      setLayoutReady(true);
    }).catch(() => setLayoutReady(true));
    void window.electronAPI?.settings.get<Partial<PropertiesSettings>>('properties').then((stored) => {
      if (stored) setPropsSettings({ ...DEFAULT_PROPERTIES_SETTINGS, ...stored });
    });
  }, []);

  // Settings is about the app, not this workspace, so it opens in a window of
  // its own. There is no in-page fallback: without the bridge there is no app.
  const remoteAppearance = useRef<string | null>(null);
  const utilityWindow = useMemo(() => (new URLSearchParams(window.location.search).get('window') === 'settings' ? 'settings' : null), []);
  const openSettings = useCallback((section: SettingsSection) => {
    void window.electronAPI?.windowControls?.openPage(section);
  }, []);
  // Plugins are switched on per workspace, so they are set in this window.
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettingsSection | null>(null);
  const openPlugins = useCallback(() => setWorkspaceSettings('plugins'), []);
  // Another window changed a shared setting: take the new value.
  useEffect(() => window.electronAPI?.settings.onChanged?.((key) => {
    if (key === 'appearance') void window.electronAPI.settings.get<Appearance>('appearance').then((stored) => { const next = normalizeAppearance(stored); remoteAppearance.current = JSON.stringify(next); applyTheme(next); setAppearance(next); });
    if (key === 'keybindings') void window.electronAPI.settings.get<Bindings>('keybindings').then((stored) => setBindings(resolveBindings(stored)));
    if (key === 'properties') void window.electronAPI.settings.get<Partial<PropertiesSettings>>('properties').then((stored) => { if (stored) setPropsSettings({ ...DEFAULT_PROPERTIES_SETTINGS, ...stored }); });
  }), []);

  const updatePropsSettings = useCallback((next: PropertiesSettings) => {
    setPropsSettings(next);
    void window.electronAPI?.settings.set('properties', next);
  }, []);

  const sidebarOpen = layout.sidebar;
  const rightPanelOpen = layout.rightPanel;
  const bottomPanelOpen = layout.bottomPanel;
  // Saved layouts: named arrangements to switch between. Structure only; open
  // notes and unsaved edits are untouched by switching.
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([
      window.electronAPI?.settings.get<unknown>('savedLayouts'),
      window.electronAPI?.settings.get<unknown>('activeLayoutId'),
    ]).then(([stored, active]) => {
      // Seed only a profile that has never had the key; an emptied list stays empty.
      const list = stored == null ? SEED_LAYOUTS : resolveSavedLayouts(stored);
      if (stored == null) void window.electronAPI?.settings.set('savedLayouts', list);
      setSavedLayouts(list);
      setActiveLayoutId(typeof active === 'string' && list.some((l) => l.id === active) ? active : null);
    });
  }, []);
  const storeLayouts = (list: SavedLayout[], active: string | null) => {
    setSavedLayouts(list); setActiveLayoutId(active);
    void window.electronAPI?.settings.set('savedLayouts', list);
    void window.electronAPI?.settings.set('activeLayoutId', active);
  };
  const snapshotLayout = (): WorkbenchLayout => ({ ...layoutRef.current, zen: false });
  const applySavedLayout = (id: string) => {
    const saved = savedLayouts.find((l) => l.id === id);
    if (!saved) return;
    zenPrevRef.current = null;
    commitLayout(resolveLayout(saved.layout));
    storeLayouts(savedLayouts, id);
  };
  const activeSavedLayout = savedLayouts.find((l) => l.id === activeLayoutId) ?? null;
  const layoutSwitcher = (
    <LayoutSwitcher layouts={savedLayouts} activeId={activeLayoutId}
      modified={!!activeSavedLayout && !sameLayout(layout, activeSavedLayout.layout)}
      onApply={applySavedLayout}
      onSave={(name) => { const id = 'layout-' + Date.now().toString(36); storeLayouts([...savedLayouts, { id, name, layout: snapshotLayout() }], id); }}
      onUpdate={() => storeLayouts(savedLayouts.map((l) => (l.id === activeLayoutId ? { ...l, layout: snapshotLayout() } : l)), activeLayoutId)}
      onDelete={(id) => storeLayouts(savedLayouts.filter((l) => l.id !== id), null)}
      onReset={() => { zenPrevRef.current = null; commitLayout({ ...DEFAULT_LAYOUT, panels: {}, activePanels: {} }); }} />
  );
  const setSidebarOpen = (fn: (v: boolean) => boolean) => patchLayout({ sidebar: fn(layoutRef.current.sidebar) });
  const setRightPanelOpen = (fn: ((v: boolean) => boolean) | boolean) => patchLayout({ rightPanel: typeof fn === 'boolean' ? fn : fn(layoutRef.current.rightPanel) });
  const graphOverlayOpen = layout.graphOverlay;
  const toggleGraphOverlay = () => patchLayout({ graphOverlay: !layoutRef.current.graphOverlay });
  // The graph floats over the notes view. Asked for from the component gallery,
  // it brings the notes back rather than turning on where it cannot be seen.
  const showOrToggleGraph = () => {
    if (view === 'notes') { toggleGraphOverlay(); return; }
    setView('notes');
    if (!layoutRef.current.graphOverlay) patchLayout({ graphOverlay: true });
  };
  const setBottomPanelOpen = (fn: ((v: boolean) => boolean) | boolean) => patchLayout({ bottomPanel: typeof fn === 'boolean' ? fn : fn(layoutRef.current.bottomPanel) });

  // A <Run /> button in a note reveals the terminal it is about to write to.
  // Running a command into a panel the user cannot see would hide the one part
  // of this that makes it reviewable.
  useEffect(() => registerTerminalOpener(() => {
    const dock = layoutRef.current.panels['terminal:terminal.panel']?.dock ?? 'bottom';
    patchLayout({ [`${dock}Panel`]: true });
  }), [patchLayout]);
  // The plugin list lives below App (inside PluginProvider), so the shortcut
  // reaches the terminal toggle through this ref, filled by <TerminalShortcut />.
  const toggleTerminalRef = useRef<(() => void) | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [wide, setWide] = useState(true);
  const [bindings, setBindings] = useState<Bindings>(DEFAULT_BINDINGS);
  const [surfaceSourceMode, setSurfaceSourceMode] = useState<Record<string, boolean>>({});
  const [shellConfig, setShellConfig] = useState<string | null>(null);
  const [pendingShellConfig, setPendingShellConfig] = useState<string | null>(null);
  // The applied content, readable from the file watcher, and kept in step as it
  // is set so a watcher event for our own write already compares against it.
  const shellConfigRef = useRef<string | null>(null);
  const adoptShellConfig = useCallback((content: string | null) => {
    shellConfigRef.current = content;
    setShellConfig(content);
  }, []);
  // Offer the changed file only when its meaning differs from what is applied.
  const offerShellConfig = useCallback((content: string) => {
    setPendingShellConfig(sameJson(shellConfigRef.current ?? '', content) ? null : content);
  }, []);
  // Content whose sidebar and terminal settings are still to be applied.
  const [workspacePanels, setWorkspacePanels] = useState<string | null>(null);
  const clearWorkspacePanels = useCallback(() => setWorkspacePanels(null), []);
  // Which workspace this window last opened, so its settings apply once per open.
  const openedWorkspace = useRef<string | null>(null);
  // A file holding only the sidebar and terminal keys keeps the notes view.
  const layoutShell = shellConfig && hasLayoutTree(shellConfig) ? shellConfig : null;
  const [propsSettings, setPropsSettings] = useState<PropertiesSettings>(DEFAULT_PROPERTIES_SETTINGS);

  const saveVersion = useRef(0);
  // What the watcher needs to update the open note without fighting the user:
  // which note is open, and whether one of our own writes is still in flight.
  const openNoteRef = useRef<{ path: string | null; saving: boolean }>({ path: null, saving: false });
  const editorRef = useRef<any>(null);
  const browserCounter = useRef(0);

  // --- Appearance -----------------------------------------------------------
  useLayoutEffect(() => {
    applyTheme(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!window.electronAPI) { setAppearanceReady(true); return; }
    let cancelled = false;
    (async () => {
      const stored = await window.electronAPI?.settings.get<Appearance>('appearance');
      if (cancelled) return;
      const next = normalizeAppearance(stored);
      applyTheme(next);
      setAppearance(next);
      setAppearanceReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!appearanceReady || !window.electronAPI) return;
    // A theme another window chose is already saved. Saving it again from here
    // would echo back and could overwrite a newer choice made over there.
    if (remoteAppearance.current === JSON.stringify(appearance)) return;
    void window.electronAPI.settings.set('appearance', appearance).then((result) => {
      if (!result.success) setNotice('Appearance settings could not be saved.');
    });
  }, [appearance, appearanceReady]);

  const handleAppearanceChange = useCallback((next: Appearance) => {
    const normalized = normalizeAppearance(next);
    applyTheme(normalized);
    setAppearance(normalized);
  }, []);

  // --- Repository -----------------------------------------------------------
  const reloadRepoState = useCallback(async () => {
    if (!window.electronAPI) return;
    setRepository(await window.electronAPI.repository.getCurrent());
    setRecents(await window.electronAPI.repository.listRecent());
  }, []);

  useEffect(() => {
    if (!window.electronAPI) { setRepoReady(true); return; }
    (async () => { await reloadRepoState(); setRepoReady(true); })();
    return window.electronAPI.repository.onChanged(() => { void reloadRepoState(); });
  }, [reloadRepoState]);
  const createRepository = useCallback(async () => {
    // The folder may open in its own window, so ask what this window shows now.
    if (await window.electronAPI?.repository.create()) void reloadRepoState();
  }, [reloadRepoState]);
  const openRepository = useCallback(async () => {
    if (await window.electronAPI?.repository.open()) void reloadRepoState();
  }, [reloadRepoState]);
  const switchRepository = useCallback(async (dir: string) => {
    const result = await window.electronAPI?.repository.switch(dir);
    if (result?.success) void reloadRepoState();
  }, [reloadRepoState]);

  // --- Notes ----------------------------------------------------------------
  // Every file and folder, for the tree and the explorer. A failed listing
  // leaves the previous one: it only adds to what notes already show.
  const loadEntries = useCallback(() => window.electronAPI.listEntries().catch(() => null), []);
  const loadNotes = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      // Together, so the sidebar's first collapse sees every folder at once.
      const [fileList, listing] = await Promise.all([window.electronAPI.listNotes(), loadEntries()]);
      setNotes(fileList);
      if (listing) setEntries(listing);
      setTabState((current) => removeMissing(current, fileList));
      // Configuration is reachable in the explorer but is not knowledge: it is
      // not a graph node, it has no wiki-links, its words are not yours, and it
      // should not turn up in a search for something you wrote. `notes` keeps
      // it so it can be opened; `notesData` -- what the graph, tags, search and
      // link index are all built from -- does not. Nor does a CSV: it is data,
      // not a note, and can be far larger than anything worth holding here.
      const data = await Promise.all(
        fileList
          .filter((path) => !path.startsWith('.neuron/') && !isCsvPath(path))
          .map(async (path) => ({ path, content: await window.electronAPI.readNote(path) })),
      );
      setNotesData(data);

    } catch {
      setNotice('Could not load the workspace.');
    }
  }, [loadEntries]);

  useEffect(() => {
    if (!repository) { setNotes([]); setNotesData([]); setEntries(null); setTags([]); setTabState((current) => ({ ...current, selected: null })); return; }
    setEntries(null);
    loadNotes();
  }, [repository, loadNotes]);

  // The watcher says only that something appeared or went away; a burst of
  // those (a folder copied in) becomes one new listing. Coming back to the
  // window asks too: the watcher never reports a new empty folder, and the
  // file manager is where one is usually made.
  useEffect(() => {
    if (!repository || !window.electronAPI?.onWorkspaceChanged) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void loadEntries().then((listing) => { if (listing && !cancelled) setEntries(listing); });
      }, 300);
    };
    const unsubscribe = window.electronAPI.onWorkspaceChanged(refresh);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', refresh); };
  }, [repository, loadEntries]);

  // A preview belongs to the workspace it was opened in. Keyed on the path,
  // because the same workspace re-reported is a new object.
  const repositoryPath = repository?.path ?? null;
  useEffect(() => {
    setTabState((current) => current.preview === null ? current : removeMissing(current, (path) => path !== current.preview));
  }, [repositoryPath]);

  useEffect(() => {
      const allTags = new Set<string>();
      notesData.forEach(note => noteTags(note.content).forEach(tag => allTags.add(tag)));
      setTags(Array.from(allTags).sort((a, b) => a.localeCompare(b)));
  }, [notesData]);

  // Recents are per workspace and per machine, so they live in the settings
  // bridge beside `layout` rather than in a file inside the workspace that
  // would sync someone's browsing history to every other machine.
  useEffect(() => {
    setExplorerFolder('');
    setRevealedFolder(null);
    if (!repository) { setExplorerRecents([]); return; }
    let cancelled = false;
    void window.electronAPI?.settings.get<unknown>(recentsKey(repository.path)).then((stored) => {
      if (!cancelled) setExplorerRecents(resolveRecents(stored));
    });
    return () => { cancelled = true; };
  }, [repository]);

  useEffect(() => {
    if (!repository) return;
    void window.electronAPI?.settings.set(recentsKey(repository.path), explorerRecents);
  }, [repository, explorerRecents]);

  // Paths move and vanish outside the app. Prune against the current listing so
  // a stale entry disappears quietly instead of offering a link that opens
  // nothing -- and compare before setting, or this loops forever.
  useEffect(() => {
    setExplorerRecents((current) => {
      const pruned = pruneRecents(current, explorerAllPaths);
      return pruned.length === current.length ? current : pruned;
    });
  }, [notes, entries]);

  useEffect(() => {
    if (!repository || !window.electronAPI) { adoptShellConfig(null); openedWorkspace.current = null; return; }
    let cancelled = false;
    // This effect also re-runs when the same workspace is merely reloaded; only
    // a newly opened one gets its starting arrangement.
    const opened = openedWorkspace.current !== repository.path;
    void (async () => {
      let content = await window.electronAPI.readNote(SHELL_CONFIG);
      if (content.startsWith('Error:')) {
        // Migrate the legacy root-level neuron.config into .neuron/layout.json.
        const legacy = await window.electronAPI.readNote('neuron.config');
        if (legacy.startsWith('Error:')) {
          if (!cancelled) { adoptShellConfig(null); openedWorkspace.current = repository.path; }
          return;
        }
        if (!cancelled) adoptShellConfig(legacy);
        await window.electronAPI.writeNote(SHELL_CONFIG, legacy);
        content = legacy;
      }
      if (cancelled) return;
      adoptShellConfig(content);
      openedWorkspace.current = repository.path;
      if (opened) setWorkspacePanels(content);
    })();
    return () => { cancelled = true; };
  }, [repository, adoptShellConfig]);

  useEffect(() => {
    if (!window.electronAPI?.onNotesChanged) return;
    let cancelled = false;
    const versions = new Map<string, number>();
    const unsubscribe = window.electronAPI.onNotesChanged((event, path) => {
      const version = (versions.get(path) ?? 0) + 1;
      versions.set(path, version);
      if (event === 'unlink') {
        const removed = (candidate: string) => candidate === path || candidate.startsWith(path + '/');
        for (const [candidate, pendingVersion] of versions) {
          if (removed(candidate)) versions.set(candidate, pendingVersion + 1);
        }
        setNotes(current => current.filter(n => !removed(n)));
        setCreatedFolders(current => current.filter(path => !removed(path)));
        setNotesData(current => current.filter(n => !removed(n.path)));
        setTabState(current => removeMissing(current, n => !removed(n)));
      } else {
        void window.electronAPI.readNote(path).then(content => {
          if (cancelled || versions.get(path) !== version || content.startsWith('Error:')) return;
          setNotes(current => current.includes(path) ? current : [...current, path].sort());
          if (!path.startsWith('.neuron/') && !isCsvPath(path)) setNotesData(current => {
            const existing = current.find(n => n.path === path);
            if (existing?.content === content) return current;
            return existing ? current.map(n => n.path === path ? { path, content } : n) : [...current, { path, content }];
          });
          // The open note follows its file. It used to keep showing what it was
          // opened with, so an edit from a sync client, git or another editor
          // stayed invisible -- and the next keystroke here wrote over it. Our
          // own saves come back through the watcher too, so wait while one is in
          // flight: adopting the disk copy then could undo the user's last few
          // characters. When that write lands, the disk is what they typed.
          const open = openNoteRef.current;
          if (path === open.path && !open.saving) setNoteContent(current => current === content ? current : content);
        }).catch(() => { if (!cancelled) setNotice('Could not update the changed note.'); });
      }
      if (path !== SHELL_CONFIG) return;
      void window.electronAPI?.readNote(SHELL_CONFIG).then((content) => {
        if (content.startsWith('Error:')) {
          adoptShellConfig(null);
          setPendingShellConfig(null);
          return;
        }
        offerShellConfig(content);
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [repository, adoptShellConfig, offerShellConfig]);

  useEffect(() => {
    let cancelled = false;
    openNoteRef.current = { path: selectedNote && !isUrl(selectedNote) ? selectedNote : null, saving: false };
    (async () => {
      if (!selectedNote || isUrl(selectedNote) || !window.electronAPI) { setNoteContent(''); setSaveState('idle'); return; }
      try {
        const content = await window.electronAPI.readNote(selectedNote);
        if (!cancelled) { setNoteContent(content); setSaveState('saved'); }
      } catch {
        if (!cancelled) setNotice(`Could not open “${selectedNote}”.`);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedNote]);

  // A preview by default: most routes here are a look at a file, and only a
  // double click, creating something or editing it says to keep the tab.
  const handleSelectNote = useCallback((note: string, options?: { keep?: boolean }) => {
    setTabState((current) => openTab(current, note, options?.keep === true));
    setView('notes');
    // Opening a file leaves home, whichever route got here -- sidebar, explorer,
    // command palette or a wiki-link. One place to clear it, because a second
    // route that forgot would leave the explorer covering the note it opened.
    setAtHome(false);
    if (!isUrl(note)) setExplorerRecents((current) => addRecent(current, { path: note, kind: 'file' }));
    setNotice(null);
  }, []);
  const keepNote = useCallback((note: string) => handleSelectNote(note, { keep: true }), [handleSelectNote]);
  const keepOpenTab = useCallback((note: string) => setTabState((current) => keepTab(current, note)), []);

  /** Show the workspace explorer without disturbing what is already open. */
  const goHome = useCallback((folder = '') => {
    setView('notes');
    setExplorerFolder(folder);
    setAtHome(true);
    setNotice(null);
  }, []);

  const navigateExplorer = useCallback((folder: string) => {
    setExplorerFolder(folder);
    if (folder) setExplorerRecents((current) => addRecent(current, { path: folder, kind: 'folder' }));
  }, []);

  useEffect(() => {
    foldersLoadedFor.current = null;
    setCreatedFolders([]);
    if (!repository) return;
    let cancelled = false;
    void window.electronAPI.settings.get<unknown>('explorer.folders:' + repository.path).then(stored => {
      if (cancelled) return;
      const folders = Array.isArray(stored) ? stored.filter((path): path is string => typeof path === 'string' && !!path) : [];
      foldersLoadedFor.current = repository.path;
      setCreatedFolders(current => [...new Set([...folders, ...current])]);
    }).catch(() => { if (!cancelled) setNotice('Could not load saved empty folders.'); });
    return () => { cancelled = true; };
  }, [repository]);

  useEffect(() => {
    if (!repository || foldersLoadedFor.current !== repository.path) return;
    void window.electronAPI.settings.set('explorer.folders:' + repository.path, createdFolders)
      .catch(() => setNotice('Could not remember empty folders.'));
  }, [repository, createdFolders]);

  const clearExplorerRecents = useCallback(() => setExplorerRecents([]), []);

  // The file list, minus the workspace's own configuration.
  //
  // Filtered from `notes` rather than taken from `notesData`, for two reasons.
  // notesData exists to be READ -- it carries every file's contents for the
  // graph, tags and search -- and an explorer needs names, not bodies. And it
  // holds only what could be read as text, so sourcing from it would silently
  // hide binaries: a .png in the workspace would simply not appear.
  //
  // `.neuron/` is excluded here and nowhere else, on purpose: the sidebar is
  // the file tree and still shows it, because editing layout.json by hand is a
  // real thing to want. The explorer is where you land with nothing open, and
  // offering the workspace's own configuration there put a row that the app
  // rewrites as you use it -- churning under the cursor -- ahead of your notes.
  // (The graph shows only notes with wiki-links, so it never had the question.)
  const explorerPaths = useMemo(
    () => notes.filter((path) => !path.startsWith('.neuron/')),
    [notes],
  );

  // Files Neuron does not open, and every folder on disk. Shown beside the
  // notes so a folder of PDFs or images does not look empty, but never read.
  const otherFiles = useMemo(() => {
    if (!entries) return [];
    const known = new Set(notes);
    return entries.files.filter((path) => !known.has(path));
  }, [entries, notes]);
  const treeFolders = useMemo(
    () => [...new Set([...createdFolders, ...(entries?.folders ?? [])])],
    [createdFolders, entries],
  );
  const explorerOther = useMemo(() => otherFiles.filter(notInConfig), [otherFiles]);
  const workspaceAppList = useMemo(() => workspaceApps([...notes, ...(entries?.files ?? [])]), [notes, entries]);
  const explorerAllPaths = useMemo(() => [...explorerPaths, ...explorerOther], [explorerPaths, explorerOther]);
  const explorerFolders = useMemo(() => treeFolders.filter(notInConfig), [treeFolders]);
  const revealFile = useCallback((path: string) => {
    void window.electronAPI?.revealInFolder(path).then((result) => {
      if (!result.success) setNotice(`Could not show “${path}” in its folder.`);
    });
  }, []);

  const createNote = useCallback(async (relativePath: string, content?: string, companions: { path: string; content: string }[] = []): Promise<boolean> => {
    if (!window.electronAPI) return false;
    try {
      const title = relativePath.split('/').pop()!.replace(/\.(md|mdx)$/, '');
      const body = content ?? '# ' + title + '\n\n';
      // First, so the file is what its companions describe from the moment it opens.
      for (const companion of companions) {
        const written = await window.electronAPI.writeNote(companion.path, companion.content);
        if (!written.success) { setNotice('Could not create “' + relativePath + '”. ' + (written.error ?? '')); return false; }
      }
      const result = await window.electronAPI.writeNote(relativePath, body);
      if (!result.success) { setNotice('Could not create “' + relativePath + '”. ' + (result.error ?? '')); return false; }
      await loadNotes();
      handleSelectNote(relativePath, { keep: true });
      setEditorModes(current => ({ ...current, [relativePath]: 'live' }));
      setSaveState('saved');
      return true;
    } catch {
      setNotice('Could not create “' + relativePath + '”.');
      return false;
    }
  }, [loadNotes, handleSelectNote]);

  const createSectionFolder = useCallback(async (path: string): Promise<boolean> => {
    if (!window.electronAPI) return false;
    try {
      const result = await window.electronAPI.createSection(path);
      if (!result.success) { setNotice('Could not create folder “' + path + '”. ' + (result.error ?? '')); return false; }
      setCreatedFolders(current => current.includes(path) ? current : [...current, path]);
      await loadNotes();
      setRevealedFolder(path);
      return true;
    } catch {
      setNotice('Could not create folder “' + path + '”.');
      return false;
    }
  }, [loadNotes]);

  const handleDeleteNote = useCallback(async (note: string): Promise<boolean> => {
    if (!window.electronAPI) return false;
    const result = await window.electronAPI.deleteNote(note);
    if (!result.success) { setNotice(`Could not delete “${note}”. ${result.error ?? ''}`.trim()); return false; }
    // Left behind, the metadata would make a later CSV of the same name Neuron's
    // to write without ever asking.
    if (isCsvPath(note)) await window.electronAPI.deleteNote(tableMetaPath(note));
    setTabState((current) => removeMissing(current, (path) => path !== note));
    await loadNotes();
    return true;
  }, [loadNotes]);

  const handleContentChange = useCallback(async (value: string) => {
    // Kept in the same update as the change itself, so a preview never holds
    // an unsaved edit and the next single click cannot replace a tab mid-save.
    if (selectedNote) keepOpenTab(selectedNote);
    setNoteContent(value);
    if (!selectedNote || !window.electronAPI) return;
    const version = ++saveVersion.current;
    setSaveState('saving');
    openNoteRef.current.saving = true;
    setNotesData((previous) => previous.map((note) => (note.path === selectedNote ? { ...note, content: value } : note)));
    const result = await window.electronAPI.writeNote(selectedNote, value);
    if (version !== saveVersion.current) return;
    openNoteRef.current.saving = false;
    setSaveState(result.success ? 'saved' : 'error');
    if (result.success && selectedNote === SHELL_CONFIG) offerShellConfig(value);
    if (!result.success) setNotice(`Changes to “${selectedNote}” could not be saved.`);
  }, [selectedNote, offerShellConfig, keepOpenTab]);

  const requestCreate = useCallback(async () => {
    if (creatingUntitled.current) return;
    creatingUntitled.current = true;
    try {
      const paths = await window.electronAPI.listNotes();
      await createNote(nextUntitled([...paths, ...createdFolders], ''), '# Untitled\n\n');
    } catch { setNotice('Could not create a note.'); }
    finally { creatingUntitled.current = false; }
  }, [createNote, createdFolders]);

  // A database or canvas starts with content its surface can open, in the
  // workspace root like New note, and is kept as a tab by createNote.
  const requestCreateKind = useCallback(async (kind: 'database' | 'canvas' | 'table') => {
    if (creatingUntitled.current) return;
    creatingUntitled.current = true;
    try {
      const paths = await window.electronAPI.listNotes();
      const path = nextUntitled([...paths, ...createdFolders], '', 'Untitled', NEW_FILE_KINDS[kind].ext);
      await createNote(path, startingContent(kind), startingCompanions(kind, path));
    } catch { setNotice(`Could not create a ${kind}.`); }
    finally { creatingUntitled.current = false; }
  }, [createNote, createdFolders]);

  const requestCreateFolder = useCallback(async () => {
    if (creatingUntitled.current) return;
    creatingUntitled.current = true;
    try {
      const paths = await window.electronAPI.listNotes();
      await createSectionFolder(nextUntitled([...paths, ...createdFolders], '', 'Untitled folder', ''));
      setSidebarMode('files');
    } catch { setNotice('Could not create a folder.'); }
    finally { creatingUntitled.current = false; }
  }, [createSectionFolder, createdFolders]);

  // Create an .html view in the current note's folder.
  const createSurfaceFile = useCallback(async () => {
    const folder = selectedNote && selectedNote.includes('/') ? selectedNote.slice(0, selectedNote.lastIndexOf('/') + 1) : '';
    let name = 'View.html';
    let i = 2;
    while (notes.includes(`${folder}${name}`)) name = `View ${i++}.html`;
    await createNote(`${folder}${name}`, HTMX_VIEW_TEMPLATE);
  }, [selectedNote, notes, createNote]);

  const toggleShell = useCallback(async () => {
    if (layoutShell) { adoptShellConfig(null); return; }
    if (!window.electronAPI) return;
    const existing = await window.electronAPI.readNote(SHELL_CONFIG);
    const missing = existing.startsWith('Error:');
    // Adopted before the write, so the watcher event for it finds nothing new.
    adoptShellConfig(missing ? NEURON_CONFIG_TEMPLATE : existing);
    if (missing) await window.electronAPI.writeNote(SHELL_CONFIG, NEURON_CONFIG_TEMPLATE);
    setView('notes');
  }, [layoutShell, adoptShellConfig]);

  // Pull Chrome's cookies into the in-app browser session (stay logged in).
  const importChromeLogins = useCallback(async () => {
    if (!window.electronAPI) return;
    setNotice('Importing Chrome logins…');
    const r = await window.electronAPI.cookies.importChrome();
    setNotice(r.success
      ? `Imported ${r.imported ?? 0} Chrome cookies${r.skipped ? ` (${r.skipped} skipped)` : ''}. Open a website tab to use them.`
      : `Chrome import failed: ${r.error ?? 'unknown error'}`);
  }, []);

  // Open a website as a browser tab. The hash keeps each new tab a distinct key;
  // the in-view URL bar lets the user navigate anywhere from there.
  const openWebsite = useCallback(() => {
    const n = ++browserCounter.current;
    const url = `https://duckduckgo.com/#neuron-tab-${n}`;
    handleSelectNote(url, { keep: true });
  }, [handleSelectNote]);

  // A second note beside the editor. Only its path is state here: its content
  // is the main pane's when both show the same note, otherwise the workspace
  // copy with any unsaved typing laid over it, so each file has one writer.
  const [sideNote, setSideNote] = useState<string | null>(null);
  const [sideDraft, setSideDraft] = useState<{ path: string; content: string } | null>(null);
  const [sideSave, setSideSave] = useState<SaveState>('saved');
  const sideVersion = useRef(0);
  useEffect(() => {
    void window.electronAPI?.settings.get<unknown>('editorSplit').then((stored) => {
      if (typeof stored === 'string' && /\.(md|mdx)$/.test(stored)) setSideNote(stored);
    });
  }, []);
  const openToSide = useCallback((path: string | null) => {
    if (path !== null && !/\.(md|mdx)$/.test(path)) return;
    setSideNote(path); setSideDraft(null); setSideSave('saved');
    void window.electronAPI?.settings.set('editorSplit', path);
  }, []);
  const explorerState = useMemo(() => ({
    atHome, repositoryName: repository?.name ?? 'Workspace', paths: explorerPaths,
    otherFiles: explorerOther, fileInfo: entries?.info ?? {}, skipped: entries?.skipped ?? 0, truncated: entries?.truncated ?? false,
    folders: explorerFolders, notesData, folder: explorerFolder, navigate: navigateExplorer,
    openFile: handleSelectNote, openToSide, createNote, createFolder: createSectionFolder, reveal: revealFile,
    editorModes, recents: explorerRecents, clearRecents: clearExplorerRecents,
  }), [atHome, repository, explorerPaths, explorerOther, entries, explorerFolders, notesData, explorerFolder, navigateExplorer,
    handleSelectNote, openToSide, createNote, createSectionFolder, revealFile, editorModes, explorerRecents, clearExplorerRecents]);

  // A deleted or renamed file, or another workspace, simply has no side pane.
  const sidePath = sideNote && notes.includes(sideNote) ? sideNote : null;
  const sideContent = !sidePath ? '' : sidePath === selectedNote ? noteContent
    : sideDraft?.path === sidePath ? sideDraft.content : notesData.find((note) => note.path === sidePath)?.content ?? '';
  const changeSideNote = async (value: string) => {
    if (!sidePath || !window.electronAPI) return;
    if (sidePath === selectedNote) { void handleContentChange(value); return; }
    const path = sidePath;
    const version = ++sideVersion.current;
    setSideDraft({ path, content: value });
    setSideSave('saving');
    const result = await window.electronAPI.writeNote(path, value);
    if (version !== sideVersion.current) return;
    setSideSave(result.success ? 'saved' : 'error');
    if (!result.success) { setNotice(`Changes to ?${path}? could not be saved.`); return; }
    setNotesData((previous) => previous.map((note) => (note.path === path ? { ...note, content: value } : note)));
    setSideDraft((draft) => (draft?.path === path && draft.content === value ? null : draft));
  };

  const closeTab = useCallback((note: string) => {
    setTabState((current) => {
      const next = closeTabIn(current, note);
      if (!next.tabs.length) { setExplorerFolder(''); setAtHome(true); }
      return next;
    });
  }, []);

  /**
   * Tick or untick a task from the rendered view.
   *
   * The Markdown is the source of truth, so this rewrites the one line rather
   * than holding the tick in renderer state: reading mode has no editor behind
   * it, and a tick that lived only on screen would vanish on reload.
   */
  const handleToggleTask = useCallback((lineIndex: number, checked: boolean) => {
    const lines = noteContent.split('\n');
    const line = lines[lineIndex];
    if (line === undefined) return;

    const next = checked
      ? line.replace(/\[( | )\]/, '[x]')
      : line.replace(/\[[xX]\]/, '[ ]');
    if (next === line) return;

    lines[lineIndex] = next;
    handleContentChange(lines.join('\n'));
  }, [noteContent, handleContentChange]);

  const handleLineClick = useCallback((lineIndex: number) => {
    const targetLine = lineIndex + 1;
    let mode = selectedNote ? editorModes[selectedNote] || 'reading' : 'reading';
    // In reading view, a single click shouldn't switch modes — double-click enters live.
    if (mode === 'reading') return;
    setTimeout(() => {
      const view = editorRef.current?.view;
      if (view) {
        try {
          const doc = view.state.doc;
          const safeLine = Math.max(1, Math.min(targetLine, doc.lines));
          const line = doc.line(safeLine);
          view.dispatch({
            selection: { anchor: line.from, head: line.from },
            scrollIntoView: true,
          });
          view.focus();
        } catch (e) {
          console.error('Failed to jump to line:', e);
        }
      }
    }, 50);
  }, [selectedNote, editorModes]);

  // Markdown opens in reading view; other text files (JSON config, CSS, manifests) open as raw source.
  const defaultEditorMode: EditorMode = selectedNote && /\.(md|mdx)$/i.test(selectedNote) ? 'reading' : 'split';
  const editorMode: EditorMode = (selectedNote && editorModes[selectedNote]) || defaultEditorMode;
  const setEditorMode = (mode: EditorMode) => {
    if (selectedNote) setEditorModes((prev) => ({ ...prev, [selectedNote]: mode }));
  };

  // --- Derived --------------------------------------------------------------
  const filteredNotes = useMemo(
    () => (selectedTag
      ? notesData.filter(note => noteTags(note.content).includes(selectedTag)).map(note => note.path)
      : notes),
    [selectedTag, notesData, notes],
  );

  // CSV tables are found by name in the sidebar search; their contents are not read for it.
  const searchableFiles = useMemo(
    () => [...notesData, ...notes.filter(isCsvPath).map((path) => ({ path, content: '' }))],
    [notesData, notes],
  );

  const bridge = useMemo(() => ({
    activeNote: selectedNote,
    noteContent,
    notes,
    notesData,
    openNote: handleSelectNote,
    createNote,
    refreshNotes: loadNotes,
  }), [selectedNote, noteContent, notes, notesData, handleSelectNote, createNote, loadNotes]);

  // --- Responsive (raw split collapses to tabs when narrow) -----------------
  // Panels are user-resizable, so responsive mode only needs the viewport width.
  useEffect(() => {
    const compute = () => setWide(window.innerWidth >= 1100);
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // Load configurable keybindings once.
  useEffect(() => {
    if (!window.electronAPI) return;
    void window.electronAPI.settings.get<Bindings>('keybindings').then((stored) => setBindings(resolveBindings(stored)));
  }, []);

  const updateBindings = useCallback((next: Bindings) => {
    setBindings(next);
    void window.electronAPI?.settings.set('keybindings', next);
  }, []);

  // Global shortcut dispatcher, driven by the (configurable) binding map.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Zen mode exits on a double Escape press.
      if (event.key === 'Escape' && layoutRef.current.zen) {
        const now = Date.now();
        if (now - lastEscapeRef.current < 900) { patchLayout({ zen: false }); lastEscapeRef.current = 0; return; }
        lastEscapeRef.current = now;
      }
      const chord = eventToChord(event);
      if (!chord) return;
      const match = Object.entries(bindings).find(([, c]) => c === chord);
      if (!match) return;
      event.preventDefault();
      switch (match[0]) {
        case 'palette': setPaletteOpen((open) => !open); break;
        case 'new-note': requestCreate(); break;
        case 'new-view': void createSurfaceFile(); break;
        case 'open-website': openWebsite(); break;
        case 'toggle-sidebar': setSidebarOpen((v) => !v); break;
        case 'toggle-right': setRightPanelOpen((v) => !v); break;
        case 'toggle-bottom': setBottomPanelOpen((v) => !v); break;
        case 'toggle-terminal': toggleTerminalRef.current?.(); break;
        case 'toggle-zen': patchLayout({ zen: !layoutRef.current.zen }); break;
        case 'toggle-graph': toggleGraphOverlay(); break;
        case 'toggle-fullscreen': void window.electronAPI.windowControls.toggleFullScreen(); break;
      }
    };
    // Capture before terminals/editors consume the palette chord; Settings can
    // still record shortcuts in its earlier window capture listener.
    const capturePalette = (event: KeyboardEvent) => {
      if (!document.body.classList.contains('window-fullscreen') || eventToChord(event) !== bindings.palette) return;
      event.stopPropagation();
      handler(event);
    };
    document.addEventListener('keydown', capturePalette, true);
    window.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', capturePalette, true);
      window.removeEventListener('keydown', handler);
    };
  }, [bindings, requestCreate, createSurfaceFile, openWebsite, patchLayout]);

  const saveLabel = { idle: 'No note open', saving: 'Saving…', saved: 'Saved locally', error: 'Save failed' }[saveState];

  const rawSplit = wide ? (
    <div className="flex h-full w-full divide-x divider-color">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Source</div>
        <div className="min-h-0 flex-1"><Editor ref={editorRef} value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></div>
      </div>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Preview</div>
        <div className="min-h-0 flex-1"><MDXPreview onToggleTask={handleToggleTask} mdxContent={noteContent} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} onLineClick={handleLineClick} notes={notes} onWikiLinkClick={handleSelectNote} /></div>
      </div>
    </div>
  ) : (
    <Tabs defaultValue="source" className="flex h-full w-full flex-col">
      <div className="border-b divider-color px-3 py-2"><TabsList><TabsTrigger value="source">Source</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList></div>
      <TabsContent value="source" className="min-h-0 flex-1"><Editor ref={editorRef} value={noteContent} onChange={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></TabsContent>
      <TabsContent value="preview" className="min-h-0 flex-1"><MDXPreview onToggleTask={handleToggleTask} mdxContent={noteContent} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} onLineClick={handleLineClick} notes={notes} onWikiLinkClick={handleSelectNote} /></TabsContent>
    </Tabs>
  );

  const browsing = isUrl(selectedNote);
  const Surface = selectedNote && !browsing ? getSurface(selectedNote) : undefined;
  const surfaceEditing = !!(selectedNote && Surface && surfaceSourceMode[selectedNote]);
  const setSurfaceSource = (source: boolean) => { if (selectedNote) setSurfaceSourceMode((prev) => ({ ...prev, [selectedNote]: source })); };

  const editorHeader = (
    <header className="shrink-0">
      <div className="pane-header editor-tab-header flex items-center">
      <NoteTabs tabs={openTabs} previewTab={previewTab} activeTab={atHome ? '' : selectedNote ?? ''} onSelect={handleSelectNote} onKeep={keepOpenTab} onClose={closeTab} onOpenToSide={openToSide} onNewTab={() => goHome()} onNewBrowser={openWebsite} />
      </div>
      {selectedNote && !atHome && <div className="note-header flex h-8 min-w-0 items-center gap-3 px-3">
        <div aria-label="Note path" title={selectedNote} className="min-w-0 flex-1 truncate font-sans text-xs text-[var(--ink-muted)]">
          {selectedNote.includes('/') && <span>{selectedNote.slice(0, selectedNote.lastIndexOf('/') + 1)}</span>}
          <span className="text-[var(--ink-secondary)]">{selectedNote.split('/').pop()}</span>
        </div>
        {!browsing && <span role="status" className={cn('shrink-0 text-xs text-[var(--ink-muted)]', saveState === 'error' && 'text-[var(--danger)]')}>{saveLabel}</span>}
      {selectedNote && Surface ? (
          <div className="flex shrink-0 items-center">
            <Segmented
              label="Surface mode"
              value={surfaceEditing ? 'source' : 'preview'}
              onChange={(next) => setSurfaceSource(next === 'source')}
              options={[
                { value: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" /> },
                { value: 'source', label: 'Source', icon: <FileCode2 className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
      ) : selectedNote && !browsing ? (
          <div className="flex shrink-0 items-center gap-3">
            {/* Not in a layout workspace. There the editor is a panel that owns
                its own view mode, so this switch drove nothing -- two identical
                controls one above the other, and only the lower one worked. It
                was invisible while this was a dropdown and the other a row of
                text; giving them the same shape is what showed it. */}
            {!layoutShell && <Segmented label="View mode" value={editorMode} onChange={setEditorMode} options={EDIT_MODES} />}
            {/* In a layout workspace the editor panel owns the view mode and
                renders its switch into this slot, so it shares the note header
                instead of taking a row of its own. */}
            {layoutShell && <div id={EDITOR_MODE_SLOT} className="flex items-center" />}
          </div>
      ) : null}
      </div>}
    </header>
  );


  // Home wins over the open note, which is what lets the New tab action show
  // the explorer without closing tabs -- they stay in `openTabs`, and clicking
  // one calls handleSelectNote, which clears `atHome` and brings it back.
  const notesView = selectedNote && !atHome ? (
    <div className="flex h-full w-full flex-col">
      {editorHeader}
      <div className="min-h-0 flex-1">
        {browsing ? (
          <BrowserView key={selectedNote} url={selectedNote} />
        ) : Surface ? (
          surfaceEditing
            // A CSV is read-only as source: the editor would turn CRLF into LF on
            // the first keystroke, and a CSV Neuron does not manage must not change.
            ? <Editor ref={editorRef} value={noteContent} onChange={handleContentChange} readOnly={isCsvPath(selectedNote)} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} />
            : <SurfaceBoundary resetKey={`${selectedNote}:${noteContent.length}`}><Surface path={selectedNote} content={noteContent} notesData={notesData} onSelectNote={handleSelectNote} selectedNote={selectedNote} onChangeNote={handleContentChange} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} /></SurfaceBoundary>
        ) : (
          <>
            {editorMode === 'live' && <MDXPreview key={selectedNote} editable mdxContent={noteContent} onChangeSource={handleContentChange} onToggleTask={handleToggleTask} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} tagSuggestions={tags} onTagClick={setSelectedTag} notes={notes} onWikiLinkClick={handleSelectNote} onRequestRawMode={() => setEditorMode('split')} removeEmptyFrontmatter={propsSettings.removeEmpty} defaultPropertiesCollapsed={propsSettings.collapsedByDefault} />}
            {editorMode === 'split' && rawSplit}
            {editorMode === 'reading' && (
              <div className="h-full" onDoubleClick={() => setEditorMode('live')}><MDXPreview onToggleTask={handleToggleTask} mdxContent={noteContent} colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} onLineClick={handleLineClick} tagSuggestions={tags} onTagClick={setSelectedTag} notes={notes} onWikiLinkClick={handleSelectNote} showProperties={propsSettings.showInReading} defaultPropertiesCollapsed={propsSettings.collapsedByDefault} /></div>
            )}
          </>
        )}
      </div>
    </div>
  ) : (
    // What used to be a blank "Choose a note to begin" panel. Nothing selected
    // means the explorer at the workspace root; the tabs, if any, are untouched.
    <div className="flex h-full w-full flex-col">
      {editorHeader}
      <div className="min-h-0 flex-1">
        <WorkspaceExplorer
          repositoryName={explorerState.repositoryName}
          paths={explorerState.paths}
          otherFiles={explorerState.otherFiles}
          fileInfo={explorerState.fileInfo}
          skipped={explorerState.skipped}
          truncated={explorerState.truncated}
          onReveal={explorerState.reveal}
          folder={explorerState.folder}
          onNavigate={explorerState.navigate}
          onOpenFile={explorerState.openFile}
          recents={explorerState.recents}
          onClearRecents={explorerState.clearRecents}
          folders={explorerState.folders}
          notesData={explorerState.notesData}
          onCreateNote={explorerState.createNote}
          onCreateFolder={explorerState.createFolder}
          onOpenToSide={explorerState.openToSide}
        />
      </div>
    </div>
  );

  let mainContent: React.ReactNode;
  if (view === 'gallery') {
    mainContent = <ComponentGallery />;
  } else if (layoutShell && !Surface && !browsing) {
    // Shell handles plain notes in its editor slot; surface files (.html, .db, .canvas) and
    // browser tabs are full-page documents, so let them fall through to notesView.
    mainContent = (
      <div className="flex h-full w-full flex-col">
        <div className="min-h-0 flex-1">
          <LayoutSurface
            editorHeader={editorHeader}
            path={SHELL_CONFIG}
            content={layoutShell}
            notesData={notesData}
            onSelectNote={handleSelectNote}
            selectedNote={selectedNote}
            noteContent={noteContent}
            onChangeNote={handleContentChange}
            colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'}
            tagSuggestions={tags}
            onTagClick={setSelectedTag}
            removeEmptyFrontmatter={propsSettings.removeEmpty}
            defaultPropertiesCollapsed={propsSettings.collapsedByDefault}
          />
        </div>
      </div>
    );
  } else {
    mainContent = notesView;
  }

  if (utilityWindow) {
    // The plugin host runs here too, for the Connectors section. It has no
    // workspace, so no plugin is on here.
    return (
      <PluginProvider catalog={builtinPlugins} bridge={bridge} workspace={null}>
        <TooltipProvider delayDuration={300}>
          <SettingsWindow
            appearance={appearance} onAppearanceChange={handleAppearanceChange}
            bindings={bindings} onBindingsChange={updateBindings}
            properties={propsSettings} onPropertiesChange={updatePropsSettings}
            recents={recents}
            onCreateRepo={createRepository} onOpenRepo={openRepository} onSwitchRepo={switchRepository}
            onReloadRepos={reloadRepoState}
          />
        </TooltipProvider>
      </PluginProvider>
    );
  }

  return (
    <PluginProvider catalog={builtinPlugins} bridge={bridge} workspace={repository?.path ?? null}>
      <ExplorerProvider value={explorerState}>
      <TooltipProvider delayDuration={300}>
        <div className={`workspace-grid app-shell font-sans${layout.statusBar ? '' : ' no-status'}${layout.zen ? ' zen' : ''}`}>
          <TitleBar
            layoutSwitcher={layoutSwitcher}
            repository={repository}
            recents={recents}
            activeNote={view === 'notes' ? selectedNote : null}
            sidebarOpen={sidebarOpen}
            rightPanelOpen={rightPanelOpen}
            graphOpen={graphOverlayOpen}
            bottomPanelOpen={bottomPanelOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
            onToggleGraph={showOrToggleGraph}
            onToggleBottomPanel={() => setBottomPanelOpen((v) => !v)}
            onManageWorkspaces={() => openSettings('workspaces')}
            onOpenWorkspaceSettings={() => setWorkspaceSettings('general')}
            onOpenCommandPalette={() => setPaletteOpen(true)}
            onOpenSettings={() => openSettings('appearance')}
            onSwitchRepo={switchRepository}
            onOpenRepo={openRepository}
            onCreateRepo={createRepository}
            layout={layout}
            onLayoutChange={patchLayout}
            onResetLayout={() => { zenPrevRef.current = null; commitLayout({ ...DEFAULT_LAYOUT }); }}
          />

          {!repoReady ? (
            <div className="grid place-items-center text-sm text-[var(--ink-muted)]">Loading…</div>
          ) : !repository ? (
            <RepositoryOnboarding recents={recents} onCreate={createRepository} onOpen={openRepository} onSwitch={switchRepository} />
          ) : (
            <div className="shell-workspace flex min-h-0 min-w-0 overflow-hidden">
            <Workbench layout={layout} onLayoutChange={patchLayout} onOpenMarketplace={openPlugins}
              sidebar={
                <Sidebar
                  collapsed={layout.sidebarCollapsed}
                  onToggleCollapsed={() => patchLayout({ sidebarCollapsed: !layout.sidebarCollapsed })}
                  onSelectMode={(mode) => { setSidebarMode(mode); setView('notes'); }}
                  onOpenSettings={(section) => (section === 'plugins' ? openPlugins() : openSettings(section))}
                  graphOpen={graphOverlayOpen}
                  onToggleGraph={showOrToggleGraph}
                  sidebarSide={layout.sidebarSide}
                  onMoveSidebar={(side) => patchLayout({ sidebarSide: side })}
                  notes={filteredNotes}
                  notesData={searchableFiles}
                  selectedNote={selectedNote}
                  onSelectNote={handleSelectNote}
                  onKeepNote={keepNote}
                  onDeleteNote={handleDeleteNote}
                  onRequestCreate={requestCreate}
                  onRequestCreateFolder={requestCreateFolder}
                  onRequestCreateKind={requestCreateKind}
                  onRefresh={loadNotes}
                  view={view}
                  mode={sidebarMode}
                  repositoryName={repository.name}
                  folders={selectedTag ? createdFolders : treeFolders}
                  otherFiles={selectedTag ? NO_FILES : otherFiles}
                  onReveal={revealFile}
                  revealedFolder={revealedFolder}
                  tags={tags}
                  onSelectTag={setSelectedTag}
                  selectedTag={selectedTag}
                />
              }>
              <SplitGroup direction="horizontal" autoSaveId="neuron.editor.split" className="flex h-full min-h-0 min-w-0">
              <SplitPanel id="editor-main" order={1} minSize={25} className="min-w-0">
              <main className={cn('relative flex h-full w-full min-w-0 flex-col overflow-hidden', !(view === 'notes' && layoutShell && !Surface && !browsing) && 'shell-card')}>
                {notice && (
                  <div role="alert" data-callout-kind="error" className="callout absolute left-1/2 top-3 z-50 flex max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2.5 px-3 py-2 text-xs text-[var(--ink)]">
                    <CalloutIcon kind="error" />
                    <span>{notice}</span>
                    <button className="interactive min-h-[28px] text-[var(--danger)] hover:text-[var(--ink)]" onClick={() => setNotice(null)}>Dismiss</button>
                  </div>
                )}
                {pendingShellConfig && (
                  <div role="status" data-callout-kind="info" className="callout absolute left-1/2 top-3 z-50 flex max-w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2.5 px-3 py-2 text-xs text-[var(--ink)]">
                    <CalloutIcon kind="info" />
                    <span>The workspace layout (.neuron/layout.json) changed. Update to the latest view?</span>
                    <button className="interactive min-h-[28px] rounded px-2 font-medium text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" onClick={() => { adoptShellConfig(pendingShellConfig); setWorkspacePanels(pendingShellConfig); setPendingShellConfig(null); setView('notes'); }}>Update view</button>
                    <button className="interactive min-h-[28px] rounded px-2 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setPendingShellConfig(null)}>Not now</button>
                  </div>
                )}
                {mainContent}
                {/* Notes only. It is a map of the workspace, so it
                    has nothing to say over the component gallery --
                    and it used to cover page controls, which an E2E
                    click timeout caught. Anchored to
                    <main> rather than the notes view because a
                    workspace with a shell config renders a layout
                    instead of notesView, and the map is just as
                    useful there. Not the window, so it never covers
                    the sidebar or status bar. Zen mode exists to
                    remove chrome, so it hides this too. */}
                {graphOverlayOpen && !layout.zen && view === 'notes' && (
                  <FloatingGraph
                    key={repository?.path}
                    notesData={notesData}
                    selectedNote={selectedNote}
                    onSelectNote={handleSelectNote}
                    onClose={toggleGraphOverlay}
                  />
                )}
              </main>
              </SplitPanel>
              {sidePath && view === 'notes' && !layout.zen && (
                <>
                  <SplitHandle className="resize-handle resize-handle-v" />
                  <SplitPanel id="editor-side" order={2} minSize={20} defaultSize={50} className="min-w-0">
                    <SideNote path={sidePath} content={sideContent} saveState={sidePath === selectedNote ? saveState : sideSave}
                      colorScheme={PRESETS[appearance.preset]?.colorScheme ?? 'dark'} notes={notes} tags={tags}
                      onChange={(value) => { void changeSideNote(value); }} onOpenNote={handleSelectNote}
                      onSwap={() => { const main = selectedNote; keepNote(sidePath); if (main && /\.(md|mdx)$/.test(main)) openToSide(main); }}
                      onClose={() => openToSide(null)} />
                  </SplitPanel>
                </>
              )}
              </SplitGroup>
            </Workbench>
            </div>
          )}

          {layout.statusBar && <StatusBar activeNote={view === 'notes' ? selectedNote : null} saveState={saveState} layout={layout} onLayoutChange={patchLayout} onOpenPlugins={openPlugins} terminalChord={bindings['toggle-terminal']} />}
          <TerminalShortcut toggleRef={toggleTerminalRef} layout={layout} onLayoutChange={patchLayout} onOpenPlugins={openPlugins} />
          <WorkspacePanelsApplier content={workspacePanels} layoutReady={layoutReady} layout={layout} onLayoutChange={patchLayout} onDone={clearWorkspacePanels} />
        </div>

        <CommandPalette
          recents={recents}
          onOpenRepo={openRepository}
          onCreateRepo={createRepository}
          onSwitchRepo={switchRepository}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          notes={notes}
          onSelectNote={handleSelectNote}
          onOpenMarketplace={openPlugins}
          onOpenSettings={() => openSettings('appearance')}
          onCreate={() => requestCreate()}
          onCreateSurface={createSurfaceFile}
          onCreateKind={requestCreateKind}
          onOpenWebsite={openWebsite}
          onOpenGallery={() => setView('gallery')}
          onToggleShell={toggleShell}
          shellActive={!!layoutShell}
          onToggleGraph={showOrToggleGraph}
          graphActive={graphOverlayOpen}
          onImportChromeLogins={importChromeLogins}
          layout={layout}
          onLayoutChange={patchLayout}
          onResetLayout={() => { zenPrevRef.current = null; commitLayout({ ...DEFAULT_LAYOUT, panels: {} }); }}
          savedLayouts={savedLayouts}
          onApplySavedLayout={applySavedLayout}
          onSearchNotes={() => { setView('notes'); patchLayout({ sidebar: true, sidebarCollapsed: false }); setSidebarMode('search'); }}
          sideNoteOpen={!!sidePath}
          canOpenToSide={!!selectedNote && /\.(md|mdx)$/.test(selectedNote)}
          onOpenToSide={() => openToSide(selectedNote)}
          onCloseSide={() => openToSide(null)}
          bindings={bindings}
        />
        {repository && (
          <WorkspaceSettingsDialog
            section={workspaceSettings}
            onSectionChange={setWorkspaceSettings}
            workspace={repository}
            apps={workspaceAppList}
            layout={layout}
            onOpenDock={(dock) => patchLayout({ [`${dock}Panel`]: true })}
            onRenamed={() => void reloadRepoState()}
          />
        )}
      </TooltipProvider>
      </ExplorerProvider>
    </PluginProvider>
  );
}
