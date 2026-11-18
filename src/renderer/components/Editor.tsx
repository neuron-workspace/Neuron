import React, { forwardRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Source colours come from the app theme. The stock CodeMirror themes paint
// Markdown in their own reds and greens, which fight every preset.
const sourceHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--md-heading)', fontWeight: '600' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.quote], color: 'var(--ink-muted)' },
  { tag: t.strong, color: 'var(--md-bold)', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--md-link)' },
  { tag: t.monospace, color: 'var(--md-code)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.tagName], color: 'var(--accent-strong)' },
  { tag: [t.string, t.attributeValue, t.regexp], color: 'var(--ink)' },
  { tag: [t.number, t.bool, t.atom, t.null], color: 'var(--accent)' },
  { tag: [t.propertyName, t.attributeName, t.typeName, t.className], color: 'var(--ink-secondary)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--ink-muted)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.angleBracket], color: 'var(--ink-muted)' },
  { tag: t.invalid, color: 'var(--danger)' },
]));
// Built once each: a new extension object per render would reconfigure the editor on every keystroke.
const sourceThemes = {
  dark: EditorView.theme({ '&': { color: 'var(--md-text)' } }, { dark: true }),
  light: EditorView.theme({ '&': { color: 'var(--md-text)' } }, { dark: false }),
};

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  autoHeight?: boolean;
  autoFocus?: boolean;
  colorScheme?: 'dark' | 'light';
  /** The language to highlight instead of Markdown; null for plain text. */
  language?: LanguageSupport | null;
}

const Editor = forwardRef<ReactCodeMirrorRef, EditorProps>(function Editor(
  { value, onChange, readOnly = false, autoHeight = false, autoFocus = false, colorScheme = 'dark', language },
  ref
) {
  React.useEffect(() => {
    const handleResize = () => {
      if (ref && typeof ref === 'object' && 'current' in ref && ref.current?.view) {
        try {
          ref.current.view.requestMeasure();
        } catch (e) {
          // view might be destroyed or not ready
        }
      }
    };
    window.addEventListener('resize', handleResize);
    let cleanup: (() => void) | undefined;
    if (window.electronAPI?.windowControls?.onChromeStateChanged) {
      cleanup = window.electronAPI.windowControls.onChromeStateChanged(() => {
        setTimeout(handleResize, 120); // wait for CSS grid transitions to settle
      });
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      if (cleanup) cleanup();
    };
  }, [ref]);

  return (
    <div className={`canvas-surface flex w-full flex-col font-mono text-sm ${autoHeight ? '' : 'h-full'}`}>
      <CodeMirror
        ref={ref}
        autoFocus={autoFocus}
        aria-label="Note source"
        value={value}
        height={autoHeight ? 'auto' : '100%'}
        theme={sourceThemes[colorScheme]}
        extensions={[
          sourceHighlight,
          ...(language === undefined ? [markdown({
            base: markdownLanguage,
            codeLanguages: languages,
          })] : language ? [language] : []),
          // Markdown paragraphs are one long line each. Without wrapping, the
          // split view cut every sentence off at the pane edge and asked the
          // writer to scroll sideways through their own prose.
          EditorView.lineWrapping,
        ]}
        onChange={(val) => onChange(val)}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          history: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: false,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
        className="flex-1 overflow-hidden select-text"
      />
    </div>
  );
});

export default Editor;
