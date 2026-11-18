import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Stat } from './mdx-layout';
import { useFileWriter } from './db/table-kit';
import { serializeDb } from '../lib/db';
import { csvReadOnlyReason } from '../lib/csv';
import { tableMetaPath } from '../lib/csv-table';
import {
  appendCsvRow, appendDbRow, filterRows, findColumn, formatNumber, groupByDate, groupRows, measureFrom, measureRows, parseSource,
  parseWhere, pickDbTable, readCsvTable, titleColumn, type DataColumn, type DataTable, type DateStep, type FieldValue, type Group, type SourceRef,
} from '../lib/data-query';

// The data blocks of an MDX page: a Stat that counts, a Chart, and a Form that
// adds a row. Each names its table with source/table/where (lib/data-query),
// reads it through readNote like DbView, and follows it as it changes on disk.

export type SourceState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; ref: SourceRef; data: DataTable; managed: boolean; readOnly: string | null };

const isError = (text: unknown) => typeof text !== 'string' || text.startsWith('Error:');

function stateFrom(ref: SourceRef, text: string, metaText: string | null): SourceState {
  if (isError(text)) return { status: 'error', error: `No file at ${ref.path}.` };
  if (ref.kind === 'db') {
    const picked = pickDbTable(text, ref.path, ref.table);
    return 'error' in picked ? { status: 'error', error: picked.error } : { status: 'ready', ref, data: picked.data, managed: true, readOnly: null };
  }
  const meta = metaText === null || isError(metaText) ? null : metaText;
  const { csv, data } = readCsvTable(text, meta);
  return { status: 'ready', ref, data, managed: meta !== null, readOnly: csvReadOnlyReason(text, csv.rows.length) };
}

/** A source's table, reloaded whenever its file (or a CSV's metadata) changes. */
export function useDataSource(source: string | undefined, table: string | undefined): SourceState {
  const ref = useMemo(() => parseSource(source, table), [source, table]);
  const key = 'error' in ref ? 'error:' + ref.error : `${ref.kind}:${ref.path}:${ref.table ?? ''}`;
  const [state, setState] = useState<SourceState>({ status: 'loading' });
  useEffect(() => {
    if ('error' in ref) { setState({ status: 'error', error: ref.error }); return; }
    const api = window.electronAPI;
    if (!api) { setState({ status: 'error', error: 'Data is only available in the app.' }); return; }
    let alive = true;
    let sequence = 0;
    const metaPath = ref.kind === 'csv' ? tableMetaPath(ref.path) : null;
    const load = () => {
      const mine = ++sequence;
      void Promise.all([api.readNote(ref.path), metaPath ? api.readNote(metaPath) : Promise.resolve(null)])
        .then(([text, metaText]) => { if (alive && mine === sequence) setState(stateFrom(ref, text, metaText)); })
        .catch((error: unknown) => { if (alive && mine === sequence) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) }); });
    };
    load();
    const off = api.onNotesChanged((_event, changed) => {
      if (changed === ref.path || changed === metaPath || ref.path.startsWith(changed + '/')) load();
    });
    return () => { alive = false; off(); };
  }, [key]);
  return state;
}

type DataAttrs = Record<string, string | undefined>;

/** Rows after `where`, or the first thing that went wrong. */
function useRows(attrs: DataAttrs) {
  const state = useDataSource(attrs.source, attrs.table);
  if (state.status !== 'ready') return { state, rows: null, error: state.status === 'error' ? state.error : null };
  const where = parseWhere(attrs.where);
  const filtered = filterRows(state.data, where.conditions);
  const error = [...where.errors, ...filtered.errors][0] ?? null;
  return { state, rows: filtered.rows, error };
}

// --- Stat ------------------------------------------------------------------------

/** `<Stat label="Done" source="Planner.db" table="tasks" where="status = done" />` */
export function DataStat({ label, tone, ...attrs }: DataAttrs & { label?: ReactNode; tone?: string }) {
  const { state, rows, error } = useRows(attrs);
  const value = state.status === 'ready' && rows && !error ? measureRows(state.data, rows, measureFrom(attrs)) : null;
  return (
    <Stat
      label={label}
      tone={tone as never}
      busy={state.status === 'loading'}
      message={error ?? value?.error}
      value={state.status === 'loading' ? '…' : value ? formatNumber(value.value) : undefined}
    />
  );
}

// --- Chart -----------------------------------------------------------------------

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const AXIS = { fill: 'var(--ink-muted)', fontSize: 11 } as const;
const fit = (text: string, chars: number) => (text.length > chars ? text.slice(0, Math.max(1, chars - 1)) + '…' : text);

