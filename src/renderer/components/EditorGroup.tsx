import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, FileCode2 } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Editor from './Editor';
import MDXPreview from './MDXPreview';
import FullWidthToggle from './FullWidthToggle';
import BrowserView from './BrowserView';
import NoteTabs, { readDraggedTab, TAB_MIME } from './NoteTabs';
import { Segmented } from './ui/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { cn } from '../lib/utils';
import { isCsvPath } from '../lib/csv-table';
import { splitBlocked, type GroupsState, type SplitDirection, type TabState } from '../lib/tabs';
import { SurfaceBoundary } from '../surfaces/SurfaceBoundary';
import { EDIT_MODES, EDITOR_MODE_SLOT, type EditMode } from '../surfaces/panels';
import type { NoteData, Surface } from '../surfaces';
import { fileKind, MEDIA_KINDS } from '../../main/file-kinds';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const SAVE_LABEL: Record<SaveState, string> = { idle: 'No note open', saving: 'Saving…', saved: 'Saved locally', error: 'Save failed' };
const isUrl = (s: string) => /^https?:\/\//.test(s);

/** Tick or untick the task on one source line. Null when the line holds no task. */
export function toggleTaskLine(content: string, lineIndex: number, checked: boolean): string | null {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return null;
  const next = checked ? line.replace(/\[( | )\]/, '[x]') : line.replace(/\[[xX]\]/, '[ ]');
  if (next === line) return null;
  lines[lineIndex] = next;
  return lines.join('\n');
}

/**
 * What every editor group shares. Files have one copy and one writer here, not
 * one per group: `docs` holds the content of every file a group shows, and
 * `onChange` is the single save path, so a note open in two groups is the same
 * document in both.
 */
export interface GroupContext {
  notes: string[];
  tags: string[];
  notesData: NoteData[];
  colorScheme: 'dark' | 'light';
  /** Wide enough for Split mode to show source and preview side by side. */
  wide: boolean;
  properties: { removeEmpty: boolean; showInReading: boolean; collapsedByDefault: boolean };
  editorModes: Record<string, EditMode>;
  onEditorMode: (path: string, mode: EditMode) => void;
  surfaceSource: Record<string, boolean>;
  onSurfaceSource: (path: string, source: boolean) => void;
  docs: Record<string, string>;
  saveStates: Record<string, SaveState>;
  onChange: (path: string, value: string) => void;
  /** The surface a file opens in, and whether a by-kind surface applies (image, media, text), which has no source view. */
  surfaceFor: (path: string) => { Surface?: Surface; byKind: boolean };
  fileSize: (path: string) => number | undefined;
  onTagClick: (tag: string) => void;
  /** What a group shows with no file: the workspace explorer. */
  home: ReactNode;
  /** Open a file: in group `group`, or the focused one. */
  onOpen: (path: string, group?: number) => void;
  onKeep: (group: number, path: string) => void;
  onClose: (group: number, path: string) => void;
  onNewTab: (group: number) => void;
  onNewBrowser: (group: number) => void;
  onFocus: (group: number) => void;
  /** A new group from a tab: a copy from the menu, a move when dragged. */
  onSplit: (group: number, path: string, direction: SplitDirection, move: boolean) => void;
  onMoveTab: (from: number, to: number, path: string, before: string | null) => void;
}

interface GroupProps {
  ctx: GroupContext;
  state: GroupsState;
  index: number;
  /** This group shows the workspace explorer rather than its selected file. */
  showsHome: boolean;
}

/** Markdown opens in reading view; other text files (JSON config, CSS, manifests) open as raw source. */
export function editorModeFor(ctx: GroupContext, path: string): EditMode {
  return ctx.editorModes[path] || (/\.(md|mdx)$/i.test(path) ? 'reading' : 'split');
}

/**
 * A group's tab strip and the header of its file. Exported for the layout
 * shell, whose editor panel shows the focused group's file under it.
 */
