import { createContext, forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { folderOf, linkName, wikiLinkText, type WikiIndex } from '../lib/wikilinks';

/**
 * What `[[` autocomplete needs in a note's source editor: the link index and
 * the note being typed in, which decides the shortest link that reaches each
 * file from here. Provided around a note's editors; absent elsewhere (a JSON
 * file's editor offers no note links).
 */
export interface WikiCompletion { index: WikiIndex; from: string | null }
export const WikiCompletionContext = createContext<WikiCompletion | null>(null);

/** A note `[[` can link to: its name, the folder it is in, and its path. */
export interface WikiOption { path: string; label: string; detail: string }

/** Every note the link can point at from here, for the source editors and Live alike. */
export function wikiOptions(value: WikiCompletion): WikiOption[] {
  return value.index.files
    .filter((path) => /\.mdx?$/i.test(path) && !path.startsWith('.neuron/') && path !== value.from)
    .map((path) => ({ path, label: linkName(path), detail: folderOf(path) || '/' }));
}

/** What a chosen option writes between the brackets: the shortest link that reaches it from here. */
export function wikiInsertText(value: WikiCompletion, path: string): string {
  return wikiLinkText(value.index, path, value.from);
}

// The slice of @codemirror/autocomplete's types used here. That package comes
// with the editor's basic setup; the source reaches it through language data,
// so nothing imports it directly.
interface CompletionContext { pos: number; explicit: boolean; matchBefore(expr: RegExp): { from: number; to: number; text: string } | null }
interface Completion { label: string; detail?: string; type?: string; apply: (view: EditorView, completion: Completion, from: number, to: number) => void }

/** The completion source, reading the current context from `get` each time it runs. */
export function wikiCompletionSource(get: () => WikiCompletion | null) {
  return (context: CompletionContext) => {
    const value = get();
    if (!value) return null;
    const match = context.matchBefore(/\[\[[^\]\n|#]*$/);
    if (!match) return null;
    const options: Completion[] = wikiOptions(value).map(({ path, label, detail }) => ({
      label,
      detail,
      type: 'text',
      apply: (view, _completion, from, to) => {
        const text = wikiInsertText(value, path);
        // Closing brackets may already be there (typed, or added by the editor).
        const closed = view.state.sliceDoc(to, to + 2) === ']]';
        view.dispatch({ changes: { from, to, insert: text + (closed ? '' : ']]') }, selection: { anchor: from + text.length + 2 } });
      },
    }));
    return { from: match.from + 2, options, validFor: /^[^\]\n|#]*$/ };
  };
}

/** Options for what was typed after `[[`: names that start with it first, then names containing it. */
export function rankWikiOptions(options: readonly WikiOption[], query: string, limit = 8): WikiOption[] {
  const q = query.trim().toLowerCase();
  return options
    .map((option) => ({ option, name: option.label.toLowerCase() }))
    .filter(({ option, name }) => !q || name.includes(q) || option.path.toLowerCase().includes(q))
    .sort((a, b) => (Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)))
      || a.name.localeCompare(b.name) || a.option.path.localeCompare(b.option.path))
    .slice(0, limit)
    .map(({ option }) => option);
}

/** The Live editor's side of it: called from the preview's input and key handlers. */
export interface LiveWikiCompletionHandle {
  /** Look at the text before the caret; open, update or close the list. */
  update(): void;
  /** A key while the list is open: true when the list used it. */
  keyDown(event: { key: string; preventDefault(): void; stopPropagation(): void }): boolean;
  close(): void;
}

/**
 * `[[` autocomplete for Live editing, where text is typed in place rather than
 * in a source editor. The same options and the same inserted text as the
 * source editors; the list sits under the caret.
 */
export const LiveWikiCompletion = forwardRef<LiveWikiCompletionHandle, { value: WikiCompletion | null }>(function LiveWikiCompletion({ value }, ref) {
  const [open, setOpen] = useState<{ query: string; left: number; top: number; selected: number } | null>(null);
  const spot = useRef<{ node: Text; start: number; end: number } | null>(null);
  const all = useMemo(() => (value ? wikiOptions(value) : []), [value]);
  const options = useMemo(() => (open ? rankWikiOptions(all, open.query) : []), [all, open?.query]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const openRef = useRef(open);
  openRef.current = open;

  const close = () => { spot.current = null; setOpen(null); };
  const accept = (option: WikiOption | undefined) => {
    const at = spot.current;
    close();
    if (!option || !at || !value || !at.node.isConnected) return;
    const closed = at.node.data.slice(at.end, at.end + 2) === ']]';
    const range = document.createRange();
    range.setStart(at.node, at.start);
    range.setEnd(at.node, at.end + (closed ? 2 : 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // As typing would: the browser's undo has it, and the line's own handlers see an input.
    document.execCommand('insertText', false, `[[${wikiInsertText(value, option.path)}]]`);
  };

  useImperativeHandle(ref, () => ({
    update() {
      const selection = window.getSelection();
      const node = selection?.focusNode;
      // A block's source editor (CodeMirror) has its own `[[` list.
      const host = node?.parentElement;
      if (!value || !selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !host?.closest('[contenteditable="true"]') || host.closest('.cm-editor')) { close(); return; }
      const text = node as Text;
      const match = /\[\[([^\]\n|#]*)$/.exec(text.data.slice(0, selection.focusOffset));
      if (!match) { close(); return; }
      spot.current = { node: text, start: match.index, end: selection.focusOffset };
      const range = document.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, selection.focusOffset);
      const rect = range.getBoundingClientRect();
      setOpen((previous) => ({ query: match[1], left: rect.left, top: rect.bottom + 4, selected: previous && previous.query === match[1] ? previous.selected : 0 }));
    },
    keyDown(event) {
      const current = openRef.current;
      const list = optionsRef.current;
      if (!current || !list.length) return false;
      const move = (by: number) => setOpen({ ...current, selected: (current.selected + by + list.length) % list.length });
      if (event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowUp') move(-1);
      else if (event.key === 'Enter' || event.key === 'Tab') accept(list[current.selected]);
      else if (event.key === 'Escape') close();
      else return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    close,
  }));

  if (!open || !options.length) return null;
  return createPortal(
    <div role="listbox" aria-label="Link to a note" data-live-wiki-completion
      className="fixed z-50 max-h-64 min-w-[12rem] max-w-[24rem] overflow-y-auto rounded-md border border-[var(--divider)] bg-[var(--surface)] p-1 text-xs text-[var(--ink)] shadow-lg"
      style={{ left: open.left, top: open.top }}
      // Keep the caret where it is: a press here must not blur the line.
      onMouseDown={(event) => event.preventDefault()}>
      {options.map((option, index) => (
        <div key={option.path} role="option" aria-selected={index === open.selected}
          className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 aria-selected:bg-[var(--surface-hover)]"
          onMouseEnter={() => setOpen({ ...open, selected: index })}
          onClick={() => accept(option)}>
          <span className="truncate">{option.label}</span>
          <span className="ml-auto shrink-0 text-[10px] text-[var(--ink-muted)]">{option.detail}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
});
