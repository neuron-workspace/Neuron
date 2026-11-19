import * as React from 'react';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import Editor from '../components/Editor';
import { extensionOf } from '../../main/file-kinds';
import { registerKindSurface, type SurfaceProps } from './index';

/** Matches main's TEXT_READ_LIMIT: past it main sends only this much, so the file must not be saved. */
const EDIT_LIMIT = 5 * 1024 * 1024;

/**
 * A UTF-8 text file (JSON, YAML, source code, logs...) in the source editor,
 * highlighted by its name and saved like a note. It is not a note: it is not
 * read for links, tags, the graph or search.
 */
function TextSurface({ path, content, onChangeNote, colorScheme = 'dark', fileSize }: SurfaceProps) {
  const [language, setLanguage] = React.useState<LanguageSupport | null>(null);
  React.useEffect(() => {
    let alive = true;
    setLanguage(null);
    const description = LanguageDescription.matchFilename(languages, path.slice(path.lastIndexOf('/') + 1));
    void description?.load().then((support) => { if (alive) setLanguage(support); }).catch(() => undefined);
    return () => { alive = false; };
  }, [path]);

  // The caller waits for loaded content; measure it once per path, not on each edit.
  const loadedTooLarge = React.useMemo(() => new TextEncoder().encode(content).length >= EDIT_LIMIT, [path]);
  const tooLarge = loadedTooLarge || (fileSize !== undefined && fileSize > EDIT_LIMIT);
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (extensionOf(path) !== 'json' || content.length > 1024 * 1024 || !content.trim()) {
      setJsonError(null);
      return;
    }
    const timer = setTimeout(() => {
      try { JSON.parse(content); setJsonError(null); } catch (error) { setJsonError(error instanceof Error ? error.message : String(error)); }
    }, 300);
    return () => clearTimeout(timer);
  }, [path, content]);

  return (
    <div data-text-surface className="flex h-full w-full flex-col">
      {tooLarge && <p role="status" className="border-b divider-color px-4 py-1.5 text-xs text-[var(--ink-muted)]">This file is larger than 5 MB, so it opens read-only and shows only its first 5 MB.</p>}
      {jsonError && <p role="status" data-json-error className="border-b divider-color px-4 py-1.5 text-xs text-[var(--warning)]">This JSON does not parse: {jsonError}</p>}
      <div className="min-h-0 flex-1">
        <Editor value={content} onChange={(value) => onChangeNote?.(value)} readOnly={tooLarge} language={language} colorScheme={colorScheme} />
      </div>
    </div>
  );
}

registerKindSurface('text', TextSurface);

export default TextSurface;