/** A round number at or above the largest value, for the top of an axis. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value)!;
  return step * power;
}

/** Without option colours every series is the accent; pie slices step its strength. */
const sliceColor = (group: Group, index: number, own: boolean) =>
  own && group.color ? group.color : `color-mix(in srgb, var(--accent) ${Math.max(28, 100 - index * 14)}%, var(--canvas))`;

function BarChart({ groups, width, own }: { groups: Group[]; width: number; own: boolean }) {
  const row = 24;
  const labelWidth = Math.min(160, Math.max(64, width * 0.32));
  const valueWidth = 44;
  const plot = Math.max(20, width - labelWidth - valueWidth - 8);
  const max = Math.max(...groups.map((g) => g.value), 0) || 1;
  const height = groups.length * row + 4;
  return (
    <svg width={width} height={height} aria-hidden data-chart-plot>
      <line x1={labelWidth} x2={labelWidth} y1={0} y2={height} stroke="var(--divider)" />
      {groups.map((group, i) => {
        const w = (Math.max(0, group.value) / max) * plot;
        const y = i * row + 2;
        return (
          <g key={group.key} data-bar>
            <title>{`${group.label}: ${formatNumber(group.value)}`}</title>
            <text x={labelWidth - 8} y={y + row / 2} textAnchor="end" dominantBaseline="central" {...AXIS}>{fit(group.label, Math.floor(labelWidth / 6.5))}</text>
            <rect x={labelWidth} y={y + 4} width={Math.max(w, group.value > 0 ? 2 : 0)} height={row - 8} rx={3} fill={own && group.color ? group.color : 'var(--accent)'} />
            <text x={labelWidth + w + 6} y={y + row / 2} dominantBaseline="central" {...AXIS} className="tabular-nums">{formatNumber(group.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ groups, width }: { groups: Group[]; width: number }) {
  const height = 200;
  const pad = { left: 40, right: 12, top: 10, bottom: 24 };
  const plotW = Math.max(20, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const top = niceMax(Math.max(...groups.map((g) => g.value), 0));
  const x = (i: number) => pad.left + (groups.length === 1 ? plotW / 2 : (i / (groups.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const every = Math.max(1, Math.ceil(groups.length / Math.max(1, Math.floor(plotW / 64))));
  const path = groups.map((g, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(g.value).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} aria-hidden data-chart-plot>
      {[0, top / 2, top].map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--divider)" />
          <text x={pad.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="central" {...AXIS}>{formatNumber(tick)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {groups.map((g, i) => (
        <g key={g.key} data-point>
          <title>{`${g.label}: ${formatNumber(g.value)}`}</title>
          <circle cx={x(i)} cy={y(g.value)} r={3} fill="var(--canvas)" stroke="var(--accent)" strokeWidth={2} />
          {i % every === 0 && <text x={x(i)} y={height - 6} textAnchor={x(i) > width - 28 ? 'end' : 'middle'} {...AXIS}>{g.label}</text>}
        </g>
      ))}
    </svg>
  );
}

function PieChart({ groups, width, own }: { groups: Group[]; width: number; own: boolean }) {
  const slices = groups.filter((g) => g.value > 0);
  const total = slices.reduce((sum, g) => sum + g.value, 0);
  const size = Math.max(96, Math.min(180, width));
  const r = size / 2;
  let angle = -Math.PI / 2;
  const point = (a: number) => `${(r + r * Math.cos(a)).toFixed(2)},${(r + r * Math.sin(a)).toFixed(2)}`;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg width={size} height={size} aria-hidden data-chart-plot className="shrink-0">
        {slices.map((g, i) => {
          const sweep = (g.value / total) * Math.PI * 2;
          const start = angle;
          angle += sweep;
          const fill = sliceColor(g, i, own);
          return (
            <g key={g.key} data-slice>
              <title>{`${g.label}: ${formatNumber(g.value)}`}</title>
              {slices.length === 1
                ? <circle cx={r} cy={r} r={r} fill={fill} />
                : <path d={`M${r},${r} L${point(start)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(angle)} Z`} fill={fill} stroke="var(--surface)" strokeWidth={1.5} strokeLinejoin="round" />}
            </g>
          );
        })}
      </svg>
      <ul aria-hidden className="min-w-0 space-y-1 text-xs text-[var(--ink-secondary)]">
        {slices.map((g, i) => (
          <li key={g.key} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sliceColor(g, i, own) }} />
            <span className="min-w-0 truncate">{g.label}</span>
            <span className="ml-auto pl-3 tabular-nums text-[var(--ink-muted)]">{formatNumber(g.value)} · {Math.round((g.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CHART_TYPES = new Set(['bar', 'line', 'pie', 'number']);
const STEPS = new Set<DateStep>(['day', 'week', 'month']);

/**
 * `<Chart type="pie" source="Planner.db" table="tasks" group="status" />`,
 * `type="line" x="due" by="week"`, `type="number"`. Drawn in SVG at the width
 * it is given; the numbers are also in a table for screen readers.
 */
export function Chart({ label, raw = {} }: { label?: ReactNode; raw?: DataAttrs }) {
  const type = (raw.type ?? 'bar').trim().toLowerCase();
  const { state, rows, error: rowError } = useRows(raw);
  const [box, width] = useWidth<HTMLDivElement>();
  const captionId = useId();
  const measure = measureFrom(raw);
  const named = raw.label ?? raw.title;

  let error = rowError;
  let groups: Group[] = [];
  let own = false;
  let number: number | null = null;
  if (!CHART_TYPES.has(type)) error = `Unknown chart type "${type}". Use bar, line, pie or number.`;
  else if (state.status === 'ready' && rows && !error) {
    if (type === 'number') {
      const result = measureRows(state.data, rows, measure);
      error = result.error ?? null;
      number = result.value;
    } else if (type === 'line') {
      if (!raw.x) error = 'A line chart needs x="a date column".';
      else {
        const step = (raw.by ?? 'day').trim().toLowerCase() as DateStep;
        const result = groupByDate(state.data, rows, raw.x, STEPS.has(step) ? step : 'day', measure);
        error = result.error ?? null;
        groups = result.groups;
      }
    } else if (!raw.group) error = `A ${type} chart needs group="a column".`;
    else {
      const result = groupRows(state.data, rows, raw.group, measure);
      error = result.error ?? null;
      groups = result.groups;
      own = findColumn(state.data, raw.group)?.type === 'select';
    }
  }

  const empty = type !== 'number' && !groups.some((g) => g.value !== 0);
  const what = measure.kind === 'count' ? 'count' : `${measure.kind} of ${measure.column}`;
  const summary = type === 'number'
    ? `${named ?? 'Number'}: ${formatNumber(number)}`
    : `${type[0].toUpperCase() + type.slice(1)} chart${named ? ` of ${named}` : ''}, ${what}: ${groups.map((g) => `${g.label} ${formatNumber(g.value)}`).join(', ')}.`;

  let body: ReactNode;
  if (state.status === 'loading') body = <div className="py-6 text-xs text-[var(--ink-muted)]" role="status">Loading…</div>;
  else if (error) body = <div className="py-2 text-xs text-[var(--ink-muted)]" data-chart-error>{error}</div>;
  else if (type === 'number') body = <div className="text-3xl font-semibold tabular-nums text-[var(--ink)]" role="img" aria-label={summary} data-chart-number>{formatNumber(number)}</div>;
  else if (empty) body = <div className="py-6 text-xs text-[var(--ink-muted)]">No data yet.</div>;
  else body = (
    <div role="img" aria-label={summary}>
      {width > 0 && (type === 'bar' ? <BarChart groups={groups} width={width} own={own} />
        : type === 'line' ? <LineChart groups={groups} width={width} />
        : <PieChart groups={groups} width={width} own={own} />)}
    </div>
  );

  return (
    <figure className="mdx-chart my-4 min-w-0 rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-3" data-chart={type} aria-labelledby={label ? captionId : undefined}>
      {label && <figcaption id={captionId} className="mb-2 text-[13px] font-semibold text-[var(--ink)]">{label}</figcaption>}
      <div ref={box} className="min-w-0">{body}</div>
      {!error && !empty && type !== 'number' && state.status === 'ready' && (
        <table className="sr-only">
          <caption>{named ?? 'Chart data'}</caption>
          <thead><tr><th scope="col">{type === 'line' ? raw.x : raw.group}</th><th scope="col">{what}</th></tr></thead>
          <tbody>{groups.map((g) => <tr key={g.key}><th scope="row">{g.label}</th><td>{formatNumber(g.value)}</td></tr>)}</tbody>
        </table>
      )}
    </figure>
  );
}

// --- Form ------------------------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 9);

function emptyValues(columns: DataColumn[]): Record<string, FieldValue> {
  return Object.fromEntries(columns.map((c) => [c.id, c.type === 'checkbox' ? false : '']));
}

function Field({ column, value, required, onChange }: { column: DataColumn; value: FieldValue; required: boolean; onChange: (value: FieldValue) => void }) {
  const id = useId();
  const label = <label htmlFor={id} className="text-xs font-medium text-[var(--ink-secondary)]">{column.name}{required && <span aria-hidden className="text-[var(--ink-muted)]"> *</span>}</label>;
  if (column.type === 'checkbox') {
    return (
      <div className="flex items-center gap-2 self-end py-2">
        <Checkbox id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
        {label}
      </div>
    );
  }
  const text = typeof value === 'string' ? value : '';
  const options = column.options ?? [];
  const common = { id, value: text, 'aria-required': required || undefined, className: 'field px-2.5 text-[13px]' };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label}
      {(column.type === 'select' || column.type === 'multiselect') && options.length
        ? (
          <select {...common} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )
        : <input
            {...common}
            type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : column.type === 'url' ? 'url' : 'text'}
            step={column.type === 'number' ? 'any' : undefined}
            placeholder={column.type === 'url' ? 'https://' : undefined}
            onChange={(e) => onChange(e.target.value)}
          />}
    </div>
  );
}

/**
 * `<Form source="Planner.db" table="tasks" fields="title, status, due" submit="Add task" />`
 *
 * Adds one row, written through the same echo-guarded writer as the database
 * and CSV surfaces. The file is read again just before writing, so a row added
 * elsewhere a moment ago is kept.
 */
export function DataForm({ title, raw = {} }: { title?: ReactNode; raw?: DataAttrs }) {
  const state = useDataSource(raw.source, raw.table);
  const ref = state.status === 'ready' ? state.ref : null;
  const writer = useFileWriter(ref?.path ?? '');
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const data = state.status === 'ready' ? state.data : null;
  const requested = (raw.fields ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  const unknown = data ? requested.filter((f) => !findColumn(data, f)) : [];
  const columns = data
    ? (requested.length ? requested.map((f) => findColumn(data, f)).filter((c): c is DataColumn => !!c) : data.columns)
      .filter((c, i, all) => all.indexOf(c) === i)
    : [];
  const title_ = data ? titleColumn(data) : null;

  const shell = (children: ReactNode) => (
    <section className="mdx-form my-4 min-w-0 rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-3"
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {title && <h3 className="mb-2 text-[13px] font-semibold text-[var(--ink)]">{title}</h3>}
      {children}
    </section>
  );

  if (state.status === 'loading') return shell(<div className="text-xs text-[var(--ink-muted)]" role="status">Loading…</div>);
  if (state.status === 'error') return shell(<div className="text-xs text-[var(--ink-muted)]" data-form-error>{state.error}</div>);
  if (state.ref.kind === 'csv' && (!state.managed || state.readOnly)) {
    return shell(<div className="text-xs text-[var(--ink-muted)]" data-form-unmanaged>{state.readOnly ?? 'Convert this CSV to a Neuron table to add rows.'}</div>);
  }
  if (unknown.length) return shell(<div className="text-xs text-[var(--ink-muted)]" data-form-error>No column named "{unknown[0]}".</div>);

  const current = { ...emptyValues(columns), ...values };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    window.clearTimeout(timer.current);
    if (title_ && columns.includes(title_) && !String(current[title_.id] ?? '').trim()) {
      setResult({ ok: false, message: `${title_.name} is required.` });
      return;
    }
    setBusy(true);
    try {
      const api = window.electronAPI;
      const path = state.ref.path;
      const text = await api.readNote(path);
      if (isError(text)) throw new Error(`No file at ${path}.`);
      let next: string;
      if (state.ref.kind === 'db') {
        const picked = pickDbTable(text, path, state.ref.table);
        if ('error' in picked) throw new Error(picked.error);
        next = serializeDb(appendDbRow(picked.db, picked.tableId, current, uid()));
      } else {
        const metaText = await api.readNote(tableMetaPath(path));
        if (isError(metaText)) throw new Error('Convert this CSV to a Neuron table to add rows.');
        const { csv, meta } = readCsvTable(text, metaText);
        const reason = csvReadOnlyReason(text, csv.rows.length);
        if (reason) throw new Error(reason);
        next = appendCsvRow(csv, meta, current);
      }
      if (!(await writer.write(next))) throw new Error(`Couldn't save ${path.split('/').pop()}.`);
      setValues({});
      setResult({ ok: true, message: 'Added.' });
      timer.current = window.setTimeout(() => setResult(null), 3000);
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return shell(
    <form noValidate onSubmit={submit} className="space-y-3" data-form>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))' }}>
        {columns.map((column) => (
          <Field key={column.id} column={column} value={current[column.id]} required={column === title_}
            onChange={(value) => { setValues((prev) => ({ ...prev, [column.id]: value })); if (result && !result.ok) setResult(null); }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>{raw.submit?.trim() || 'Add'}</Button>
        {result && (
          <div role={result.ok ? 'status' : 'alert'} data-callout-kind={result.ok ? 'success' : 'error'}
            className="callout flex items-center gap-2 px-2.5 py-1 text-xs text-[var(--ink)]">
            {result.ok ? <CircleCheck aria-hidden className="callout-icon" strokeWidth={1.75} /> : <CircleX aria-hidden className="callout-icon" strokeWidth={1.75} />}
            {result.message}
          </div>
        )}
      </div>
    </form>,
  );
}
