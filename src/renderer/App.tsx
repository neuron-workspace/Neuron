import { cn } from './lib/utils';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import { CalloutIcon } from './components/mdx-components';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import Workbench from './components/Workbench';
import FloatingGraph from './components/FloatingGraph';
import RepositoryOnboarding from './components/RepositoryOnboarding';
import { nextUntitled } from './lib/untitled';
import { NEW_FILE_KINDS, startingCompanions, startingContent } from './lib/new-file';
import { isCsvPath, tableMetaPath } from './lib/csv-table';
import { requestReveal } from './lib/reveal';
import {
  canSplit, closeGroup, closeInGroup, dropPreviews, EMPTY_GROUPS, focusGroup, keepEverywhere, keepTab, mapGroup, moveTab, openInGroup,
  removeMissingAll, renameInGroups, restoreGroups, serializeGroups, splitGroup, type GroupsState, type SplitDirection,
} from './lib/tabs';
import { aliasesOf, buildWikiIndex, linkName } from './lib/wikilinks';
import { linkNotice, movedPath, planLinkRewrites, type LinkRewritePlan } from './lib/link-rewrite';
import FileActionDialog, { type FileAction } from './components/FileActionDialog';
import { noteTags } from './lib/note-tags';
import CommandPalette from './components/CommandPalette';
import ChromeImportDialog from './components/ChromeImportDialog';
import EditorGroups, { EditorGroupHeader, ShellSplitZones, type GroupContext, type SaveState } from './components/EditorGroup';
import SettingsWindow from './views/SettingsWindow';
import WorkspaceSettingsDialog, { type WorkspaceSettingsSection } from './views/WorkspaceSettingsDialog';
import type { SettingsSection } from '../main/workspace-windows';
import ComponentGallery from './views/ComponentGallery';
import { TooltipProvider } from './components/ui/tooltip';
import { PluginProvider, usePlugins } from './plugins/host';
import { builtinPlugins } from './plugins/builtin';
import { getKindSurface, getSurface, type SaveResult } from './surfaces';
import LayoutSurface from './surfaces/LayoutSurface';
import './surfaces/ImageSurface'; // registers the image surface
import './surfaces/MediaSurface'; // registers the video and audio surface
import './surfaces/TextSurface'; // registers the plain text surface
import { fileKind, isListedFile, MEDIA_KINDS, OPENS_AS_FILE, type FileKind } from '../main/file-kinds';
import { TOO_LARGE_TO_OPEN, tooLargeToOpen } from '../main/file-limits';
import { decideExternalChange } from './lib/external-change';
import './surfaces/HtmxViewSurface'; // registers the .html view surface
import './surfaces/DbSurface'; // registers the .db database surface
import './surfaces/CanvasSurface'; // registers the .canvas JSON Canvas surface
import './surfaces/MermaidSurface'; // registers the Mermaid diagram surface
import './surfaces/CsvSurface'; // registers the .csv table surface
import { type EditMode } from './surfaces/panels';
import { DEFAULT_BINDINGS, eventToChord, resolveBindings, type Bindings } from './lib/keybindings';
import { DEFAULT_LAYOUT, resolveLayout, resolveSavedLayouts, sameLayout, SEED_LAYOUTS, workspacePanelsPatch, type SavedLayout, type WorkbenchLayout } from './lib/layout';
import { hasLayoutTree, parseWorkspacePanels, readableLayout, sameJson } from './surfaces/layout';
import LayoutSwitcher from './components/LayoutSwitcher';
import WorkspaceExplorer from './views/WorkspaceExplorer';
import { ExplorerProvider } from './lib/explorer-state';
import {
  addRecent, pruneRecents, recentsKey, resolveRecents, type RecentEntry,
} from './lib/workspace-explorer';
import { registerTerminalOpener } from './lib/terminal-bus';
import { useTerminalToggle } from './lib/useTerminalToggle';
import { type SidebarMode } from './components/ActivityRail';

