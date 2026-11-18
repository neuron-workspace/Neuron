import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { Pencil } from 'lucide-react';
import Editor from './Editor';
import { canRoundTrip, nextLinePrefix, serializeInline, splitLinePrefix } from '../lib/live-edit';

export interface SourceRange { startLine: number; endLine: number }
export interface BlockDraft extends SourceRange { source: string; draft: string }
export interface LiveEditing {
  active: BlockDraft | null;
  colorScheme: 'light' | 'dark';
  open: (range: SourceRange) => void;
  draft: (value: string) => void;
  finish: (commit: boolean) => void;
  change: (range: SourceRange, value: string | string[]) => void;
  focus: (line: number, end?: boolean) => void;
}

export function LiveBlock({ children, range, editing, name = 'block', trailing }: {
  children: ReactElement; range: SourceRange; editing: LiveEditing; name?: string; trailing?: ReactNode;
}) {
  const editor = useRef<ReactCodeMirrorRef>(null);
  const button = useRef<HTMLButtonElement>(null);
  const active = editing.active?.startLine === range.startLine ? editing.active : null;
  const wasActive = useRef(false);
  useLayoutEffect(() => {
    if (active) editor.current?.view?.focus();
    else if (wasActive.current && !editing.active) button.current?.focus();
    wasActive.current = !!active;
  }, [!!active]);

  if (active) return (
    <div className="live-block-editor rounded border border-[var(--divider)]" data-source-start={range.startLine} data-source-end={range.endLine}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault(); event.stopPropagation(); editing.finish(event.key !== 'Escape');
        }
      }}>
      <Editor ref={editor} value={active.draft} onChange={editing.draft} colorScheme={editing.colorScheme} autoHeight autoFocus />
      <div className="flex gap-2 border-t border-[var(--divider)] p-2 text-xs">
        <button type="button" className="live-edit-action" onClick={() => editing.finish(true)}>Done</button>
        <button type="button" className="live-edit-action" onClick={() => editing.finish(false)}>Cancel</button>
      </div>
    </div>
  );

  // Add chrome to the existing block element: no wrapper changes its margins.
  return <>{cloneElement(children, {
    className: [children.props.className, 'live-block'].filter(Boolean).join(' '),
    'data-source-start': range.startLine,
    'data-source-end': range.endLine,
  }, children.props.children,
  <button key="edit" ref={button} type="button" className="live-edit-button live-edit-action" aria-label={'Edit ' + name}
    onClick={(event) => { event.stopPropagation(); editing.open(range); }}>
    <Pencil className="h-3 w-3" aria-hidden />Edit
  </button>)}{trailing}</>;
}

/**
 * A literal attribute value -- a callout title, a badge's text, a flashcard's
 * question -- edited where it is shown. Only the value is rewritten in the tag;
 * a double quote would end the attribute, so it becomes a curly one.
 */
export function LiveAttr({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  return (
    <span
      ref={ref}
      className="live-text"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      aria-label="Edit text"
      onFocus={() => { done.current = false; }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); ref.current?.blur(); }
        else if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          done.current = true;
          if (ref.current) ref.current.textContent = value;
          ref.current?.blur();
        }
      }}
      onBlur={() => {
        if (done.current) return;
        const next = (ref.current?.textContent ?? '').replace(/\s+/g, ' ').replace(/"/g, '”').trim();
        if (next && next !== value) onCommit(next);
        else if (ref.current) ref.current.textContent = value;
      }}
    >{value}</span>
  );
}

/**
 * A table cell edited in place. Its markup round-trips through the same
 * serializer as a paragraph; a cell that would not convert back exactly stays
 * read-only and is edited through the table's Edit button instead.
 */
export function LiveCell({ children, source, onCommit }: { children: ReactNode; source: string; onCommit: (next: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const original = useRef('');
  const skip = useRef(false);
  const [editable, setEditable] = useState(false);
  useLayoutEffect(() => { if (ref.current) setEditable(canRoundTrip(ref.current, source)); }, [source]);
  return (
    <span
      ref={ref}
      className={editable ? 'live-text block' : 'block'}
      contentEditable={editable || undefined}
      suppressContentEditableWarning
      aria-label={editable ? 'Edit cell' : undefined}
      onFocus={() => { skip.current = false; original.current = ref.current?.innerHTML ?? ''; }}
      onClick={(event) => { if (editable) event.stopPropagation(); }}
      onPaste={(event) => {
        if (!editable) return;
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain').replace(/\s*\r?\n\s*/g, ' '));
      }}
      onKeyDown={(event) => {
        if (!editable || event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); ref.current?.blur(); }
        else if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          skip.current = true;
          if (ref.current) ref.current.innerHTML = original.current;
          ref.current?.blur();
        }
      }}
      onBlur={() => {
        if (!editable || skip.current) return;
        const next = ref.current ? serializeInline(ref.current) : null;
        if (next !== null && next !== source) onCommit(next.replace(/\r?\n/g, ' '));
      }}
    >{children}</span>
  );
}

