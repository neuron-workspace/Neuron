import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { CALLOUT_LABELS, calloutKind, type CalloutKind } from '../lib/callout-kind';

export type SemanticType = CalloutKind;

export const parseSemanticType = calloutKind;

interface BadgeProps {
  type?: SemanticType;
  text: React.ReactNode;
}

export function Badge({ type = 'info', text }: BadgeProps) {
  const styles = {
    success: 'surface-success text-accent',
    warning: 'surface-warning text-warning',
    error: 'surface-danger text-danger',
    info: 'surface-info text-info',
  };
  return <span className={`inline-block rounded font-mono text-xs px-2 py-0.5 border ${styles[type]}`}>{text}</span>;
}

interface CalloutProps {
  type?: SemanticType;
  title?: React.ReactNode;
  children: React.ReactNode;
}

const CALLOUT_ICONS: Record<CalloutKind, LucideIcon> = {
  success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleX,
};

/** Takes its colour from the enclosing `.callout[data-callout-kind]`. */
export function CalloutIcon({ kind, className }: { kind: CalloutKind; className?: string }) {
  const Icon = CALLOUT_ICONS[kind];
  return <Icon aria-hidden="true" strokeWidth={1.75} className={className ? 'callout-icon ' + className : 'callout-icon'} />;
}

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const kind = calloutKind(type);
  return (
    <div
      role="note"
      // A title already names the box; without one the kind is otherwise only a colour.
      aria-label={title ? undefined : CALLOUT_LABELS[kind]}
      data-callout-kind={kind}
      className="callout my-4 flex items-start gap-2.5 px-3.5 py-3 font-sans"
    >
      {/* Centred on the first line: the 20px title, or else the body's 28px line. */}
      <CalloutIcon kind={kind} className={title ? 'mt-0.5' : 'mt-1.5'} />
      <div className="callout-body min-w-0 flex-1">
        {title && <div className="callout-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ---- GitHub-flavoured Markdown tables --------------------------------------

export type TableAlign = 'left' | 'center' | 'right';

export interface ParsedTable {
  headers: string[];
  aligns: TableAlign[];
  rows: string[][];
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((cell) => cell.trim());
}

export function isTableDivider(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, '')));
}

/** Parse a contiguous block of lines as a GFM table, or return null. */
export function parseMarkdownTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2 || !lines[0].includes('|') || !isTableDivider(lines[1])) return null;
  const headers = splitTableRow(lines[0]);
  const aligns: TableAlign[] = splitTableRow(lines[1]).map((cell) => {
    const t = cell.replace(/\s/g, '');
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : 'left';
  });
  const rows = lines.slice(2).filter((l) => l.includes('|')).map(splitTableRow);
  return { headers, aligns, rows };
}

export function MarkdownTable({ headers, aligns, rows }: ParsedTable) {
  const columns = Math.max(headers.length, aligns.length);
  const align = (i: number): TableAlign => aligns[i] ?? 'left';
  return (
    <div className="my-4 overflow-x-auto rounded-md border border-[var(--divider)] font-sans">
      <table className="w-full min-w-[24rem] border-collapse text-sm">
        <thead className="bg-[var(--surface)]">
          <tr>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i} scope="col" style={{ textAlign: align(i) }} className="border-b border-[var(--divider)] px-3 py-2 text-xs font-semibold text-[var(--md-heading)]">
                {headers[i] ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[var(--divider)] last:border-b-0">
              {Array.from({ length: columns }, (_, ci) => (
                <td key={ci} style={{ textAlign: align(ci) }} className="px-3 py-2 align-top text-xs leading-5 text-[var(--md-text)]">
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
