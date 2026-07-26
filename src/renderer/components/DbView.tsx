import { useEffect, useMemo, useState } from 'react';
import { Database } from 'lucide-react';

// Read-only inline embed of a .db database inside MDX, via <DbView path="@Foo.db" />.
// It reads the referenced file over the same IPC bridge the DbSurface editor uses
// and re-reads on external change, so an embedded table stays live. The .db JSON
// shape is duplicated here (a small, documented, stable format) rather than shared
// with DbSurface — ponytail: dup the 3 read helpers, extract to db-model.ts if a
// third reader appears.

type PropType = 'text' | 'number' | 'checkbox' | 'date' | 'url' | 'select' | 'multiselect';
interface DbOption { id: string; name: string; color: string }
interface DbProperty { name: string; type: PropType; options?: DbOption[] }
interface DbRow { id: string; values: Record<string, unknown> }
interface DbDoc {
  schema: { order: string[]; properties: Record<string, DbProperty> };
  view?: { groupBy?: string | null };
  rows: DbRow[];
}

export type DbViewMode = 'table' | 'board' | 'card';

function parseDb(text: string): DbDoc | null {
  try {
    const raw = JSON.parse(text) as Partial<DbDoc>;
    if (!raw?.schema?.properties) return null;
    const properties = raw.schema.properties;
    const order = (raw.schema.order ?? Object.keys(properties)).filter((id) => properties[id]);
    for (const id of Object.keys(properties)) if (!order.includes(id)) order.push(id);
    return { schema: { order, properties }, view: raw.view ?? {}, rows: Array.isArray(raw.rows) ? raw.rows : [] };
  } catch {
    return null;
  }
}

function normalizeMode(value: string | undefined): DbViewMode {
  const v = (value ?? '').toLowerCase();
  if (v === 'board' || v === 'kanban') return 'board';
  if (v === 'card' || v === 'cards' || v === 'gallery') return 'card';
  return 'table';
}

function Chip({ option }: { option: DbOption }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: `${option.color}2e`, color: option.color }}>
      {option.name || '…'}
    </span>
  );
}

function cellNodes(prop: DbProperty, value: unknown): React.ReactNode {
  if (value === undefined || value === null || value === '') return <span className="text-[var(--ink-muted)]">—</span>;
  if (prop.type === 'checkbox') return value ? '✓' : <span className="text-[var(--ink-muted)]">—</span>;
  if (prop.type === 'url' && typeof value === 'string') {
    return /^https?:\/\//.test(value)
      ? <a href={value} target="_blank" rel="noreferrer" className="text-[var(--md-link)] underline underline-offset-2">{value}</a>
      : value;
  }
  if (prop.type === 'select') {
    const o = prop.options?.find((x) => x.id === value);
    return o ? <Chip option={o} /> : <span className="text-[var(--ink-muted)]">—</span>;
  }
  if (prop.type === 'multiselect') {
    const ids = Array.isArray(value) ? value : [];
    const chips = (prop.options ?? []).filter((o) => ids.includes(o.id));
    return chips.length ? <span className="flex flex-wrap gap-1">{chips.map((o) => <Chip key={o.id} option={o} />)}</span> : <span className="text-[var(--ink-muted)]">—</span>;
  }
  return String(value);
}

interface DbViewProps { path: string; view?: string }