export function LiveText({ children, source, range, editing }: {
  children: ReactElement; source: string; range: SourceRange; editing: LiveEditing;
}) {
  const root = useRef<HTMLElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const original = useRef('');
  const skipBlur = useRef(false);
  const [fallback, setFallback] = useState(false);
  const { prefix, text } = splitLinePrefix(source);

  useLayoutEffect(() => {
    const element = root.current?.matches('[data-live-text]') ? root.current : root.current?.querySelector<HTMLElement>('[data-live-text]');
    target.current = element ?? null;
    if (!element) return;
    if (!canRoundTrip(element, text)) { setFallback(true); return; }
    element.contentEditable = 'true';
    element.dataset.liveLine = String(range.startLine);
    element.classList.add('live-text');
    element.setAttribute('aria-label', 'Edit text');
    element.dataset.placeholder = 'Start writing…';
  }, [source, range.startLine]);

  if (fallback) return <LiveBlock range={range} editing={editing}>{children}</LiveBlock>;

  const restore = () => { if (target.current) target.current.innerHTML = original.current; };
  const value = () => target.current ? serializeInline(target.current) : null;
  const commit = () => {
    const next = value();
    if (next !== null && next !== text) editing.change(range, prefix + next);
  };

  return cloneElement(children, {
    ref: root,
    // Replace browser-mutated children as a unit after a committed source edit.
    key: source,
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      if (event.target !== target.current) return;
      skipBlur.current = false;
      original.current = target.current.innerHTML;
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!target.current?.contains(event.target) || target.current.contains(event.relatedTarget as Node | null)) return;
      if (!skipBlur.current) commit();
      skipBlur.current = false;
    },
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('[data-md]')) commit();
    },
    onBeforeInput: (event: React.FormEvent<HTMLElement>) => {
      if ((event.nativeEvent as InputEvent).inputType?.startsWith('format')) event.preventDefault();
    },
    onPaste: (event: React.ClipboardEvent<HTMLElement>) => {
      if (event.target !== target.current) return;
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const caret = selection.getRangeAt(0);
      if (!target.current?.contains(caret.commonAncestorContainer)) return;
      caret.deleteContents();
      const textNode = document.createTextNode(event.clipboardData.getData('text/plain').replace(/\r\n/g, '\n'));
      caret.insertNode(textNode); caret.setStartAfter(textNode); caret.collapse(true);
      selection.removeAllRanges(); selection.addRange(caret);
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => event.preventDefault(),
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      const element = target.current;
      if (!element || event.target !== element || event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        skipBlur.current = true; restore(); element.blur();
      } else if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        const next = value();
        if (next === null) return;
        const selection = window.getSelection();
        const tail = document.createRange();
        tail.selectNodeContents(element);
        if (selection?.isCollapsed && selection.rangeCount && element.contains(selection.focusNode)) {
          tail.setStart(selection.focusNode!, selection.focusOffset);
        }
        const remaining = tail.cloneContents();
        const atEnd = selection?.isCollapsed && !remaining.textContent && !remaining.querySelector('[data-md]');
        skipBlur.current = true;
        if (atEnd) {
          editing.focus(range.startLine + next.split('\n').length);
          editing.change(range, prefix + next + '\n' + nextLinePrefix(prefix));
        } else commit();
        element.blur();
      } else if (event.key === 'Backspace' && value() === '') {
        event.preventDefault(); event.stopPropagation();
        const previous = Array.from(element.closest('article')?.querySelectorAll<HTMLElement>('[data-live-line]') ?? [])
          .filter((line) => Number(line.dataset.liveLine) < range.startLine).at(-1);
        if (!previous) return;
        skipBlur.current = true;
        editing.focus(Number(previous.dataset.liveLine), true);
        editing.change(range, []);
      }
    },
  });
}