export function EditorGroupHeader({ ctx, state, index, showsHome, inLayout = false }: GroupProps & { inLayout?: boolean }) {
  const group = state.groups[index] as TabState;
  const path = showsHome ? null : group.selected;
  const blocked = useCallback((direction: SplitDirection) => splitBlocked(state, direction), [state]);
  let controls: ReactNode = null;
  if (path && !isUrl(path)) {
    const { Surface, byKind } = ctx.surfaceFor(path);
    const content = ctx.docs[path] ?? '';
    if (Surface && !byKind) {
      controls = (
        <div className="flex shrink-0 items-center">
          <Segmented
            label="Surface mode"
            value={ctx.surfaceSource[path] ? 'source' : 'preview'}
            onChange={(next) => ctx.onSurfaceSource(path, next === 'source')}
            options={[
              { value: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" /> },
              { value: 'source', label: 'Source', icon: <FileCode2 className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>
      );
    } else if (!Surface) {
      controls = (
        <div className="flex shrink-0 items-center gap-3">
          {/\.(md|mdx)$/i.test(path) && <FullWidthToggle doc={content} onChange={(value) => ctx.onChange(path, value)} removeEmpty={ctx.properties.removeEmpty} />}
          {/* In a layout workspace the editor panel owns the view mode and
              renders its switch into this slot, so it shares the note header
              instead of taking a row of its own -- and a second switch here
              would drive nothing. */}
          {inLayout
            ? <div id={EDITOR_MODE_SLOT} className="flex items-center" />
            : <Segmented label="View mode" value={editorModeFor(ctx, path)} onChange={(mode) => ctx.onEditorMode(path, mode)} options={EDIT_MODES} />}
        </div>
      );
    }
  }
  const saveState = path ? ctx.saveStates[path] ?? 'idle' : 'idle';
  return (
    <header className="shrink-0">
      <div className="pane-header editor-tab-header flex items-center">
        <NoteTabs tabs={group.tabs} previewTab={group.preview} activeTab={path ?? ''} focused={state.focused === index} group={index}
          onSelect={(note) => ctx.onOpen(note, index)} onKeep={(note) => ctx.onKeep(index, note)} onClose={(note) => ctx.onClose(index, note)}
          onNewTab={() => ctx.onNewTab(index)} onNewBrowser={() => ctx.onNewBrowser(index)}
          onSplit={(note, direction) => ctx.onSplit(index, note, direction, false)} splitBlocked={blocked}
          onDropTab={(from, note, before) => ctx.onMoveTab(from, index, note, before)} />
      </div>
      {path && <div className="note-header flex h-8 min-w-0 items-center gap-3 px-3">
        <div aria-label="Note path" title={path} className="min-w-0 flex-1 truncate font-sans text-xs text-[var(--ink-muted)]">
          {path.includes('/') && <span>{path.slice(0, path.lastIndexOf('/') + 1)}</span>}
          <span className="text-[var(--ink-secondary)]">{path.split('/').pop()}</span>
        </div>
        {/* Media streams from disk and is never written, so it has no save state. */}
        {!isUrl(path) && !MEDIA_KINDS.includes(fileKind(path)) && <span role="status" className={cn('shrink-0 text-xs text-[var(--ink-muted)]', saveState === 'error' && 'text-[var(--danger)]')}>{SAVE_LABEL[saveState]}</span>}
        {controls}
      </div>}
    </header>
  );
}

/** A group's file, rendered exactly as the single editor always has. */
function GroupBody({ ctx, path }: { ctx: GroupContext; path: string }) {
  const editorRef = useRef<any>(null);
  if (isUrl(path)) return <BrowserView key={path} url={path} />;
  const content = ctx.docs[path];
  // Not read yet: render nothing rather than another file's content or an
  // empty document a surface might take for the real one.
  if (content === undefined) return null;
  const change = (value: string) => ctx.onChange(path, value);
  const toggleTask = (line: number, checked: boolean) => {
    const next = toggleTaskLine(content, line, checked);
    if (next !== null) change(next);
  };
  const mode = editorModeFor(ctx, path);
  const setMode = (next: EditMode) => ctx.onEditorMode(path, next);
  const { colorScheme, properties, notes, tags } = ctx;
  const { Surface, byKind } = ctx.surfaceFor(path);

  if (Surface) {
    // A CSV is read-only as source: the editor would turn CRLF into LF on the
    // first keystroke, and a CSV Neuron does not manage must not change.
    if (!byKind && ctx.surfaceSource[path]) return <Editor ref={editorRef} value={content} onChange={change} readOnly={isCsvPath(path)} colorScheme={colorScheme} />;
    return (
      <SurfaceBoundary resetKey={`${path}:${content.length}`}>
        <Surface path={path} content={content} notesData={ctx.notesData} onSelectNote={(note) => ctx.onOpen(note)} selectedNote={path} onChangeNote={change} colorScheme={colorScheme} fileSize={ctx.fileSize(path)} />
      </SurfaceBoundary>
    );
  }

  const open = (note: string) => ctx.onOpen(note);
  // In reading view a single click does nothing; in Split it puts the source cursor on that line.
  const lineClick = (lineIndex: number) => {
    if (mode === 'reading') return;
    setTimeout(() => {
      const view = editorRef.current?.view;
      if (!view) return;
      try {
        const line = view.state.doc.line(Math.max(1, Math.min(lineIndex + 1, view.state.doc.lines)));
        view.dispatch({ selection: { anchor: line.from, head: line.from }, scrollIntoView: true });
        view.focus();
      } catch (e) {
        console.error('Failed to jump to line:', e);
      }
    }, 50);
  };
  const source = <Editor ref={editorRef} value={content} onChange={change} colorScheme={colorScheme} />;
  const preview = <MDXPreview onToggleTask={toggleTask} mdxContent={content} colorScheme={colorScheme} onLineClick={lineClick} notes={notes} onWikiLinkClick={open} />;

  if (mode === 'live') {
    return <MDXPreview key={path} editable mdxContent={content} onChangeSource={change} onToggleTask={toggleTask} colorScheme={colorScheme} tagSuggestions={tags} onTagClick={ctx.onTagClick} notes={notes} onWikiLinkClick={open} onRequestRawMode={() => setMode('split')} removeEmptyFrontmatter={properties.removeEmpty} defaultPropertiesCollapsed={properties.collapsedByDefault} />;
  }
  if (mode === 'reading') {
    return (
      <div className="h-full" onDoubleClick={() => setMode('live')}>
        <MDXPreview onToggleTask={toggleTask} mdxContent={content} colorScheme={colorScheme} onLineClick={lineClick} tagSuggestions={tags} onTagClick={ctx.onTagClick} notes={notes} onWikiLinkClick={open} showProperties={properties.showInReading} defaultPropertiesCollapsed={properties.collapsedByDefault} />
      </div>
    );
  }
  return ctx.wide ? (
    <div className="flex h-full w-full divide-x divider-color">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Source</div>
        <div className="min-h-0 flex-1">{source}</div>
      </div>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Preview</div>
        <div className="min-h-0 flex-1">{preview}</div>
      </div>
    </div>
  ) : (
    <Tabs defaultValue="source" className="flex h-full w-full flex-col">
      <div className="border-b divider-color px-3 py-2"><TabsList><TabsTrigger value="source">Source</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList></div>
      <TabsContent value="source" className="min-h-0 flex-1">{source}</TabsContent>
      <TabsContent value="preview" className="min-h-0 flex-1">{preview}</TabsContent>
    </Tabs>
  );
}

/** An edge of a group's content to drop a dragged tab on, which splits the editor there. */
function SplitZone({ direction, beside, onDrop }: { direction: SplitDirection; beside: boolean; onDrop: (from: number, path: string) => void }) {
  const [hover, setHover] = useState(false);
  const label = direction === 'row' ? 'Split right' : 'Split down';
  return (
    <div aria-label={label} data-split-zone={direction} data-visible="true" data-hover={hover}
      className={`workbench-drop-zone editor-split-zone editor-split-zone-${direction === 'row' ? 'right' : 'down'}`}
      // The lower zone stops short of the right-hand one when both are offered.
      style={direction === 'column' && beside ? { right: 'calc(50% + 6px)' } : undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(TAB_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setHover(true);
      }}
      onDragLeave={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX <= rect.left || event.clientX >= rect.right || event.clientY <= rect.top || event.clientY >= rect.bottom) setHover(false);
      }}
      onDrop={(event) => {
        const tab = readDraggedTab(event);
        if (!tab) return;
        event.preventDefault();
        event.stopPropagation();
        setHover(false);
        onDrop(tab.group, tab.path);
      }}>
      {label}
    </div>
  );
}

function EditorGroup({ ctx, state, index, showsHome, card, dragging }: GroupProps & { card: boolean; dragging: boolean }) {
  const group = state.groups[index] as TabState;
  const path = showsHome ? null : group.selected;
  const zones = dragging ? (['row', 'column'] as const).filter((direction) => !splitBlocked(state, direction)) : [];
  return (
    <section aria-label={`Editor group ${index + 1}`} data-editor-group={index} data-focused={state.focused === index ? 'true' : undefined}
      className={cn('relative flex h-full w-full min-w-0 flex-col', card && 'shell-card')}
      // Focus is the group last clicked or typed in. Not DOM focus: a closing
      // menu hands that back to the tab it opened from, in the group just left.
      onPointerDownCapture={() => ctx.onFocus(index)} onKeyDownCapture={() => ctx.onFocus(index)}>
      <EditorGroupHeader ctx={ctx} state={state} index={index} showsHome={showsHome} />
      <div className="relative min-h-0 flex-1">
        {path ? <GroupBody ctx={ctx} path={path} /> : ctx.home}
        {zones.map((direction) => (
          <SplitZone key={direction} direction={direction} beside={zones.length === 2}
            onDrop={(from, dropped) => ctx.onSplit(from, dropped, direction, true)} />
        ))}
      </div>
    </section>
  );
}

/**
 * The editor area: one to four groups in a single resizable split. Zen mode
 * shows only the focused group.
 */
export default function EditorGroups({ ctx, state, homeGroup, zen, sizes, onSizes }: {
  ctx: GroupContext;
  state: GroupsState;
  homeGroup: number | null;
  zen: boolean;
  /** Remembered sizes, used when they match the groups. */
  sizes: number[] | null;
  onSizes: (sizes: number[]) => void;
}) {
  // A tab being dragged shows the split zones on every group's content.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener('dragend', stop, true);
    window.addEventListener('drop', stop, true);
    return () => { window.removeEventListener('dragend', stop, true); window.removeEventListener('drop', stop, true); };
  }, [dragging]);
  const onDragStart = (event: React.DragEvent) => {
    // A frame later: changing what is under the pointer as a drag starts can cancel it.
    if (event.dataTransfer.types.includes(TAB_MIME)) requestAnimationFrame(() => setDragging(true));
  };

  const count = state.groups.length;
  const view = (index: number, card: boolean) => (
    <EditorGroup ctx={ctx} state={state} index={index} showsHome={homeGroup === index} card={card} dragging={dragging} />
  );
  if (zen || count === 1) return <div className="h-full w-full" onDragStart={onDragStart}>{view(zen ? state.focused : 0, false)}</div>;
  const fits = sizes && sizes.length === count ? sizes : null;
  const row = state.direction === 'row';
  return (
    <div className="h-full w-full" onDragStart={onDragStart}>
      <PanelGroup key={state.direction} direction={row ? 'horizontal' : 'vertical'} onLayout={onSizes} className="flex h-full min-h-0 min-w-0">
        {state.groups.map((_, index) => (
          <Fragment key={index}>
            {index > 0 && <PanelResizeHandle className={row ? 'resize-handle resize-handle-v' : 'resize-handle resize-handle-h'} />}
            <Panel id={`editor-group-${index}`} order={index} defaultSize={fits ? fits[index] : 100 / count} minSize={10} className="min-h-0 min-w-0">
              {view(index, true)}
            </Panel>
          </Fragment>
        ))}
      </PanelGroup>
    </div>
  );
}