export default function DbView({ path, view }: DbViewProps) {
  const rel = path.replace(/^@/, '');
  const mode = normalizeMode(view);
  const [doc, setDoc] = useState<DbDoc | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'invalid'>('loading');

  useEffect(() => {
    let alive = true;
    const load = () =>
      window.electronAPI.readNote(rel).then((text) => {
        if (!alive) return;
        if (typeof text !== 'string' || text.startsWith('Error:')) { setState('missing'); setDoc(null); return; }
        const parsed = parseDb(text);
        if (parsed) { setDoc(parsed); setState('ready'); } else { setDoc(null); setState('invalid'); }
      });
    void load();
    const off = window.electronAPI.onNotesChanged((event, changed) => {
      if (changed === rel && event !== 'unlink') void load();
      if (changed === rel && event === 'unlink') { setState('missing'); setDoc(null); }
    });
    return () => { alive = false; off(); };
  }, [rel]);

  const boardGroup = useMemo(() => {
    if (!doc) return null;
    const { order, properties } = doc.schema;
    const wanted = doc.view?.groupBy;
    return (wanted && properties[wanted]?.type === 'select' ? wanted : order.find((pid) => properties[pid].type === 'select')) ?? null;
  }, [doc]);

  if (state !== 'ready' || !doc) {
    const msg = state === 'loading' ? 'Loading database…'
      : state === 'missing' ? `No database found at ${rel}`
      : `${rel} isn't valid database JSON`;
    return (
      <div className="my-4 flex items-center gap-2 rounded-md border border-[var(--divider)] bg-[var(--surface)] px-3 py-2 font-sans text-xs text-[var(--ink-muted)]">
        <Database className="h-3.5 w-3.5 shrink-0" /> {msg}
      </div>
    );
  }

  const { order, properties } = doc.schema;
  const title = rel.split('/').pop()!.replace(/\.db$/i, '');
  const titleProp = order.find((pid) => properties[pid].type === 'text') ?? order[0];

  const header = (
    <div className="mb-2 flex items-center gap-1.5 font-sans text-xs font-medium text-[var(--ink-muted)]">
      <Database className="h-3.5 w-3.5 text-[var(--accent-strong)]" /> {title}
      <span className="ml-auto">{doc.rows.length} rows</span>
    </div>
  );

  if (mode === 'board' && boardGroup) {
    const groupProp = properties[boardGroup];
    return (
      <div className="my-4 font-sans">
        {header}
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {[...(groupProp.options ?? []), null].map((option) => {
            const colId = option?.id ?? '';
            const rows = doc.rows.filter((r) => (r.values[boardGroup] ?? '') === colId);
            if (!option && rows.length === 0) return null;
            return (
              <div key={colId || '__none'} className="w-56 shrink-0 rounded-lg bg-[var(--surface)] p-2">
                <div className="mb-2 flex items-center gap-2 px-1 text-xs">
                  {option ? <Chip option={option} /> : <span className="text-[var(--ink-muted)]">No {groupProp.name.toLowerCase()}</span>}
                  <span className="ml-auto text-[var(--ink-muted)]">{rows.length}</span>
                </div>
                <div className="space-y-1.5">
                  {rows.map((row) => (
                    <div key={row.id} className="rounded-md bg-[var(--canvas)] p-2.5 text-sm text-[var(--md-text)]">
                      <div>{String(row.values[titleProp] ?? '') || 'Untitled'}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {order.filter((pid) => pid !== boardGroup && pid !== titleProp).map((pid) => <span key={pid}>{cellNodes(properties[pid], row.values[pid])}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (mode === 'card') {
    return (
      <div className="my-4 font-sans">
        {header}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {doc.rows.map((row) => (
            <div key={row.id} className="rounded-lg bg-[var(--surface)] p-3">
              <div className="text-sm font-medium text-[var(--md-text)]">{String(row.values[titleProp] ?? '') || 'Untitled'}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {order.filter((pid) => pid !== titleProp).map((pid) => <span key={pid}>{cellNodes(properties[pid], row.values[pid])}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // table (default)
  return (
    <div className="my-4 font-sans">
      {header}
      <div className="overflow-x-auto rounded-md border border-[var(--divider)]">
        <table className="w-full border-collapse text-sm text-[var(--md-text)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              {order.map((pid) => (
                <th key={pid} className="border-b border-[var(--divider)] px-3 py-2 text-left text-xs font-semibold text-[var(--md-heading)]">{properties[pid].name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--divider)] last:border-b-0">
                {order.map((pid) => (
                  <td key={pid} className="px-3 py-2 align-top text-xs leading-5">{cellNodes(properties[pid], row.values[pid])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
