import React, { forwardRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  colorScheme?: 'dark' | 'light';
}

const Editor = forwardRef<ReactCodeMirrorRef, EditorProps>(function Editor(
  { value, onChange, readOnly = false, colorScheme = 'dark' },
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
    <div className="canvas-surface flex h-full w-full flex-col font-mono text-sm">
      <CodeMirror
        ref={ref}
        aria-label="Note source"
        value={value}
        height="100%"
        theme={colorScheme}
        extensions={[
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
          }),
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
          syntaxHighlighting: true,
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