/** Hands the terminal toggle to the global shortcut handler. Renders nothing. */
function TerminalShortcut({ toggleRef, showRef, layout, onLayoutChange, onOpenPlugins }: { toggleRef: { current: (() => void) | null }; showRef: { current: (() => boolean) | null }; layout: WorkbenchLayout; onLayoutChange: (patch: Partial<WorkbenchLayout>) => void; onOpenPlugins: () => void }) {
  const { toggle, show } = useTerminalToggle(layout, onLayoutChange, onOpenPlugins);
  toggleRef.current = toggle;
  showRef.current = show;
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
// The editor groups of a workspace, in the settings bridge: `editorGroups:<workspace path>`.
const GROUPS_KEY = 'editorGroups:';
const NO_FILES: string[] = [];
/** The kind a listed file opens as: by name, or text when main found an unknown name to start as text. */
const kindIn = (path: string, text: ReadonlySet<string>): FileKind => {
  const kind = fileKind(path);
  return kind === 'other' && text.has(path) ? 'text' : kind;
};
/** A file outside the note listing that opens in a surface of its own (image, video, audio, text). */
const opensAsFile = (path: string, text: ReadonlySet<string>) => OPENS_AS_FILE.includes(kindIn(path, text));
const isMediaPath = (path: string) => MEDIA_KINDS.includes(fileKind(path));
import type { RecentWorkspace, RepositoryInfo, WorkspaceEntries } from './electron.d';
import { applyTheme, DEFAULT_APPEARANCE, normalizeAppearance, PRESETS, type Appearance } from './lib/theme';

interface NoteData { path: string; content: string }
// Settings, Plugins and Workspaces are sections of the Settings window, so the
// main area always shows something the sidebar's Files, Tags and Graph act on.
type View = 'notes' | 'gallery';
// The same three modes the layout shell offers, under the same names. This was
// 'raw' here and 'split' there, presented as a dropdown here and a button row
// there, so the identical choice looked and read like two different features
// depending on whether the workspace happened to have a layout.json.
type EditorMode = EditMode;

// Default content for new .html views: a complete HTML document. Neuron serves
// it as written and adds only neuron.js, htmx.js and data-theme on <html>.
const HTMX_VIEW_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>New view</title>
  <!-- Neuron's stylesheet. It styles a body with class="neuron-view" and
       follows the app's light or dark theme. Remove it to style from scratch. -->
  <link rel="stylesheet" href="neuron.css">
</head>
<body class="neuron-view">
  <h1>New view</h1>
  <p>Workspace: <strong id="workspace">…</strong></p>

  <!-- htmx: fetch a server-rendered fragment when the page loads. This one
       needs "notes.read" and "tags.read" in the view's manifest. -->
  <section hx-get="api/v1/fragments/workspace-summary" hx-trigger="load">Loading…</section>

  <script>
    // neuron: the same API as JSON. context() needs no permissions.
    neuron.context()
      .then((context) => { document.getElementById('workspace').textContent = context.workspace.name; })
      .catch((error) => { document.getElementById('workspace').textContent = error.message; });
  </script>
</body>
</html>
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
  const [recents, setRecents] = useState<RecentWorkspace[]>([]);
  const [repoReady, setRepoReady] = useState(false);

  const [notes, setNotes] = useState<string[]>([]);
  // The editor groups: each one's open tabs, preview and showing file, their
  // direction, and which group has focus. One state, because each change to a
  // strip moves more than one of them. The focused group's file is the one the
  // rest of the app calls "the open note".
  const [editor, setEditor] = useState<GroupsState>(EMPTY_GROUPS);
  const selectedNote = editor.groups[editor.focused]?.selected ?? null;
  // The content of every file a group shows, keyed by path: one copy however
  // many groups show it, and one save state.
  const [docs, setDocs] = useState<Record<string, string>>({});
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  // The groups' sizes as last laid out. Not state: resizing reports every frame.
  const groupSizes = useRef<number[] | null>(null);
  const noteContent = selectedNote ? docs[selectedNote] ?? '' : '';
  const [notesData, setNotesData] = useState<NoteData[]>([]);
  // Read by the rename and create paths, which plan link rewrites from the
  // workspace as it is at that moment.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const notesDataRef = useRef(notesData);
  notesDataRef.current = notesData;
  // Paths this window just renamed away, and when: the watcher's report that
  // they went away is our own rename, not a file deleted outside.
  const movedAway = useRef(new Map<string, number>());
  // Every file and every alias, for resolving links and `[[` autocomplete.
  const wikiIndex = useMemo(() => buildWikiIndex(notes, aliasesOf(notesData)), [notes, notesData]);
  const [entries, setEntries] = useState<WorkspaceEntries | null>(null);
  const [view, setView] = useState<View>('notes');
  const [editorModes, setEditorModes] = useState<Record<string, EditorMode>>({});
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const saveState: SaveState = selectedNote && !isUrl(selectedNote) ? saveStates[selectedNote] ?? 'idle' : 'idle';
  const [notice, setNotice] = useState<string | null>(null);
  // A notice that reports what Neuron did rather than what went wrong.
  const [info, setInfo] = useState<string | null>(null);
  const [fileAction, setFileAction] = useState<FileAction | null>(null);
  const [chromeImportOpen, setChromeImportOpen] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);

  // The workspace explorer.
  //
  // Home is deliberately its own state rather than being inferred from
  // `selectedNote === null`. Having no file open implies the explorer, but the
  // reverse is not true: opening a new tab must show it WITHOUT
  // closing anyone's tabs, so home has to be a place you can navigate to while
  // a note is still open. Conflating the two is how the explorer either refuses
  // to appear or refuses to go away. It is the group showing home, if any.
  const [homeGroup, setHomeGroup] = useState<number | null>(null);
  const atHome = homeGroup === editor.focused;
  const editorStateRef = useRef(editor);
  editorStateRef.current = editor;
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
    // Zen is never stored, nor the chrome it hid: what is stored during zen is
    // what leaving it restores, so a relaunch starts as zen found the window.
    void window.electronAPI?.settings.set('layout', next.zen && zenPrevRef.current ? { ...zenPrevRef.current, zen: false } : next);
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
  // Its tab is selected too: opening the dock alone left another tab (such as
  // Automations) on screen, the terminal unmounted, and the command queued.
  // Filled by <TerminalShortcut />, which can see the plugin panels.
  const showTerminalRef = useRef<(() => boolean) | null>(null);
  useEffect(() => registerTerminalOpener(() => {
    if (showTerminalRef.current?.()) return;
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

  // Per file: the latest write's number, so only the last one reports, and
  // which files have one of our own writes in flight, which the watcher must
  // not answer by putting the disk copy back over the user's typing.
  const saveVersions = useRef(new Map<string, number>());
  const savingDocs = useRef(new Set<string>());
  // Per file, what the watcher may report back without anyone else having
  // touched the file: the text of each save still in flight, and the last
  // version known to be on disk (read, adopted or saved). And the files whose
  // last save failed, so their edit is not on disk either.
  const inFlight = useRef(new Map<string, string[]>());
  const onDisk = useRef(new Map<string, string>());
  const failedSaves = useRef(new Set<string>());
  // Files that changed outside Neuron while an edit made here was not on disk.
  // Nothing is written for them until the user picks a version.
  const [conflicts, setConflicts] = useState<Record<string, true>>({});
  const conflictsRef = useRef(conflicts);
  const setConflict = useCallback((path: string, open: boolean) => {
    const next = { ...conflictsRef.current };
    if (open) next[path] = true; else delete next[path];
    conflictsRef.current = next;
    setConflicts(next);
  }, []);
  /**
   * An open file follows its file on disk, in every group showing it -- notes
   * and text files alike. It used to keep showing what it was opened with, so
   * an edit from a sync client, git or another editor stayed invisible, and the
   * next keystroke here wrote over it. With an edit here not yet on disk, our
   * own saves echoing back are ignored and anything else asks the user (see
   * decideExternalChange).
   */
  const followDisk = useCallback((path: string, content: string) => {
    if (!(path in docsRef.current)) return;
    const pending = savingDocs.current.has(path) || failedSaves.current.has(path) || !!conflictsRef.current[path];
    const ours = [docsRef.current[path], onDisk.current.get(path), ...(inFlight.current.get(path) ?? [])];
    const decision = decideExternalChange({ disk: content, pending, ours });
    if (decision === 'ask') { if (!conflictsRef.current[path]) setConflict(path, true); return; }
    onDisk.current.set(path, content);
    if (decision === 'ignore') return;
    // Checked again as it applies: a keystroke may have started a save since.
    setDocs(current => !(path in current) || current[path] === content || savingDocs.current.has(path) || conflictsRef.current[path] ? current : { ...current, [path]: content });
  }, [setConflict]);
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
    return window.electronAPI.repository.onChanged((repo) => {
      setRepository(repo);
      void window.electronAPI.repository.listRecent().then(setRecents);
    });
  }, [reloadRepoState]);
  const createRepository = useCallback(async () => {
    // The folder may open in its own window, so ask what this window shows now.
    if (await window.electronAPI?.repository.create()) void reloadRepoState();
  }, [reloadRepoState]);
  const openRepository = useCallback(async () => {
    if (await window.electronAPI?.repository.open()) void reloadRepoState();
  }, [reloadRepoState]);
  // Every way of opening a workspace by path ends here: the welcome page, the
  // switcher, the palette and Settings › Workspaces. A folder that is gone says
  // so, and the list is asked again so it shows the folder as missing.
  const switchRepository = useCallback(async (dir: string) => {
    if (!window.electronAPI) return;
    let result: { success: boolean; error?: string };
    try { result = await window.electronAPI.repository.switch(dir); }
    catch { result = { success: false }; }
    if (!result.success) setNotice(result.error || 'Could not open that workspace.');
    void reloadRepoState();
  }, [reloadRepoState]);
  // A folder can come back (a drive plugged in) or go away while the window is
  // in the background; coming back to it asks for the list again.
  useEffect(() => {
    if (!window.electronAPI) return;
    const refresh = () => { void window.electronAPI.repository.listRecent().then(setRecents).catch(() => {}); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

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
      // An image or text file open in a tab is not a note but is still there.
      const listed = listing ? new Set(listing.files) : null;
      const text = new Set(listing?.text ?? []);
      setEditor((current) => removeMissingAll(current, (path) => fileList.includes(path)
        || (listed ? listed.has(path) && opensAsFile(path, text) : opensAsFile(path, text))));
      // Configuration is reachable in the explorer but is not knowledge: it is
      // not a graph node, it has no wiki-links, its words are not yours, and it
      // should not turn up in a search for something you wrote. `notes` keeps
      // it so it can be opened; `notesData` -- what the graph, tags, search and
      // link index are all built from -- does not. Nor does a CSV: it is data,
      // not a note, and can be far larger than anything worth holding here.
      // Nor a note over 25 MB: it is listed, but main will not read it, so it
      // has no links, tags or search. The listing's size spares asking; when
      // the listing has none, main's answer says so.
      const data = await Promise.all(
        fileList
          .filter((path) => !path.startsWith('.neuron/') && !isCsvPath(path) && !tooLargeToOpen(listing?.info[path]?.size))
          .map(async (path) => ({ path, content: await window.electronAPI.readNote(path) })),
      );
      setNotesData(data.filter((note) => note.content !== TOO_LARGE_TO_OPEN));

    } catch {
      setNotice('Could not load the workspace.');
    }
  }, [loadEntries]);

  useEffect(() => {
    if (!repository) { setNotes([]); setNotesData([]); setEntries(null); setTags([]); setEditor((current) => ({ ...current, groups: current.groups.map((group) => ({ ...group, selected: null })) })); return; }
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

  // Main sends this once per workspace in this window, when the watcher stops
  // for want of folder watches (Linux) or file handles.
  useEffect(() => window.electronAPI?.onWatchLimit?.(() => setNotice(
    'Neuron can\'t watch every folder in this workspace, so changes made outside Neuron may not appear until you reopen the file. On Linux, raise fs.inotify.max_user_watches.',
  )), []);

  // A preview belongs to the workspace it was opened in. Keyed on the path,
  // because the same workspace re-reported is a new object.
  const repositoryPath = repository?.path ?? null;
  const repositoryPathRef = useRef(repositoryPath);
  repositoryPathRef.current = repositoryPath;
  useEffect(() => {
    setEditor(dropPreviews);
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
    let shellConfigTimer: ReturnType<typeof setTimeout> | undefined;
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
        // Our own rename: its tabs have already followed it, and one still on
        // the old path is mid-move, not deleted.
        const ours = [...movedAway.current].some(([from, at]) => Date.now() - at < 10_000 && (path === from || path.startsWith(from + '/')));
        if (!ours) setEditor(current => removeMissingAll(current, n => !removed(n)));
      } else {
        // A text file (JSON, YAML, ...) is not a note: it never joins the notes
        // or what the graph and search read, and it is read only when open.
        const listed = isListedFile(path);
        if (!listed && !(path in docsRef.current)) return;
        void window.electronAPI.readNote(path).then(content => {
          if (cancelled || versions.get(path) !== version) return;
          if (content === TOO_LARGE_TO_OPEN) {
            // Past 25 MB: listed, never read.
            if (listed) setNotes(current => current.includes(path) ? current : [...current, path].sort());
            setNotesData(current => current.some(n => n.path === path) ? current.filter(n => n.path !== path) : current);
            setDocs(current => path in current && current[path] !== content ? { ...current, [path]: content } : current);
            return;
          }
          if (content.startsWith('Error:')) return;
          if (listed) {
            setNotes(current => current.includes(path) ? current : [...current, path].sort());
            if (!path.startsWith('.neuron/') && !isCsvPath(path)) setNotesData(current => {
              const existing = current.find(n => n.path === path);
              if (existing?.content === content) return current;
              return existing ? current.map(n => n.path === path ? { path, content } : n) : [...current, { path, content }];
            });
          }
          followDisk(path, content);
        }).catch(() => { if (!cancelled) setNotice('Could not update the changed note.'); });
      }
      if (path !== SHELL_CONFIG) return;
      // A save can arrive as several events (truncate, then the content), and
      // the first read may land between them. Read once the file has been quiet,
      // and treat an empty file as a write in progress rather than a change.
      clearTimeout(shellConfigTimer);
      shellConfigTimer = setTimeout(() => {
        void window.electronAPI?.readNote(SHELL_CONFIG).then((content) => {
          if (cancelled) return;
          if (content.startsWith('Error:')) {
            adoptShellConfig(null);
            setPendingShellConfig(null);
            return;
          }
          if (content.trim() === '') return;
          offerShellConfig(content);
        });
      }, 250);
    });
    return () => { cancelled = true; clearTimeout(shellConfigTimer); unsubscribe(); };
  }, [repository, adoptShellConfig, offerShellConfig, followDisk]);

  // Read each file a group shows, once however many show it, and forget the
  // ones no group shows any more. Keyed on the list, not the groups, so moving
  // tabs about reads nothing.
  const shownKey = [...new Set(editor.groups.map((group) => group.selected).filter((path): path is string => !!path && !isUrl(path)))].sort().join('\n');
  useEffect(() => {
    const shown = shownKey ? shownKey.split('\n') : [];
    const keep = <T,>(current: Record<string, T>) => {
      const kept = Object.fromEntries(Object.entries(current).filter(([path]) => shown.includes(path)));
      return Object.keys(kept).length === Object.keys(current).length ? current : kept;
    };
    setDocs(keep);
    setSaveStates(keep);
    // A file no group shows has no edit pending here any more.
    for (const path of Object.keys(conflictsRef.current)) if (!shown.includes(path)) setConflict(path, false);
    for (const path of failedSaves.current) if (!shown.includes(path)) failedSaves.current.delete(path);
    for (const path of onDisk.current.keys()) if (!shown.includes(path)) onDisk.current.delete(path);
    let cancelled = false;
    for (const path of shown) {
      if (path in docsRef.current) continue;
      const adopt = (content: string) => {
        if (!onDisk.current.has(path)) onDisk.current.set(path, content);
        setDocs((current) => (path in current ? current : { ...current, [path]: content }));
        setSaveStates((current) => ({ ...current, [path]: 'saved' }));
      };
      // Media streams from neuron-file://; its bytes never come through here.
      if (isMediaPath(path)) { adopt(''); continue; }
      if (!window.electronAPI) continue;
      window.electronAPI.readNote(path).then((content) => { if (!cancelled) adopt(content); })
        .catch(() => { if (!cancelled) setNotice(`Could not open “${path}”.`); });
    }
    return () => { cancelled = true; };
  }, [shownKey]);

  // A preview by default: most routes here are a look at a file, and only a
  // double click, creating something or editing it says to keep the tab.
  // It opens in the focused group unless a group is named.
  const handleSelectNote = useCallback((note: string, options?: { keep?: boolean; group?: number }) => {
    // Programs and scripts never open, whichever route asked (a wiki-link, say).
    if (!isUrl(note) && fileKind(note) === 'blocked') { setNotice(`Neuron does not open programs or scripts. “${note}” stays in its folder.`); return; }
    setEditor((current) => openInGroup(current, note, options?.keep === true, options?.group ?? current.focused));
    setView('notes');
    // Opening a file leaves home, whichever route got here -- sidebar, explorer,
    // command palette or a wiki-link. One place to clear it, because a second
    // route that forgot would leave the explorer covering the note it opened.
    setHomeGroup(null);
    if (!isUrl(note)) setExplorerRecents((current) => addRecent(current, { path: note, kind: 'file' }));
    setNotice(null);
  }, []);
  const keepNote = useCallback((note: string) => handleSelectNote(note, { keep: true }), [handleSelectNote]);

  /** Show the workspace explorer in a group (the focused one) without disturbing what is already open. */
  const goHome = useCallback((folder = '', group?: number) => {
    setView('notes');
    setExplorerFolder(folder);
    const index = group ?? editorStateRef.current.focused;
    setEditor((current) => focusGroup(current, index));
    setHomeGroup(index);
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
  // Images, video, audio and text open in surfaces of their own; programs,
  // scripts and binaries stay other files.
  const noteSet = useMemo(() => new Set(notes), [notes]);
  const textFiles = useMemo(() => new Set(entries?.text ?? []), [entries]);
  const { openFiles, otherFiles } = useMemo(() => {
    const open: string[] = [];
    const other: string[] = [];
    for (const path of entries?.files ?? []) {
      if (noteSet.has(path)) continue;
      (opensAsFile(path, textFiles) ? open : other).push(path);
    }
    return { openFiles: open, otherFiles: other };
  }, [entries, noteSet, textFiles]);
  const treeFolders = useMemo(
    () => [...new Set([...createdFolders, ...(entries?.folders ?? [])])],
    [createdFolders, entries],
  );
  const explorerOther = useMemo(() => otherFiles.filter(notInConfig), [otherFiles]);
  const explorerFiles = useMemo(() => [...explorerPaths, ...openFiles.filter(notInConfig)], [explorerPaths, openFiles]);
  const explorerAllPaths = useMemo(() => [...explorerFiles, ...explorerOther], [explorerFiles, explorerOther]);
  const explorerFolders = useMemo(() => treeFolders.filter(notInConfig), [treeFolders]);
  const revealFile = useCallback((path: string) => {
    void window.electronAPI?.revealInFolder(path).then((result) => {
      if (!result.success) setNotice(`Could not show “${path}” in its folder.`);
    });
  }, []);

  /**
   * Write the notes whose links a change rewrote, in one call that journals
   * each on its own, and say how many. Open copies take the new text first, so
   * the next keystroke in one does not save the old link back.
   */
  const applyLinkPlan = useCallback(async (plan: LinkRewritePlan, target: string) => {
    if (!plan.edits.length || !window.electronAPI) return;
    const changed = new Map(plan.edits.map((edit) => [edit.path, edit.content]));
    for (const [path, content] of changed) {
      onDisk.current.set(path, content);
      if (path in docsRef.current) docsRef.current = { ...docsRef.current, [path]: content };
    }
    setDocs((current) => {
      let next = current;
      for (const [path, content] of changed) if (path in next && next[path] !== content) next = { ...next, [path]: content };
      return next;
    });
    setNotesData((current) => current.map((note) => (changed.has(note.path) ? { ...note, content: changed.get(note.path)! } : note)));
    let result: { success: boolean; error?: string; written?: number };
    try { result = await window.electronAPI.writeLinks(plan.edits); } catch (error) { result = { success: false, error: String(error) }; }
    if (!result.success) setNotice(`Some links could not be updated. ${result.error ?? ''}`.trim());
    if (result.success || result.written) setInfo(linkNotice(plan.count, target));
  }, []);

  /** Links a new file would take from a note of the same name, rewritten so they stay (11D). */
  const planForNewFile = useCallback((path: string): LinkRewritePlan | null => {
    const files = notesRef.current;
    const name = linkName(path).toLowerCase();
    if (files.includes(path) || !files.some((file) => linkName(file).toLowerCase() === name)) return null;
    const aliases = aliasesOf(notesDataRef.current);
    return planLinkRewrites({ notes: notesDataRef.current, before: buildWikiIndex(files, aliases), after: buildWikiIndex([...files, path], aliases) });
  }, []);

  const createNote = useCallback(async (relativePath: string, content?: string, companions: { path: string; content: string }[] = []): Promise<boolean> => {
    if (!window.electronAPI) return false;
    try {
      const title = relativePath.split('/').pop()!.replace(/\.(md|mdx)$/, '');
      const body = content ?? '# ' + title + '\n\n';
      const plan = planForNewFile(relativePath);
      // First, so the file is what its companions describe from the moment it opens.
      for (const companion of companions) {
        const written = await window.electronAPI.writeNote(companion.path, companion.content);
        if (!written.success) { setNotice('Could not create “' + relativePath + '”. ' + (written.error ?? '')); return false; }
      }
      const result = await window.electronAPI.writeNote(relativePath, body);
      if (!result.success) { setNotice('Could not create “' + relativePath + '”. ' + (result.error ?? '')); return false; }
      if (plan) await applyLinkPlan(plan, plan.targets[0] ?? relativePath);
      await loadNotes();
      handleSelectNote(relativePath, { keep: true });
      setEditorModes(current => ({ ...current, [relativePath]: 'live' }));
      return true;
    } catch {
      setNotice('Could not create “' + relativePath + '”.');
      return false;
    }
  }, [loadNotes, handleSelectNote, planForNewFile, applyLinkPlan]);

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
    setEditor((current) => removeMissingAll(current, (path) => path !== note));
    await loadNotes();
    return true;
  }, [loadNotes]);

  // The one save path for every file a group shows, however many show it: the
  // new text reaches every group at once, and only the latest write reports:
  // the others, and one held back by an outside change, resolve to null.
  const writeDoc = useCallback(async (path: string, value: string): Promise<SaveResult | null> => {
    // Kept in the same update as the change itself, so a preview never holds
    // an unsaved edit and the next single click cannot replace a tab mid-save.
    setEditor((current) => keepEverywhere(current, path));
    setDocs((current) => (current[path] === value ? current : { ...current, [path]: value }));
    docsRef.current = { ...docsRef.current, [path]: value };
    if (!window.electronAPI) return null;
    setNotesData((previous) => previous.map((note) => (note.path === path ? { ...note, content: value } : note)));
    // Changed outside Neuron while this edit was pending: nothing is written
    // until the user picks a version.
    if (conflictsRef.current[path]) return null;
    const version = (saveVersions.current.get(path) ?? 0) + 1;
    saveVersions.current.set(path, version);
    setSaveStates((current) => ({ ...current, [path]: 'saving' }));
    savingDocs.current.add(path);
    inFlight.current.set(path, [...(inFlight.current.get(path) ?? []), value]);
    let result: { success: boolean; error?: string };
    try { result = await window.electronAPI.writeNote(path, value); } catch (error) { result = { success: false, error: String(error) }; }
    if (version !== saveVersions.current.get(path)) return null;
    savingDocs.current.delete(path);
    // Saves of one file land in order (main queues them), so after the latest
    // only its text is on disk -- or, if it failed, what was there before.
    inFlight.current.delete(path);
    if (result.success) { onDisk.current.set(path, value); failedSaves.current.delete(path); } else failedSaves.current.add(path);
    setSaveStates((current) => (path in current ? { ...current, [path]: result.success ? 'saved' : 'error' } : current));
    if (result.success && path === SHELL_CONFIG) offerShellConfig(value);
    if (!result.success) setNotice(`Changes to “${path}” could not be saved.`);
    return result;
  }, [offerShellConfig]);

  // The two ways out of a conflict (ExternalChangeBar).
  const keepMyVersion = useCallback((path: string) => {
    setConflict(path, false);
    const mine = docsRef.current[path];
    if (mine !== undefined) void writeDoc(path, mine);
  }, [setConflict, writeDoc]);
  const takeDiskVersion = useCallback(async (path: string) => {
    const content = await window.electronAPI.readNote(path);
    if (content.startsWith('Error:') && content !== TOO_LARGE_TO_OPEN) { setNotice(`Could not read “${path}”.`); return; }
    setConflict(path, false);
    failedSaves.current.delete(path);
    inFlight.current.delete(path);
    onDisk.current.set(path, content);
    // A save still in flight from before can no longer report over this.
    saveVersions.current.set(path, (saveVersions.current.get(path) ?? 0) + 1);
    savingDocs.current.delete(path);
    docsRef.current = { ...docsRef.current, [path]: content };
    setDocs((current) => (path in current ? { ...current, [path]: content } : current));
    setSaveStates((current) => (path in current ? { ...current, [path]: 'saved' } : current));
    if (content !== TOO_LARGE_TO_OPEN) setNotesData((previous) => previous.map((note) => (note.path === path ? { ...note, content } : note)));
  }, [setConflict]);
  /**
   * Rename or move a file or folder (11E): F2, the menus, Move to… and a drop
   * on a folder all end here, and main's workspace:rename does the move. Open
   * tabs in every group follow it with their unsaved text, and links that
   * reached it (or that a new duplicate name would take) are rewritten.
   * Resolves to an error to show, or null.
   */
  const movePath = useCallback(async (from: string, to: string): Promise<string | null> => {
    if (!window.electronAPI || from === to) return null;
    const map = (path: string) => movedPath(path, from, to);
    const files = notesRef.current;
    const aliases = aliasesOf(notesDataRef.current);
    // Planned from the workspace as it is now, before anything moves.
    const plan = planLinkRewrites({
      notes: notesDataRef.current,
      before: buildWikiIndex(files, aliases),
      after: buildWikiIndex(files.map((path) => map(path) ?? path), aliases.map(([path, list]) => [map(path) ?? path, list] as [string, string[]])),
      move: map,
    });
    movedAway.current.set(from, Date.now());
    let result: { success: boolean; error?: string };
    try { result = await window.electronAPI.renamePath(from, to); } catch (error) { result = { success: false, error: String(error) }; }
    if (!result.success) { movedAway.current.delete(from); return result.error ?? `Could not rename “${from}”.`; }
    const remap = <T,>(record: Record<string, T>): Record<string, T> => {
      if (!Object.keys(record).some((path) => map(path))) return record;
      return Object.fromEntries(Object.entries(record).map(([path, value]) => [map(path) ?? path, value]));
    };
    const remapKeys = <T,>(store: Map<string, T>) => {
      for (const [path, value] of [...store]) { const next = map(path); if (next) { store.delete(path); store.set(next, value); } }
    };
    // Unsaved text goes with the tab: the copy here is the user's latest.
    const unsaved = Object.keys(docsRef.current).filter((path) => map(path) && docsRef.current[path] !== onDisk.current.get(path));
    docsRef.current = remap(docsRef.current);
    remapKeys(onDisk.current);
    setDocs(remap);
    setSaveStates(remap);
    setEditorModes(remap);
    setSurfaceSourceMode(remap);
    setEditor((current) => renameInGroups(current, map));
    setCreatedFolders((current) => current.map((path) => map(path) ?? path));
    setExplorerFolder((current) => (current ? map(current) ?? current : current));
    setExplorerRecents((current) => current.map((entry) => ({ ...entry, path: map(entry.path) ?? entry.path })));
    for (const path of unsaved) { const next = map(path)!; void writeDoc(next, docsRef.current[next]); }
    if (plan.edits.length) await applyLinkPlan(plan, plan.targets.length === 1 ? plan.targets[0] : to);
    await loadNotes();
    return null;
  }, [writeDoc, applyLinkPlan, loadNotes]);
  // A drop on a folder: the same move, keeping the name.
  const moveInto = useCallback((path: string, folder: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const to = (folder ? folder + '/' : '') + name;
    if (to === path) return;
    void movePath(path, to).then((error) => { if (error) setNotice(error); });
  }, [movePath]);

  const handleContentChange = useCallback((value: string) => { if (selectedNote) void writeDoc(selectedNote, value); }, [selectedNote, writeDoc]);

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

  // Open a website as a browser tab. The hash keeps each new tab a distinct key;
  // the in-view URL bar lets the user navigate anywhere from there.
  const openWebsite = useCallback(() => {
    const n = ++browserCounter.current;
    const url = `https://duckduckgo.com/#neuron-tab-${n}`;
    handleSelectNote(url, { keep: true });
  }, [handleSelectNote]);

  // "Open to the side" is a split to the right with that file. When the editor
  // cannot split to the right any more, the file opens in the next group.
  const openToSide = useCallback((path: string) => {
    setEditor((current) => (canSplit(current, 'row')
      ? splitGroup(current, current.focused, path, 'row')
      : openInGroup(current, path, true, current.focused < current.groups.length - 1 ? current.focused + 1 : current.focused - 1)));
    setHomeGroup(null);
    setView('notes');
  }, []);

  // --- Editor groups --------------------------------------------------------
  /** A new group from a tab of group `group` (the focused one's file by default): a copy, or a move when dragged. */
  const splitEditor = useCallback((direction: SplitDirection, group?: number, path?: string, move = false) => {
    setEditor((current) => {
      const from = group ?? current.focused;
      const file = path ?? current.groups[from]?.selected;
      return file ? splitGroup(current, from, file, direction, move) : current;
    });
    setHomeGroup(null);
    setView('notes');
  }, []);
  // A group that closes leaves home behind it; the last group emptied shows home.
  const afterClose = (current: GroupsState, next: GroupsState) => {
    if (next.groups.length === 1 && !next.groups[0].tabs.length) { setExplorerFolder(''); setHomeGroup(0); }
    else if (next.groups.length !== current.groups.length) setHomeGroup(null);
    return next;
  };
  const closeTab = useCallback((group: number, note: string) => {
    setEditor((current) => afterClose(current, closeInGroup(current, group, note)));
  }, []);
  const closeEditorGroup = useCallback(() => {
    setEditor((current) => afterClose(current, closeGroup(current, current.focused)));
  }, []);
  const focusEditorGroup = useCallback((group: number) => setEditor((current) => focusGroup(current, group)), []);
  const focusNextGroup = useCallback(() => setEditor((current) => focusGroup(current, (current.focused + 1) % current.groups.length)), []);
  const moveEditorTab = useCallback((from: number, to: number, path: string, before: string | null) => {
    setEditor((current) => afterClose(current, moveTab(current, from, to, path, before)));
    setView('notes');
  }, []);

  // Which surface a file opens in: by extension, or, for a file outside the
  // note listing, by kind (an image, a video, a text file).
  const surfaceFor = useCallback((path: string) => {
    const byKind = !noteSet.has(path) ? getKindSurface(kindIn(path, textFiles)) : undefined;
    return { Surface: getSurface(path) ?? byKind, byKind: !!byKind };
  }, [noteSet, textFiles]);

  // The arrangement is remembered per workspace and per machine, beside the
  // explorer's recents. It is read back once the listing is in, so files gone
  // meanwhile are left out, and only into an editor still empty: anything the
  // user opened before it arrived wins.
  const groupsLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!repository || !entries || !window.electronAPI || groupsLoadedFor.current === repository.path) return;
    const workspace = repository.path;
    const listed = new Set(entries.files);
    const exists = (path: string) => noteSet.has(path) || (listed.has(path) && opensAsFile(path, textFiles));
    let cancelled = false;
    void Promise.all([
      window.electronAPI.settings.get<unknown>(GROUPS_KEY + workspace),
      window.electronAPI.settings.get<unknown>('editorSplit'),
    ]).then(([stored, legacy]) => {
      if (cancelled) return;
      groupsLoadedFor.current = workspace;
      const restored = restoreGroups(stored, exists);
      const current = editorStateRef.current;
      const empty = current.groups.length === 1 && !current.groups[0].tabs.length;
      let next = restored && empty ? restored.state : current;
      if (restored && empty) groupSizes.current = restored.sizes;
      // The side pane this replaced kept one note beside the editor in a
      // setting of its own. Once: that note becomes a group to the right.
      if (legacy != null) {
        void window.electronAPI.settings.set('editorSplit', null);
        if (typeof legacy === 'string' && exists(legacy) && canSplit(next, 'row') && !next.groups.some((group) => group.selected === legacy)) {
          next = { ...splitGroup(next, next.focused, legacy, 'row'), focused: next.focused };
        }
      }
      if (next !== current) setEditor(next);
    }).catch(() => { if (!cancelled) groupsLoadedFor.current = workspace; });
    return () => { cancelled = true; };
  }, [repository, entries, noteSet, textFiles]);

  // Stored a moment after the last change, for the workspace it belongs to.
  const saveGroupsTimer = useRef<ReturnType<typeof setTimeout>>();
  const saveGroups = useCallback(() => {
    const workspace = groupsLoadedFor.current;
    if (!workspace || workspace !== repositoryPathRef.current) return;
    const stored = serializeGroups(editorStateRef.current, groupSizes.current ?? undefined);
    clearTimeout(saveGroupsTimer.current);
    saveGroupsTimer.current = setTimeout(() => { void window.electronAPI?.settings.set(GROUPS_KEY + workspace, stored); }, 150);
  }, []);
  useEffect(saveGroups, [editor, saveGroups]);
  const onGroupSizes = useCallback((sizes: number[]) => { groupSizes.current = sizes; saveGroups(); }, [saveGroups]);

  const explorerState = useMemo(() => ({
    atHome, repositoryName: repository?.name ?? 'Workspace', paths: explorerFiles,
    otherFiles: explorerOther, fileInfo: entries?.info ?? {}, skipped: entries?.skipped ?? 0, truncated: entries?.truncated ?? false,
    folders: explorerFolders, notesData, folder: explorerFolder, navigate: navigateExplorer,
    openFile: handleSelectNote, openToSide, createNote, createFolder: createSectionFolder, reveal: revealFile,
    editorModes, recents: explorerRecents, clearRecents: clearExplorerRecents,
    fileAction: setFileAction, moveInto,
  }), [atHome, repository, explorerFiles, explorerOther, entries, explorerFolders, notesData, explorerFolder, navigateExplorer,
    handleSelectNote, openToSide, createNote, createSectionFolder, revealFile, editorModes, explorerRecents, clearExplorerRecents, moveInto]);

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
  // Text files (JSON, YAML, logs, code, unknown names that start as text): the
  // search reads these itself when it runs, so they never join notesData.
  // Configuration under .neuron/ is not something you wrote, as for notes.
  const searchTextFiles = useMemo(
    () => openFiles.filter((path) => !path.startsWith('.neuron/') && (fileKind(path) === 'text' || textFiles.has(path))),
    [openFiles, textFiles],
  );
  const fileSizeOf = useCallback((path: string) => entries?.info[path]?.size, [entries]);
  const openAt = useCallback((path: string, line: number) => {
    requestReveal(path, line);
    handleSelectNote(path);
  }, [handleSelectNote]);

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
        case 'split-editor-right': splitEditor('row'); break;
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

  const colorScheme = PRESETS[appearance.preset]?.colorScheme ?? 'dark';
  const browsing = isUrl(selectedNote);
  const Surface = selectedNote && !browsing ? surfaceFor(selectedNote).Surface : undefined;

  // What every editor group shares: the files' one copy and one save path, and
  // the actions each group's tabs and drops call with its index.
  const groupContext = useMemo<GroupContext>(() => ({
    notes, wikiIndex, tags, notesData, colorScheme, wide, properties: propsSettings,
    editorModes, onEditorMode: (path, mode) => setEditorModes((prev) => ({ ...prev, [path]: mode })),
    surfaceSource: surfaceSourceMode, onSurfaceSource: (path, source) => setSurfaceSourceMode((prev) => ({ ...prev, [path]: source })),
    docs, saveStates, onChange: writeDoc,
    conflicts, onKeepMine: keepMyVersion, onUseDisk: (path) => { void takeDiskVersion(path); },
    surfaceFor, fileSize: (path) => entries?.info[path]?.size, onTagClick: setSelectedTag,
    home: (
      // What used to be a blank "Choose a note to begin" panel. Nothing selected
      // means the explorer at the workspace root; the tabs, if any, are untouched.
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
        onFileAction={explorerState.fileAction}
        onMoveInto={explorerState.moveInto}
      />
    ),
    onOpen: (path, group) => handleSelectNote(path, { group }),
    onKeep: (group, path) => setEditor((current) => mapGroup(current, group, (tabs) => keepTab(tabs, path))),
    onClose: closeTab,
    onNewTab: (group) => goHome('', group),
    onNewBrowser: (group) => { focusEditorGroup(group); openWebsite(); },
    onFocus: focusEditorGroup,
    onSplit: (group, path, direction, move) => splitEditor(direction, group, path, move),
    onMoveTab: moveEditorTab,
  }), [notes, wikiIndex, tags, notesData, colorScheme, wide, propsSettings, editorModes, surfaceSourceMode, docs, saveStates, writeDoc, surfaceFor, entries,
    conflicts, keepMyVersion, takeDiskVersion, explorerState, handleSelectNote, closeTab, goHome, focusEditorGroup, openWebsite, splitEditor, moveEditorTab]);

  // Home wins over a group's file, which is what lets the New tab action show
  // the explorer without closing tabs -- they stay in the strip, and clicking
  // one calls handleSelectNote, which clears home and brings it back.
  const notesView = (
    <EditorGroups ctx={groupContext} state={editor} homeGroup={homeGroup} zen={layout.zen} sizes={groupSizes.current} onSizes={onGroupSizes} />
  );

  // The layout shell holds a split editor in its editor slot, and a single
  // group's plain note; zen shows one group, so it is single there.
  const shellGroups = !!layoutShell && editor.groups.length > 1 && !layout.zen;
  const inShell = view === 'notes' && !!layoutShell && (shellGroups || (!Surface && !browsing));
  let mainContent: React.ReactNode;
  if (view === 'gallery') {
    mainContent = <ComponentGallery colorScheme={colorScheme} />;
  } else if (inShell) {
    // With one group the shell handles plain notes in its editor slot; surface
    // files (.html, .db, .canvas) and browser tabs are full-page documents, so they
    // fall through to the plain editor. A split editor goes into the slot whole,
    // every group rendering its own files as it does without a shell.
    mainContent = (
      <div className="flex h-full w-full flex-col">
        <div className="min-h-0 flex-1">
          <LayoutSurface
            editorGroups={shellGroups ? notesView : undefined}
            // One group: the shell's editor panel is that group, so dragging
            // a tab to its right or bottom edge makes the first split.
            editorZones={shellGroups ? undefined : <ShellSplitZones ctx={groupContext} state={editor} />}
            editorHeader={<EditorGroupHeader ctx={groupContext} state={editor} index={editor.focused} showsHome={atHome} inLayout />}
            path={SHELL_CONFIG}
            content={layoutShell}
            notesData={notesData}
            onSelectNote={handleSelectNote}
            selectedNote={selectedNote}
            noteContent={noteContent}
            onChangeNote={handleContentChange}
            colorScheme={colorScheme}
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

  // The app's one notice, over whatever this window shows: notes, the welcome
  // page, or Settings.
  const noticeCallout = notice && (
    <div role="alert" data-callout-kind="error" className="callout absolute left-1/2 top-3 z-50 flex max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2.5 px-3 py-2 text-xs text-[var(--ink)]">
      <CalloutIcon kind="error" />
      <span>{notice}</span>
      <button className="interactive min-h-[28px] text-[var(--danger)] hover:text-[var(--ink)]" onClick={() => setNotice(null)}>Dismiss</button>
    </div>
  );

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
            onSwitchRepo={switchRepository}
            onReloadRepos={reloadRepoState}
            notice={noticeCallout}
          />
        </TooltipProvider>
      </PluginProvider>
    );
  }

  return (
    <PluginProvider catalog={builtinPlugins} bridge={bridge} workspace={repository?.path ?? null}>
      <ExplorerProvider value={explorerState}>
      <TooltipProvider delayDuration={300}>
        {/* Zen removes the chrome, the status bar with it; its own setting is untouched. */}
        <div className={`workspace-grid app-shell font-sans${layout.statusBar && !layout.zen ? '' : ' no-status'}${layout.zen ? ' zen' : ''}`}>
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
            <RepositoryOnboarding recents={recents} onSwitch={switchRepository} onCreate={createRepository} onOpen={openRepository}
              onReload={reloadRepoState} notice={noticeCallout} />
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
                  openFiles={selectedTag ? NO_FILES : openFiles}
                  textFiles={selectedTag ? NO_FILES : searchTextFiles}
                  fileSize={fileSizeOf}
                  onOpenAt={openAt}
                  onReveal={revealFile}
                  revealedFolder={revealedFolder}
                  tags={tags}
                  onSelectTag={setSelectedTag}
                  selectedTag={selectedTag}
                  onFileAction={setFileAction}
                  onMoveInto={moveInto}
                />
              }>
              {/* One card, or one per group when the editor is split, like the docks. */}
              <main className={cn('relative flex h-full w-full min-w-0 flex-col overflow-hidden',
                !inShell && !(view === 'notes' && editor.groups.length > 1 && !layout.zen) && 'shell-card')}>
                {noticeCallout}
                {info && !notice && (
                  <div role="status" data-callout-kind="info" data-link-notice className="callout absolute left-1/2 top-3 z-50 flex max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2.5 px-3 py-2 text-xs text-[var(--ink)]">
                    <CalloutIcon kind="info" />
                    <span>{info}</span>
                    <button className="interactive min-h-[28px] rounded px-2 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setInfo(null)}>Dismiss</button>
                  </div>
                )}
                {pendingShellConfig && !readableLayout(pendingShellConfig) && (
                  // A broken file is never offered: the layout on screen stays.
                  <div role="status" data-callout-kind="warning" data-layout-unreadable className="callout absolute left-1/2 top-3 z-50 flex max-w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2.5 px-3 py-2 text-xs text-[var(--ink)]">
                    <CalloutIcon kind="warning" />
                    <span>Neuron can’t read the workspace layout (.neuron/layout.json): it isn’t a valid layout. The current layout stays until the file is fixed.</span>
                    <button className="interactive min-h-[28px] rounded px-2 text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setPendingShellConfig(null)}>Dismiss</button>
                  </div>
                )}
                {pendingShellConfig && readableLayout(pendingShellConfig) && (
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
            </Workbench>
            </div>
          )}

          {layout.statusBar && !layout.zen && <StatusBar activeNote={view === 'notes' ? selectedNote : null} saveState={saveState} layout={layout} onLayoutChange={patchLayout} onOpenPlugins={openPlugins} terminalChord={bindings['toggle-terminal']} />}
          <TerminalShortcut toggleRef={toggleTerminalRef} showRef={showTerminalRef} layout={layout} onLayoutChange={patchLayout} onOpenPlugins={openPlugins} />
          <WorkspacePanelsApplier content={workspacePanels} layoutReady={layoutReady} layout={layout} onLayoutChange={patchLayout} onDone={clearWorkspacePanels} />
        </div>

        <ChromeImportDialog open={chromeImportOpen} onOpenChange={setChromeImportOpen} onImported={setNotice} />
        <FileActionDialog action={fileAction} folders={treeFolders} onClose={() => setFileAction(null)} onMove={movePath} />
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
          onImportChromeLogins={() => setChromeImportOpen(true)}
          layout={layout}
          onLayoutChange={patchLayout}
          onResetLayout={() => { zenPrevRef.current = null; commitLayout({ ...DEFAULT_LAYOUT, panels: {} }); }}
          savedLayouts={savedLayouts}
          onApplySavedLayout={applySavedLayout}
          onSearchNotes={() => { setView('notes'); patchLayout({ sidebar: true, sidebarCollapsed: false }); setSidebarMode('search'); }}
          editorGroups={editor.groups.length}
          canSplitRight={!!selectedNote && !atHome && canSplit(editor, 'row')}
          canSplitDown={!!selectedNote && !atHome && canSplit(editor, 'column')}
          onSplitEditor={splitEditor}
          onCloseEditorGroup={closeEditorGroup}
          onFocusNextGroup={focusNextGroup}
          bindings={bindings}
        />
        {repository && (
          <WorkspaceSettingsDialog
            section={workspaceSettings}
            onSectionChange={setWorkspaceSettings}
            workspace={repository}
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
