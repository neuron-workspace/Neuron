import { useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Layout primitives for MDX notes.
 *
 * Every value is looked up in a table rather than passed through to a class
 * string. A note is untrusted content — it arrives by sync, by template, by
 * paste — so letting `class="..."` reach the DOM would hand any note author
 * arbitrary CSS over the app chrome, which is UI spoofing with extra steps.
 * An unknown value falls back to the default instead of appearing in markup.
 */

const GAP = {
  none: 'gap-0', xs: 'gap-1', sm: 'gap-2', md: 'gap-4', lg: 'gap-6', xl: 'gap-8',
} as const;

const PAD = {
  none: 'p-0', xs: 'p-1', sm: 'p-2', md: 'p-4', lg: 'p-6', xl: 'p-8',
} as const;

const ALIGN = {
  start: 'items-start', center: 'items-center', end: 'items-end',
  stretch: 'items-stretch', baseline: 'items-baseline',
} as const;

const JUSTIFY = {
  start: 'justify-start', center: 'justify-center', end: 'justify-end',
  between: 'justify-between', around: 'justify-around', evenly: 'justify-evenly',
} as const;

// Fixed strings, not `grid-cols-${n}`: Tailwind compiles the classes it can see
// in source, so an interpolated name is simply absent from the stylesheet.
const COLS = {
  '1': 'grid-cols-1', '2': 'grid-cols-2', '3': 'grid-cols-3',
  '4': 'grid-cols-4', '5': 'grid-cols-5', '6': 'grid-cols-6',
} as const;

const SPAN = {
  '1': 'col-span-1', '2': 'col-span-2', '3': 'col-span-3',
  '4': 'col-span-4', '5': 'col-span-5', '6': 'col-span-6', full: 'col-span-full',
} as const;

const TONE = {
  plain: '',
  surface: '',
  accent: 'bg-[var(--accent)]',
  danger: 'bg-[var(--danger)]',
  positive: 'bg-[var(--positive)]',
} as const;

type Gap = keyof typeof GAP;
type Pad = keyof typeof PAD;
type Align = keyof typeof ALIGN;
type Justify = keyof typeof JUSTIFY;
type Cols = keyof typeof COLS;
type Span = keyof typeof SPAN;
type Tone = keyof typeof TONE;

const pick = <T extends Record<string, string>>(table: T, value: unknown, fallback: keyof T) =>
  table[(typeof value === 'string' && value in table ? value : fallback) as keyof T];

interface BoxProps {
  children?: ReactNode;
  gap?: Gap;
  pad?: Pad;
  align?: Align;
  justify?: Justify;
  wrap?: string;
}

/** Horizontal flex. `<Row gap="md" align="center">` */
export function Row({ children, gap, align, justify, pad, wrap }: BoxProps) {
  return (
    <div className={['flex min-w-0 max-w-full', wrap === 'false' ? 'flex-nowrap' : 'flex-wrap',
      pick(GAP, gap, 'md'), pick(ALIGN, align, 'stretch'), pick(JUSTIFY, justify, 'start'),
      pick(PAD, pad, 'none')].join(' ')}>
      {children}
    </div>
  );
}

/** Vertical flex. `<Col gap="sm">` */
export function Col({ children, gap, align, justify, pad }: BoxProps) {
  return (
    <div className={['flex min-w-0 max-w-full flex-col', pick(GAP, gap, 'sm'), pick(ALIGN, align, 'stretch'),
      pick(JUSTIFY, justify, 'start'), pick(PAD, pad, 'none')].join(' ')}>
      {children}
    </div>
  );
}

/**
 * CSS grid. `<Grid cols="3" gap="md">`
 *
 * Without `cols` it is responsive by intrinsic size rather than by breakpoint —
 * a note renders in a full window, a split pane and a side peek, and none of
 * those widths is the viewport a breakpoint would be measuring.
 */
export function Grid({ children, cols, gap, pad }: BoxProps & { cols?: Cols }) {
  const explicit = typeof cols === 'string' && cols in COLS;
  return (
    <div
      className={['grid min-w-0 max-w-full', explicit ? pick(COLS, cols, '2') : '', pick(GAP, gap, 'md'), pick(PAD, pad, 'none')].join(' ')}
      style={explicit ? undefined : { gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}
    >
      {children}
    </div>
  );
}

/** One grid cell that spans several columns. `<Span cols="2">` */
export function Cell({ children, cols }: { children?: ReactNode; cols?: Span }) {
  return <div className={`min-w-0 break-words ${pick(SPAN, cols, '1')}`}>{children}</div>;
}

/** A bordered panel. `<Card title="Today" tone="accent">` */
export function Card({ children, title, tone, pad }: BoxProps & { title?: ReactNode; tone?: Tone }) {
  const dot = pick(TONE, tone, 'surface');
  return (
    <section className={['mdx-card min-w-0 max-w-full break-words rounded-lg border border-[var(--divider)]', tone === 'plain' ? 'bg-transparent' : 'bg-[var(--surface)]', pick(PAD, pad, 'md')].join(' ')}>
      {title && (
        <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold text-[var(--ink)]">{dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${dot}`} />}{title}</h3>
      )}
      {children}
    </section>
  );
}

/** A number with a label, for a metric strip. `<Stat label="Overdue" value="3" tone="danger">` */
export function Stat({ label, value, tone }: { label?: ReactNode; value?: ReactNode; tone?: Tone }) {
  const dot = pick(TONE, tone, 'surface');
  const ink = tone === 'danger' ? 'text-[var(--danger)]'
    : tone === 'accent' ? 'text-[var(--accent-strong)]'
    : 'text-[var(--ink)]';
  return (
    <div className={['mdx-stat min-w-0 break-words rounded-lg border border-[var(--divider)] p-3', tone === 'plain' ? 'bg-transparent' : 'bg-[var(--surface)]'].join(' ')}>
      <div className={`text-2xl font-semibold tabular-nums ${ink}`}>{value ?? '—'}</div>
      {label && <div className="mt-0.5 flex items-baseline gap-2 text-[13px] font-semibold text-[var(--ink-secondary)]">{dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${dot}`} />}{label}</div>}
    </div>
  );
}

/**
 * A question you answer before you are shown the answer.
 *
 * `<Flashcard front="What does a canonical URL declare?">The URL a page should
 * be indexed under.</Flashcard>`
 *
 * The prompt is an attribute and the answer is the children, which is the right
 * asymmetry rather than an arbitrary one: a prompt is a short line, an answer
 * wants lists, code and emphasis, and only children go back through the
 * Markdown parser.
 *
 * The answer is not in the DOM until it is asked for. Rendering it hidden would
 * put it one "find in page" away, and a flashcard whose answer can be read
 * without revealing it is a paragraph with extra steps.
 */
export function Flashcard({ children, front, frontNode }: { children?: ReactNode; front?: string; frontNode?: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  // frontNode: the same question, editable in place in Live.
  const prompt = frontNode ?? (front?.trim() || 'Untitled card');

  return (
    <section className="my-4 rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-4">
      <p className="text-sm font-medium leading-6 text-[var(--ink)]">{prompt}</p>

      {revealed && (
        <div className="mdx-flashcard-answer mt-3 border-t border-[var(--divider)] pt-3 text-sm leading-6 text-[var(--ink-secondary)]">
          {children ?? <span className="text-[var(--ink-muted)]">This card has no answer yet.</span>}
        </div>
      )}
      <button
        type="button"
        aria-expanded={revealed}
        onClick={() => setRevealed((shown) => !shown)}
        className="interactive mt-3 flex min-h-[var(--control-sm)] items-center gap-1.5 rounded-md border border-[var(--divider)] px-2.5 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
        {revealed ? 'Hide answer' : 'Show answer'}
      </button>
    </section>
  );
}

/** A horizontal rule with an optional caption. `<Divider label="Blocked" />` */
export function Divider({ label }: { label?: ReactNode }) {
  if (!label) return <hr className="my-4 border-[var(--divider)]" />;
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="text-xs text-[var(--ink-muted)]">{label}</span>
      <hr className="flex-1 border-[var(--divider)]" />
    </div>
  );
}
