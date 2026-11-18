import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MAX_CARDS, type BoardColumn, type DbOption, type DbProperty, type DbRow, type DbTable, type ResolvedView } from '@/lib/db';

// Presentational pieces shared by the database editor (DbSurface) and the
// read-only embed (DbView), so a card looks the same in both places.

export const CHIP_CLASS = 'max-w-full break-words rounded px-1.5 py-0.5 text-xs font-medium';

export function Chip({ option }: { option: DbOption }) {
  return (
    <span className={CHIP_CLASS} style={{ background: `${option.color}2e`, color: option.color }}>
      {option.name || '…'}
    </span>
  );
}

export function formatDate(value: string): string {
  // A bare YYYY-MM-DD is a calendar day; new Date(value) would read it as UTC
  // midnight and show the previous day west of Greenwich.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function hostOf(value: string): string {
  try { return new URL(value).hostname || value; } catch { return value; }
}

/** Compact card rendering of one value, or null when there is nothing to show. */
function cardValue(prop: DbProperty, value: unknown): ReactNode {
  if (value === undefined || value === null || value === '') return null;
  if (prop.type === 'select') {
    const option = prop.options?.find((o) => o.id === value);
    return option ? <Chip option={option} /> : null;
  }
  if (prop.type === 'multiselect') {
    const ids = Array.isArray(value) ? value : [];
    const chips = (prop.options ?? []).filter((o) => ids.includes(o.id));
    return chips.length ? chips.map((o) => <Chip key={o.id} option={o} />) : null;
  }
  if (prop.type === 'checkbox') return value === true ? <><Check className="h-3 w-3 shrink-0" />{prop.name}</> : null;
  if (prop.type === 'date' && typeof value === 'string') return formatDate(value);
  if (prop.type === 'url' && typeof value === 'string') return <span className="min-w-0 truncate">{hostOf(value)}</span>;
  return <span className="min-w-0 truncate">{String(value)}</span>;
}

export function cardTitle(view: ResolvedView, row: DbRow): string {
  return view.titleProp ? String(row.values[view.titleProp] ?? '').trim() : '';
}

export function columnLabel(column: BoardColumn, groupName: string): string {
  return column.option ? column.option.name || '…' : `No ${groupName}`;
}

interface DbCardProps extends HTMLAttributes<HTMLDivElement> {
  table: DbTable;
  row: DbRow;
  view: ResolvedView;
  variant: 'board' | 'gallery';
  /** Editor cards are buttons that open the row; embed cards are plain. */
  interactive?: boolean;
}

export const DbCard = forwardRef<HTMLDivElement, DbCardProps>(function DbCard({ table, row, view, variant, interactive, className, ...rest }, ref) {
  const descriptionId = useId();
  const { properties } = table.schema;
  const title = cardTitle(view, row);
  const preview = view.previewProp ? row.values[view.previewProp] : undefined;
  const previewText = typeof preview === 'string' ? preview.trim() : '';
  const items = view.cardProps
    .map((pid) => ({ pid, node: cardValue(properties[pid], row.values[pid]) }))
    .filter((item) => item.node !== null);
  return (
    <div
      ref={ref}
      data-card-id={row.id}
      {...(interactive ? { role: 'button', tabIndex: 0, 'aria-label': title || 'Untitled', 'aria-describedby': descriptionId } : {})}
      className={cn(
        'rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-2.5 text-left',
        // Offset 0 keeps the focus ring inside a board column's scroll padding.
        interactive && 'interactive cursor-pointer hover:bg-[var(--surface-hover)] focus-visible:outline-offset-0',
        className,
      )}
      {...rest}
    >
      <div className={cn('line-clamp-2 break-words text-[13px] font-semibold leading-[18px]', title ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]')}>
        {title || 'Untitled'}
      </div>
      <div id={descriptionId}>
        {/* A div, not a <p>: the editor's `.vw-content p` prose rule would resize it. */}
        {previewText && (
          <div className={cn('mt-1 whitespace-pre-line break-words text-[12px] leading-[18px] text-[var(--ink-secondary)]', variant === 'board' ? 'line-clamp-3' : 'line-clamp-5')}>
            {previewText}
          </div>
        )}
        {items.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {items.map(({ pid, node }) => (
              <div key={pid} title={properties[pid].name} className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] leading-[18px] text-[var(--ink-secondary)]">{node}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export function BoardColumnHeader({ column, groupName, count, children }: { column: BoardColumn; groupName: string; count: number; children?: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 px-1">
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 shrink-0 rounded-full', !column.option && 'border border-[var(--ink-muted)]')}
        style={column.option ? { background: column.option.color } : undefined}
      />
      <span className="min-w-0 truncate text-[13px] font-medium text-[var(--ink)]">{columnLabel(column, groupName)}</span>
      <span className="text-xs text-[var(--ink-muted)]">{count}</span>
      {children && <span className="ml-auto flex items-center">{children}</span>}
    </div>
  );
}

export function CardLimitNote({ total }: { total: number }) {
  if (total <= MAX_CARDS) return null;
  return <div className="text-[12px] text-[var(--ink-muted)]">Showing {MAX_CARDS} of {total}. Filter or use the table to see the rest.</div>;
}
