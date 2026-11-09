import { Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';
import { AlertCircle, ArrowUpRight, Link2, FileWarning } from 'lucide-react';
import { Badge, Callout, parseSemanticType } from './mdx-components';
import { buildWikiIndex, resolveWikiLink } from '../lib/wikilinks';
import { Run } from './RunButton';
import DbView from './DbView';
import { Row, Col, Grid, Cell, Card, Stat, Divider, Flashcard } from './mdx-layout';
import DocumentProperties from './properties/DocumentProperties';
import { applyFrontmatter, isFullWidth, parseFrontmatter } from '../lib/frontmatter';
import { sanitizeHtmlToReact } from '../lib/sanitize-html';
import { safeUrl } from '../lib/view-security';
import MermaidDiagram from './MermaidDiagram';
import { LiveAttr, LiveBlock, LiveCell, LiveText, type BlockDraft, type LiveEditing, type SourceRange } from './LiveEditing';
import { replaceLines, splitLinePrefix } from '../lib/live-edit';

// Links read as one object rather than as underlined text: an icon says where
// it goes before you read the label, and the pill gives it an edge to click.
const LINK_PILL =
  'inline-flex max-w-full items-baseline gap-1 rounded border border-[var(--divider)] bg-[var(--surface)] '
  + 'px-1.5 py-0.5 align-baseline font-[inherit] text-[0.95em] font-medium leading-tight text-[var(--md-link)] '
  + 'no-underline transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] cursor-pointer';

// A link to a note that is not there. Same shape, so a broken link is obviously
// the same kind of thing as a working one, but muted and struck through.
const BROKEN_PILL =
  'inline-flex max-w-full items-baseline gap-1 rounded border border-dashed border-[var(--divider)] '
  + 'bg-transparent px-1.5 py-0.5 align-baseline text-[0.95em] font-medium leading-tight '
  + 'text-[var(--ink-muted)] line-through cursor-default';

interface MDXPreviewProps {
  mdxContent: string;
  editable?: boolean;
  onChangeSource?: (next: string) => void;
  onRequestRawMode?: () => void;
  removeEmptyFrontmatter?: boolean;
  colorScheme?: 'light' | 'dark';
  onLineClick?: (lineIndex: number) => void;
  showProperties?: boolean;
  tagSuggestions?: string[];
  onTagClick?: (tag: string) => void;
  notes?: string[];
  onWikiLinkClick?: (note: string) => void;
  defaultPropertiesCollapsed?: boolean;
  /**
   * Tick or untick the task on this source line. Without it the checkboxes
   * render read-only, which is what reading mode used to do -- a checkbox you
   * cannot click is a picture of a checkbox.
   */
  onToggleTask?: (lineIndex: number, checked: boolean) => void;
}

interface MDXParseError extends Error {
  block?: string;
  remediation?: string;
}

function normalizeError(error: unknown): MDXParseError {
  return error instanceof Error ? error as MDXParseError : new Error(String(error));
}

type TableAlignment = 'left' | 'center' | 'right';

function splitTableRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      cell += character === '|' ? character : '\\' + character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function parseTableDivider(row: string): TableAlignment[] | null {
  if (!row.includes('|')) return null;
  const cells = splitTableRow(row);
  if (!cells.length || cells.some((cell) => !/^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    return 'left';
  });
}

// ==========================================
// 2. MDX RENDERER ENGINE WITH ERROR LEDGER
// ==========================================

export default function MDXPreview({ mdxContent, colorScheme = 'dark', onLineClick, showProperties = true, tagSuggestions = [], onTagClick, notes = [], onWikiLinkClick, onToggleTask, defaultPropertiesCollapsed = false, editable = false, onChangeSource, onRequestRawMode, removeEmptyFrontmatter = true }: MDXPreviewProps) {
  const [blankLine, setBlankLine] = useState<number | null>(null);
  const [active, setActive] = useState<BlockDraft | null>(null);
  const activeRef = useRef(active);
  const sourceRef = useRef(mdxContent);
  sourceRef.current = mdxContent;
  const article = useRef<HTMLElement>(null);
  const pendingFocus = useRef<{ line: number; end: boolean } | null>(null);
  const fm = useMemo(() => parseFrontmatter(mdxContent), [mdxContent]);
  const fmLineOffset = fm.hasFrontmatter ? (mdxContent.slice(0, fm.bodyStart).match(/\n/g)?.length ?? 0) : 0;
  const lineClick = (index: number) => onLineClick?.(index + fmLineOffset);
  const wikiNotes = useMemo(() => buildWikiIndex(notes), [notes]);
  const updateActive = (next: BlockDraft | null) => { activeRef.current = next; setActive(next); };
  const changeSource = (next: string) => {
    if (next === sourceRef.current) return;
    sourceRef.current = next;
    onChangeSource?.(next);
  };
  const changeRange = ({ startLine, endLine }: SourceRange, value: string | string[]) => {
    const current = sourceRef.current;
    const parsed = parseFrontmatter(current);
    const front = current.slice(0, parsed.bodyStart);
    const offset = (front.match(/\n/g)?.length ?? 0) + (front && !front.endsWith('\n') ? 1 : 0);
    const next = replaceLines(current, offset, startLine, endLine, value);
    const delta = next.split('\n').length - current.split('\n').length;
    const draft = activeRef.current;
    if (draft && endLine < draft.startLine) updateActive({ ...draft, startLine: draft.startLine + delta, endLine: draft.endLine + delta });
    changeSource(next);
  };
  // Rewrite one attribute's value inside a block, leaving every other byte of
  // the block -- indentation, other attributes, children -- as it was.
  const blockLines = (start: number, end: number) => parseFrontmatter(sourceRef.current).body.split(/\r?\n/).slice(start, end + 1);
  const rewriteAttr = (start: number, end: number, name: string, from: string, to: string) => {
    const block = blockLines(start, end).join('\n');
    const needle = `${name}="${from}"`;
    if (!block.includes(needle)) return;
    changeRange({ startLine: start, endLine: end }, block.replace(needle, `${name}="${to}"`));
  };
  // Rewrite one cell of one table row. The row is rebuilt from its cells, so a
  // pipe typed into the cell is escaped rather than splitting it in two.
  const rewriteCell = (line: number, column: number, next: string) => {
    const row = blockLines(line, line)[0];
    if (row === undefined) return;
    const cells = splitTableRow(row);
    while (cells.length <= column) cells.push('');
    cells[column] = next;
    const lead = /^\s*\|/.test(row) ? '| ' : '';
    const trail = /\|\s*$/.test(row) ? ' |' : '';
    // splitTableRow unescapes \| in every cell, so every cell is escaped again.
    changeRange({ startLine: line, endLine: line }, lead + cells.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ') + trail);
  };
  const finish = (commit: boolean) => {
    const draft = activeRef.current;
    updateActive(null);
    if (commit && draft && draft.draft !== draft.source) changeRange(draft, draft.draft);
  };
  const editing: LiveEditing = {
    active, colorScheme, finish, change: changeRange,
    draft: (draft) => { if (activeRef.current) updateActive({ ...activeRef.current, draft }); },
    focus: (line, end = false) => { pendingFocus.current = { line, end }; setBlankLine(line); },
    open: (range) => {
      const previous = activeRef.current;
      const before = sourceRef.current;
      finish(true);
      const delta = sourceRef.current.split('\n').length - before.split('\n').length;
      const shift = previous && previous.endLine < range.startLine ? delta : 0;
      const startLine = range.startLine + shift;
      const endLine = range.endLine + shift;
      const source = parseFrontmatter(sourceRef.current).body.split(/\r?\n/).slice(startLine, endLine + 1).join('\n');
      updateActive({ startLine, endLine, source, draft: source });
    },
  };
  useLayoutEffect(() => {
    const requested = pendingFocus.current;
    if (!requested) return;
    const element = article.current?.querySelector<HTMLElement>('[data-live-line="' + requested.line + '"]');
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element); range.collapse(!requested.end);
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
  });

  function block(node: ReactElement, startLine: number, endLine: number, canEdit: boolean, name?: string, trailing?: React.ReactNode) {
    return canEdit ? <LiveBlock key={'block-' + startLine} range={{ startLine, endLine }} editing={editing} name={name} trailing={trailing}>{node}</LiveBlock> : node;
  }

  // Parsing helper to split and evaluate markdown vs custom components
  function parseMDX(content: string, canEdit = editable, base = 0, nested = false): React.ReactNode[] {
    // Nested content -- a callout body, a card -- is padded to the body line it
    // really starts on, so a tick, an edit or a range inside it addresses the
    // right line of the file. Parsed from zero, a task inside a callout ticked
    // whatever line its position pointed at instead, which was not a task.
    const lines = ('\n'.repeat(base) + content).split(/\r?\n/);
    const nodes: React.ReactNode[] = [];
    let i = 0;
    let trailingParagraph = false;

    while (i < lines.length) {
      const line = lines[i];

      // MDX ESM: `import ... from '...'` / `export ...` are module syntax, not
      // prose. Neuron's renderer is a line parser, not a real MDX compiler, so
      // these fell through and rendered as literal text -- a note that declares
      // its components showed the declaration to the reader. Skip the statement,
      // including the multi-line brace form, and skip the blank line after it so
      // the removal does not leave a hole in the document.
      if (/^\s*(import|export)\s/.test(line)) {
        let open = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        i++;
        while (i < lines.length && open > 0) {
          open += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
          i++;
        }
        if (i < lines.length && lines[i].trim() === '') i++;
        continue;
      }

      // Code Block parser (markdown)
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        const startLine = i;
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        const codeText = codeLines.join('\n');
        nodes.push(block(lang.toLowerCase() === 'mermaid' ? (
          <div
            key={`mermaid-${i}`}
            onClick={() => lineClick(startLine)}
            className="work-surface my-5 min-h-32 overflow-auto rounded-md border cursor-pointer hover:border-[var(--accent)] transition-colors duration-150"
          >
            <MermaidDiagram source={codeText} colorScheme={colorScheme} />
          </div>
        ) : (
          <pre
            key={`code-${i}`}
            onClick={() => lineClick(startLine)}
            className="work-surface my-5 cursor-pointer overflow-x-auto rounded-md border p-4 font-mono text-sm text-[var(--md-text)] transition-colors duration-150 hover:border-[var(--ink-muted)]"
          >
            {lang && <div className="mb-2 text-[10px] font-medium text-muted">{lang}</div>}
            <code>{codeText}</code>
          </pre>
        ), startLine, Math.min(i, lines.length - 1), canEdit));
        i++;
        continue;
      }

      // GitHub-flavoured Markdown table. The divider row makes this
      // unambiguous, so ordinary prose containing a pipe is left untouched.
      const tableAlignments = i + 1 < lines.length ? parseTableDivider(lines[i + 1]) : null;
      if (line.includes('|') && tableAlignments) {
        const startLine = i;
        const headers = splitTableRow(line);
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        const columnCount = Math.max(headers.length, tableAlignments.length);
        nodes.push(block(
          <div
            key={`table-${i}`}
            onClick={() => lineClick(startLine)}
            // Hovering a block to jump to its source is not selection, focus or
            // a primary action, so it does not get the accent. It lights the
            // frame one step, the way every other row in the app does.
            className="my-5 cursor-pointer overflow-x-auto rounded-md border border-[var(--divider)] transition-colors duration-150 hover:border-[var(--ink-muted)]"
          >
            <table className="w-full min-w-[32rem] border-collapse font-sans text-sm text-[var(--md-text)]">
              <thead className="bg-[var(--surface)] text-[var(--md-heading)]">
                <tr>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <th
                      key={columnIndex}
                      scope="col"
                      style={{ textAlign: tableAlignments[columnIndex] ?? 'left' }}
                      className="border-b border-[var(--divider)] px-3 py-2 text-xs font-semibold"
                    >
                      {canEdit
                        ? <LiveCell source={headers[columnIndex] ?? ''} onCommit={(next) => rewriteCell(startLine, columnIndex, next)}>{parseInlineFormatting(headers[columnIndex] ?? '')}</LiveCell>
                        : parseInlineFormatting(headers[columnIndex] ?? '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-[var(--divider)] last:border-b-0 hover:bg-[var(--surface-hover)]">
                    {Array.from({ length: columnCount }, (_, columnIndex) => (
                      <td
                        key={columnIndex}
                        style={{ textAlign: tableAlignments[columnIndex] ?? 'left' }}
                        className="px-3 py-2 align-top text-xs leading-5"
                      >
                        {canEdit
                          ? <LiveCell source={row[columnIndex] ?? ''} onCommit={(next) => rewriteCell(startLine + 2 + rowIndex, columnIndex, next)}>{parseInlineFormatting(row[columnIndex] ?? '')}</LiveCell>
                          : parseInlineFormatting(row[columnIndex] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>, startLine, i - 1, canEdit,
        ));
        continue;
      }

      // Check if line contains custom JSX tag blocks
      const isJSXBlock = line.trim().startsWith('<') && (line.trim().endsWith('/>') || line.trim().includes('</') || line.trim().includes('>') || line.trim().startsWith('<Badge') || line.trim().startsWith('<Callout'));

      if (isJSXBlock) {
        const startLine = i;
        // A self-closing component (optionally followed by inline text on the same
        // line): render the component, then any trailing text as a markdown line.
        const selfClose = line.trim().match(/^(<[A-Za-z0-9]+\b[^>]*\/>)\s*(.*)$/);
        if (selfClose) {
          const component = <div
            key={`jsx-${i}`}
            onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) lineClick(startLine); }}
            className="cursor-pointer hover:bg-[rgba(255,255,255,0.01)] rounded transition-colors duration-150"
          >
            {renderJSX(selfClose[1], i, canEdit)}
          </div>;
          nodes.push(block(component, startLine, i, canEdit, line.match(/<([A-Za-z0-9]+)/)?.[1], canEdit && selfClose[2].trim() ? renderMarkdownLine(selfClose[2].trim(), i) : null));
          if (!canEdit && selfClose[2].trim()) nodes.push(renderMarkdownLine(selfClose[2].trim(), i));
          i++;
          continue;
        }

        const fullJSXLines: string[] = [line];
        // If it is an opening tag but not self-closing, fetch lines until closing tag is found
        let isSelfClosing = line.trim().endsWith('/>');
        let tagNameMatch = line.match(/<([A-Za-z0-9]+)/);
        let tagName = tagNameMatch ? tagNameMatch[1] : '';

        if (!isSelfClosing && tagName && !line.includes(`</${tagName}>`)) {
          i++;
          let foundClosing = false;
          // Track depth: stopping at the first `</Tag>` would truncate
          // `<Grid>…<Grid>…</Grid>…</Grid>` at the inner close and leave the
          // outer one stranded as literal text.
          let depth = 1;
          const openRe = new RegExp(`<${tagName}\\b(?![^>]*/>)`, 'g');
          const closeRe = new RegExp(`</${tagName}>`, 'g');
          while (i < lines.length) {
            fullJSXLines.push(lines[i]);
            depth += (lines[i].match(openRe) ?? []).length;
            depth -= (lines[i].match(closeRe) ?? []).length;
            if (depth <= 0) {
              foundClosing = true;
              break;
            }
            i++;
          }
          if (!foundClosing) {
            const malformedBlock = fullJSXLines.join('\n');
            const error = new Error(`Unclosed MDX tag: </${tagName}> is missing.`) as MDXParseError;
            error.block = malformedBlock;
            error.remediation = `Close your tag with </${tagName}>. Make sure you don't have overlapping tags.`;
            if (!canEdit) throw error;
            i = lines.length - 1;
          }
        }

        const jsxString = fullJSXLines.join('\n').trim();
        nodes.push(block(
          <div
            key={`jsx-${startLine}`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              lineClick(startLine);
            }}
            className="cursor-pointer hover:bg-[rgba(255,255,255,0.01)] rounded transition-colors duration-150"
          >
            {renderJSX(jsxString, startLine, canEdit)}
          </div>, startLine, i, canEdit, tagName
        ));
        i++;
        continue;
      }

      // Markdown line renderings
      if (line.trim() !== '' || (canEdit && !nested && (i === lines.length - 1 || blankLine === i))) {
        nodes.push(renderLine(line, i, canEdit));
        trailingParagraph = canEdit && i === lines.length - 1 && line.trim() === '';
      }
      i++;
    }

    if (canEdit && !nested && !trailingParagraph) {
      // A virtual trailing paragraph is written only once the user types in it.
      nodes.push(renderLine('', lines.length, true, lines.length - 1));
    }
    return nodes;
  }

  function renderJSX(source: string, index: number, canEdit: boolean): React.ReactNode {
    try { return evaluateJSX(source, index, canEdit); }
    catch (error) {
      if (!canEdit) throw error;
      return <pre className="whitespace-pre-wrap text-sm" role="alert">{normalizeError(error).message}</pre>;
    }
  }

  function renderLine(source: string, index: number, canEdit: boolean, endLine = index): React.ReactNode {
    const node = renderMarkdownLine(source, index, canEdit);
    if (!canEdit) return node;
    return <LiveText key={index + ':' + source} source={source} range={{ startLine: index, endLine }} editing={editing}>{node}</LiveText>;
  }

  // Evaluates string to map dynamically into custom React elements
  function evaluateJSX(jsxStr: string, index: number, canEdit = false): React.ReactNode {
    try {
      // Text written literally in the tag is edited where it is shown; only that
      // attribute's value is rewritten. Values a component derives or loads
      // (a DbView's rows) are never handed to this.
      const endLine = index + (jsxStr.match(/\n/g)?.length ?? 0);
      const attr = (name: string, value: string | undefined): React.ReactNode =>
        canEdit && value !== undefined
          ? <LiveAttr value={value} onCommit={(next) => rewriteAttr(index, endLine, name, value, next)} />
          : value;
      // Children start on the line after the open tag's `>`, wherever that is.
      const childBase = (open: number) => index + (jsxStr.slice(0, open).match(/\n/g)?.length ?? 0);

      // 1. Match Badge
      if (jsxStr.startsWith('<Badge')) {
        const textMatch = jsxStr.match(/text="([^"]+)"/);
        const typeMatch = jsxStr.match(/type="([^"]+)"/);
        const type = parseSemanticType(typeMatch?.[1]);
        return <Badge key={`badge-${index}`} text={textMatch ? attr('text', textMatch[1]) : 'badge'} type={type} />;
      }

      // 2. Match Callout
      if (jsxStr.startsWith('<Callout')) {
        const typeMatch = jsxStr.match(/type="([^"]+)"/);
        const titleMatch = jsxStr.match(/title="([^"]+)"/);
        const type = parseSemanticType(typeMatch?.[1]);

        // Children go back through parseMDX, exactly like the layout
        // primitives below. Rendered as a raw string a callout could only hold
        // one unformatted paragraph -- a list came out as literal dashes and
        // `code` as literal backticks, which is what a callout is most often
        // used for.
        const open = jsxStr.indexOf('>') + 1;
        const close = jsxStr.lastIndexOf('</Callout>');
        const content = close >= open ? jsxStr.slice(open, close) : '';
        return (
          <Callout key={`callout-${index}`} type={type} title={titleMatch ? attr('title', titleMatch[1]) : undefined}>
            {content.trim() ? parseMDX(content, canEdit, childBase(open), true) : null}
          </Callout>
        );
      }

      // 3. Layout primitives. Children are re-parsed through parseMDX so a Card
      // can hold markdown, another Card, or a DbView -- without that they would
      // arrive as raw text and the components would be decorative boxes.
      //
      // Attribute values are looked up in tables inside mdx-layout, never
      // interpolated into a class string: a note is untrusted content and
      // arbitrary CSS over the app chrome is UI spoofing.
      const layout: Record<string, (props: Record<string, any>, kids: React.ReactNode) => React.ReactNode> = {
        Row: (a, k) => <Row {...a}>{k}</Row>,
        Col: (a, k) => <Col {...a}>{k}</Col>,
        Grid: (a, k) => <Grid {...a}>{k}</Grid>,
        Cell: (a, k) => <Cell {...a}>{k}</Cell>,
        Card: (a, k) => <Card {...a}>{k}</Card>,
        Stat: (a) => <Stat {...a} />,
        Run: (a) => <Run {...a} />,
        Divider: (a) => <Divider {...a} />,
        // Children are the answer, and they arrive already parsed, so a card
        // can answer with a list or a code span rather than one flat sentence.
        Flashcard: (a, k) => <Flashcard {...a}>{k}</Flashcard>,
      };
      const layoutMatch = jsxStr.match(/^<([A-Z][A-Za-z0-9]*)\b/);
      if (layoutMatch && layout[layoutMatch[1]]) {
        const tag = layoutMatch[1];
        const openTag = jsxStr.slice(0, jsxStr.indexOf('>') + 1);
        const attrs: Record<string, string> = {};
        for (const m of openTag.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)) attrs[m[1]] = m[2];

        // Children are everything between the open tag and the LAST matching
        // close, so a nested tag of the same name does not truncate the block.
        const close = `</${tag}>`;
        const end = jsxStr.lastIndexOf(close);
        const open = jsxStr.indexOf('>') + 1;
        const inner = end > -1 ? jsxStr.slice(open, end) : '';
        const kids = inner.trim() ? parseMDX(inner, canEdit, childBase(open), true) : null;
        // The visible text attributes. Run's label is a button that runs a
        // command, so a click there must run it, not start editing.
        const props: Record<string, any> = { ...attrs };
        for (const name of ['title', 'label', 'value']) {
          if (tag !== 'Run' && attrs[name] !== undefined) props[name] = attr(name, attrs[name]);
        }
        if (tag === 'Flashcard' && attrs.front !== undefined) props.frontNode = attr('front', attrs.front);
        return <div key={`${tag}-${index}`}>{layout[tag](props, kids)}</div>;
      }

      // 3. Match DbView — embeds a .db database (table/board/card) by @path.
      if (jsxStr.startsWith('<DbView')) {
        const path = jsxStr.match(/path="([^"]+)"/)?.[1];
        const view = jsxStr.match(/view="([^"]+)"/)?.[1];
        const table = jsxStr.match(/table="([^"]+)"/)?.[1];
        if (!path) {
          const err = new Error('<DbView /> needs a path, e.g. <DbView path="@Planner.db" />.') as MDXParseError;
          err.block = jsxStr;
          err.remediation = 'Add a path attribute pointing at a .db file relative to the workspace root, prefixed with @.';
          throw err;
        }
        return <DbView key={`dbview-${index}`} path={path} view={view} table={table} />;
      }

      // If unrecognized component tag
      const tagName = (jsxStr.match(/<([A-Za-z0-9]+)/) || [])[1] || 'Unknown';
      const standardHtmlTags = [
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'br', 'hr',
        'div', 'span', 'p', 'b', 'i', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote'
      ];
      if (standardHtmlTags.includes(tagName.toLowerCase())) {
        // Note content is untrusted — sanitize instead of injecting raw HTML.
        // (Raw injection here was a stored-XSS path into the privileged renderer.)
        return <div key={`html-${index}`}>{sanitizeHtmlToReact(jsxStr, `html-${index}`)}</div>;
      }

      const err = new Error(`Component "<${tagName} />" is not registered in Neuron.`) as MDXParseError;
      err.block = jsxStr;
      err.remediation = `Register component "${tagName}" in src/renderer/components/MDXPreview.tsx or use supported components: <Badge />, <Callout />, <Run />, and <DbView />.`;
      throw err;

    } catch (caughtError: unknown) {
      const err = normalizeError(caughtError);
      // Inject block if not present
      if (!err.block) err.block = jsxStr;
      throw err;
    }
  }

  // Simple Markdown inline style renderer
  function renderMarkdownLine(text: string, index: number, canEdit = false): ReactElement {
    // 1. Headings
    if (text.startsWith('# ')) {
      return (
        <h1
          data-live-text={canEdit || undefined}
          key={index}
          onClick={() => lineClick(index)}
          // No rule under the heading. Size and weight already separate an h1
          // from the paragraph below it; the border added a second, louder
          // signal saying the same thing, and every document opened with a line
          // across it.
          className="-mx-1 mb-3 mt-7 cursor-pointer rounded px-1 font-sans text-2xl font-semibold text-[var(--md-heading)] transition-colors duration-150 hover:bg-[var(--surface)]"
        >
          {text.slice(2)}
        </h1>
      );
    }
    if (text.startsWith('## ')) {
      return (
        <h2
          data-live-text={canEdit || undefined}
          key={index}
          onClick={() => lineClick(index)}
          className="mt-6 mb-2 font-sans text-xl font-semibold text-[var(--md-heading)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          {text.slice(3)}
        </h2>
      );
    }
    if (text.startsWith('### ')) {
      return (
        <h3
          data-live-text={canEdit || undefined}
          key={index}
          onClick={() => lineClick(index)}
          className="mt-5 mb-2 font-sans text-base font-semibold text-[var(--md-heading)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          {text.slice(4)}
        </h3>
      );
    }

    // 2. Unordered lists
    if (text.startsWith('- ') || text.startsWith('* ')) {
      const item = text.slice(2);
      const task = /^\[( |x|X)?\]\s*(.*)$/.exec(item);
      if (task) {
        const checked = task[1]?.toLowerCase() === 'x';
        return (
          <ul
            key={index}
            onClick={() => lineClick(index)}
            className="my-2 list-none font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
          >
            <li className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={checked}
                readOnly={!onToggleTask}
                onChange={(event) => onToggleTask?.(index + fmLineOffset, event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                aria-label={checked ? 'Completed task' : 'Incomplete task'}
                className="task-checkbox mt-1"
              />
              <span data-live-text={canEdit || undefined} className={checked ? 'text-[var(--ink-muted)] line-through' : undefined}>{parseInlineFormatting(task[2])}</span>
            </li>
          </ul>
        );
      }
      return (
        <ul
          key={index}
          onClick={() => lineClick(index)}
          className="my-2 list-disc space-y-1 pl-6 font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          <li data-live-text={canEdit || undefined}>{parseInlineFormatting(item)}</li>
        </ul>
      );
    }

    // 3. Blockquotes
    if (text.startsWith('> ')) {
      return (
        <blockquote
          data-live-text={canEdit || undefined}
          key={index}
          onClick={() => lineClick(index)}
          className="my-4 rounded-md border border-[var(--md-quote-border)] bg-[var(--surface)] px-4 py-3 font-sans text-sm italic text-[var(--md-quote)] cursor-pointer hover:border-[var(--accent)] transition-colors duration-150"
        >
          {parseInlineFormatting(text.slice(2))}
        </blockquote>
      );
    }

    const standaloneTask = /^\[( |x|X)?\]\s*(.*)$/.exec(text);
    if (standaloneTask) {
      const checked = standaloneTask[1]?.toLowerCase() === 'x';
      return (
        <div
          key={index}
          onClick={() => lineClick(index)}
          className="my-2 flex items-start gap-2 font-sans text-sm leading-6 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
        >
          <input
            type="checkbox"
            checked={checked}
            readOnly={!onToggleTask}
            onChange={(event) => onToggleTask?.(index + fmLineOffset, event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            aria-label={checked ? 'Completed task' : 'Incomplete task'}
            className="task-checkbox mt-1"
          />
          {(standaloneTask[2] || canEdit) && <span data-live-text={canEdit || undefined} className={checked ? 'text-[var(--ink-muted)] line-through' : undefined}>{parseInlineFormatting(standaloneTask[2])}</span>}
        </div>
      );
    }

    // Prefixes that Reading displays literally still stay outside the editing region.
    const literalPrefix = canEdit ? splitLinePrefix(text).prefix : '';
    // Standard paragraph
    return (
      <p
        data-live-text={(canEdit && !literalPrefix) || undefined}
        key={index}
        onClick={() => lineClick(index)}
        className="my-2 font-sans text-sm leading-7 text-[var(--md-text)] cursor-pointer hover:bg-[rgba(255,255,255,0.015)] rounded px-1 -mx-1 transition-colors duration-150"
      >
        {literalPrefix ? <>{literalPrefix}<span data-live-text>{parseInlineFormatting(text.slice(literalPrefix.length))}</span></> : parseInlineFormatting(text)}
      </p>
    );
  }

  // Replaces inline styling: bold, italics, inline code, wikilinks
  function parseInlineFormatting(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    let currentText = text;
    let key = 0;

    // Matches bold, italic, code, and wikilinks [[Note Name]]
    // [[wikilink]] must come before [text](url) or the wikilink's own
    // brackets match the inline-link pattern first.
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|!?\[\[.*?\]\]|!?\[[^\]]*\]\(\s*(?:<[^>]+>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\)|<[bB][rR]\s*\/?>)/g;
    const items = currentText.split(regex);

    for (const item of items) {
      const atomic = editable ? { contentEditable: false, 'data-md': item } : {};
      if (item.startsWith('![')) {
        parts.push(editable ? <span {...atomic} key={key++}>!{parseInlineFormatting(item.slice(1))}</span> : <Fragment key={key++}>!{parseInlineFormatting(item.slice(1))}</Fragment>);
      } else if (item.startsWith('**') && item.endsWith('**')) {
        parts.push(<strong key={key++} className="font-semibold text-[var(--md-bold)]">{item.slice(2, -2)}</strong>);
      } else if (item.startsWith('*') && item.endsWith('*')) {
        parts.push(<em key={key++} className="italic text-[var(--md-text)]">{item.slice(1, -1)}</em>);
      } else if (item.startsWith('`') && item.endsWith('`')) {
        parts.push(<code {...atomic} key={key++} className="rounded border border-[var(--divider)] bg-[var(--md-code-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--md-code)]">{item.slice(1, -1)}</code>);
      } else if (item.startsWith('[[') && item.endsWith(']]')) {
        const linkTarget = item.slice(2, -2);
        const resolved = resolveWikiLink(wikiNotes, linkTarget);
        parts.push(
          resolved ? (
            <button
              {...atomic}
              key={key++}
              type="button"
              aria-label={`Open note ${resolved}`}
              title={`Open ${resolved}`}
              className={LINK_PILL}
              onClick={(event) => {
                event.stopPropagation();
                onWikiLinkClick?.(resolved);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <Link2 className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              {linkTarget}
            </button>
          ) : (
            <span
              {...atomic}
              key={key++}
              title={`No note found for "${linkTarget}"`}
              className={BROKEN_PILL}
            >
              <FileWarning className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              {linkTarget}<span className="sr-only"> (missing note)</span>
            </span>
          )
        );
      } else if (/^\[[^\]]*\]\(\s*(?:<[^>]+>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\)$/.test(item)) {
        // A standard Markdown link. These used to fall through to the plain-text
        // branch and render as literal `[label](url)` -- the syntax on screen
        // rather than the link it describes.
        const split = /^\[([^\]]*)\]\(\s*(<[^>]+>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+(?:"([^"]*)"|'([^']*)'))?\)$/.exec(item)!;
        const href = split[2].replace(/^<|>$/g, '');
        const label = split[1] || href;
        const title = split[3] ?? split[4];
        const external = /^[a-z][a-z0-9+.-]*:/i.test(href);

        if (external) {
          const safeHref = safeUrl(href);
          parts.push(
            // A real anchor: main already routes http(s) navigation to the
            // system browser through its own guard, so this needs no bridge of
            // its own and cannot move the app frame.
            safeHref ? <a
              {...atomic}
              key={key++}
              href={safeHref}
              title={title ?? href}
              className={LINK_PILL}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <ArrowUpRight className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              {label}
            </a> : <span {...atomic} key={key++} title={href}>{label}</span>,
          );
        } else {
          const resolved = resolveWikiLink(wikiNotes, href.replace(/\.(md|mdx)$/i, ''));
          parts.push(
            resolved ? (
              <button
                {...atomic}
                key={key++}
                type="button"
                aria-label={`Open note ${resolved}`}
                title={title ?? `Open ${resolved}`}
                className={LINK_PILL}
                onClick={(event) => { event.stopPropagation(); onWikiLinkClick?.(resolved); }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <Link2 className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                {label}
              </button>
            ) : (
              <span {...atomic} key={key++} title={`No note found for "${href}"`} className={BROKEN_PILL}>
                <FileWarning className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                {label}<span className="sr-only"> (missing note)</span>
              </span>
            ),
          );
        }
      } else if (/<[bB][rR]\s*\/?>/.test(item)) {
        parts.push(<br {...atomic} key={key++} />);
      } else {
        parts.push(item);
      }
    }

    return parts;
  }

  let renderedContent: React.ReactNode[] = [];
  let compilationError: MDXParseError | null = null;
  try { renderedContent = parseMDX(fm.body); }
  catch (error) { compilationError = normalizeError(error); }
  useEffect(() => {
    if (!compilationError) return;
    window.electronAPI?.logError?.({
      phase: 'COMPILATION', error_message: compilationError.message,
      stack_trace: compilationError.stack || 'No stack trace available',
      remediation_step: compilationError.remediation || 'Check syntax format and balance JSX tags.',
    });
  }, [compilationError?.message]);

  return (
    // The flag goes on the scroll container rather than on each block inside
    // it, so the properties panel and the article widen together and a future
    // block cannot forget to opt in.
    <div
      className="canvas-surface h-full w-full overflow-y-auto p-7 font-sans select-text"
      data-live-preview={editable || undefined}
      data-full-width={isFullWidth(fm.data) || undefined}
    >
      {showProperties && (editable || fm.hasFrontmatter) && (
        <div className="preview-prose mx-auto mb-4">
          <DocumentProperties doc={mdxContent} tagSuggestions={tagSuggestions} onTagClick={onTagClick} defaultCollapsed={defaultPropertiesCollapsed}
            onChangeDoc={editable ? (next) => changeSource(applyFrontmatter(sourceRef.current, next)) : undefined}
            onViewRaw={editable ? onRequestRawMode : undefined} removeEmpty={removeEmptyFrontmatter} hideWhenEmpty={!editable} />
        </div>
      )}
      {compilationError ? (
        <div role="alert" className="surface-danger rounded-md border p-5 font-sans">
          <div className="mb-3 flex items-center space-x-2 font-semibold text-danger">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-semibold">MDX compilation error</span>
          </div>
          <p className="mb-2 text-sm font-semibold text-primary">{compilationError.message}</p>
          {compilationError.block && (
            <pre className="canvas-surface my-3 overflow-x-auto rounded-md border p-3 font-mono text-xs text-danger">
              <code>{compilationError.block}</code>
            </pre>
          )}
          <div className="mt-2 text-xs leading-5 text-secondary">
            <span className="font-semibold text-primary">How to fix it:</span> {compilationError.remediation}
          </div>
        </div>
      ) : (
        <article ref={article} className="preview-prose mx-auto space-y-3 text-[var(--md-text)]">
          {renderedContent.length > 0 ? renderedContent : (
            <div className="py-16 text-center font-mono text-sm text-muted">Nothing to preview yet.</div>
          )}
        </article>
      )}
    </div>
  );
}
