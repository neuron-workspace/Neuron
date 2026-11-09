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
