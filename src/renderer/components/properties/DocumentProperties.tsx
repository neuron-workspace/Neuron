import { useId, useMemo, useState, useRef, useEffect } from 'react';
import { ChevronRight, Plus, X, MoreHorizontal, Pencil, Code2, ListTree, Tag, Hash, Type, ToggleLeft, Calendar } from 'lucide-react';
import { CalloutIcon } from '../mdx-components';
import { CHIP_CLASS, formatDate, hostOf } from '../db/DbCards';
import { Checkbox } from '../ui/checkbox';
import {
  parseFrontmatter,
  serializeFrontmatter,
  type DocumentProperty,
  type PropertyType,
  type FrontmatterEntry,
} from '../../lib/frontmatter';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '../ui/dropdown-menu';

export interface DocumentPropertiesProps {
  doc: string;
  onChangeDoc?: (next: string) => void; // omit for read-only (preview / reading)
  onViewRaw?: () => void;                // escape hatch to raw/source editing
  tagSuggestions?: string[];
  onTagClick?: (tag: string) => void;
  removeEmpty?: boolean;                 // setting: strip block when empty
  defaultCollapsed?: boolean;            // collapse state is editor UI state, not saved to the file
  hideWhenEmpty?: boolean;               // setting: no panel when no frontmatter
}

const TYPE_ICON: Record<PropertyType, typeof Type> = {
  text: Type, multiline: Type, number: Hash, boolean: ToggleLeft,
  date: Calendar, datetime: Calendar, tags: Tag, aliases: Tag,
  list: ListTree, link: Type, unknown: Code2,
};

// Suggested property names for the add control (users are not restricted to these).
export const FULL_WIDTH_KEY = /^full[-_]?width$/i;

const SUGGESTED = ['tags', 'aliases', 'status', 'due', 'priority', 'created', 'updated', 'completed'];

export default function DocumentProperties(props: DocumentPropertiesProps) {
  const { doc, onChangeDoc, onViewRaw, tagSuggestions = [], onTagClick, removeEmpty = true, defaultCollapsed = false, hideWhenEmpty = false } = props;
  const parsed = useMemo(() => parseFrontmatter(doc), [doc]);
  const readOnly = !onChangeDoc;
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const props_ = parsed.properties;

  const commit = (entries: FrontmatterEntry[]) => {
    if (!onChangeDoc) return;
    onChangeDoc(serializeFrontmatter(doc, entries, { removeEmpty }));
  };

  const asEntries = (): FrontmatterEntry[] => props_.map((p) => ({ key: p.key, value: p.value }));

  const setValue = (key: string, value: unknown) => commit(asEntries().map((e) => (e.key === key ? { ...e, value } : e)));
  const deleteKey = (key: string) => commit(asEntries().filter((e) => e.key !== key));
  const renameKey = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return;
    if (props_.some((p) => p.key === newKey)) return; // reject duplicate
    commit(asEntries().map((e) => (e.key === oldKey ? { key: newKey, value: e.value } : e)));
  };
  const move = (key: string, dir: -1 | 1) => {
    const entries = asEntries();
    const i = entries.findIndex((e) => e.key === key);
    // Step over the hidden fullWidth entry so "Move up" always moves a visible row.
    let j = i + dir;
    while (entries[j] && FULL_WIDTH_KEY.test(entries[j].key)) j += dir;
    if (i < 0 || j < 0 || j >= entries.length) return;
    [entries[i], entries[j]] = [entries[j], entries[i]];
    commit(entries);
  };
  const addProperty = (key: string, type: PropertyType) => {
    if (!key || props_.some((p) => p.key === key)) { setAdding(false); return; }
    const initial = defaultValueForType(type);
    commit([...asEntries(), { key, value: initial }]);
    setAdding(false);
  };

  // --- Empty / invalid states ------------------------------------------------
  if (!parsed.hasFrontmatter && (hideWhenEmpty || readOnly)) {
    // Reading/preview with no frontmatter: render nothing. Live mode shows the
    // minimal "Add property" affordance below instead.
    if (readOnly || hideWhenEmpty) return null;
  }

  if (parsed.hasFrontmatter && !parsed.valid) {
    return (
      <section className="doc-props callout mx-auto w-full px-3.5 py-3" data-callout-kind="error" aria-label="Document properties (error)">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--ink)]">
          <CalloutIcon kind="error" />
          <span className="font-semibold">Properties can’t be shown — the frontmatter YAML is invalid.</span>
          {onViewRaw && (
            <button className="interactive ml-auto rounded px-2 py-0.5 font-medium underline underline-offset-2 hover:bg-[var(--surface-hover)]" onClick={onViewRaw}>
              Edit as YAML
            </button>
          )}
        </div>
        {parsed.diagnostics[0] && <p className="mt-1 pl-6 text-xs text-[var(--ink-secondary)]">{parsed.diagnostics[0].message}</p>}
      </section>
    );
  }

  // `fullWidth` has its own control in the note header; it is only hidden here,
  // so asEntries() above still carries it through every rewrite.
  const visible = props_.filter((p) => !FULL_WIDTH_KEY.test(p.key));
  const count = visible.length;
  if (readOnly && count === 0) return null;
  const showCollapse = count > 0;
  // One or two rows do not earn a collapsible header.
  const compact = count > 0 && count < 3;

  const controls = !readOnly && (
    <div className={`${compact ? 'flex h-6 justify-end' : 'ml-auto flex items-center'} gap-0.5 opacity-0 group-hover/header:opacity-100 group-focus-within/header:opacity-100`}>
      <button type="button" aria-label="Add property" title="Add property" className="interactive grid h-6 w-6 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setAdding(true)}>
        <Plus className="h-3.5 w-3.5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Properties actions" className="interactive grid h-6 w-6 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" /> Add property</DropdownMenuItem>
          {onViewRaw && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onViewRaw}><Code2 className="mr-2 h-4 w-4" /> Edit as YAML</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <section className="doc-props group/header mx-auto w-full border-b border-[var(--divider)] pb-2" aria-label="Document properties">
      {!compact && (
        <header className="flex min-h-8 items-center gap-1.5">
          <button
            type="button"
            className="interactive flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
            disabled={!showCollapse}
          >
            {showCollapse && <ChevronRight className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} aria-hidden />}
            <span>Properties{count ? ` · ${count}` : ''}</span>
          </button>
          {controls}
        </header>
      )}

      {(compact || !collapsed) && (
        <div>
          {visible.map((p, i) => (
            <PropertyRow
              key={p.key}
              property={p}
              readOnly={readOnly}
              isFirst={i === 0}
              isLast={i === count - 1}
              tagSuggestions={tagSuggestions}
              onTagClick={onTagClick}
              onValue={(v) => setValue(p.key, v)}
              onRename={(nk) => renameKey(p.key, nk)}
              onDelete={() => deleteKey(p.key)}
              onMove={(d) => move(p.key, d)}
              onViewRaw={onViewRaw}
            />
          ))}
          {!readOnly && (adding ? (
            <AddPropertyRow existing={props_.map((p) => p.key)} onAdd={addProperty} onCancel={() => setAdding(false)} />
          ) : count === 0 ? (
            <button type="button" className="interactive flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> Add property
            </button>
          ) : null)}
          {compact && !adding && controls}
        </div>
      )}
    </section>
  );
}

function defaultValueForType(type: PropertyType): unknown {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'tags': case 'aliases': case 'list': return [];
    case 'date': return new Date().toISOString().slice(0, 10);
    default: return '';
  }
}

// ---------------------------------------------------------------------------

interface RowProps {
  property: DocumentProperty;
  readOnly: boolean;
  isFirst: boolean;
  isLast: boolean;
  tagSuggestions: string[];
  onTagClick?: (tag: string) => void;
  onValue: (v: unknown) => void;
  onRename: (newKey: string) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onViewRaw?: () => void;
}

function PropertyRow(p: RowProps) {
  const { property, readOnly } = p;
  const Icon = TYPE_ICON[property.type];
  const [editingKey, setEditingKey] = useState(false);
  const [draftKey, setDraftKey] = useState(property.key);
  useEffect(() => setDraftKey(property.key), [property.key]);
  const inputId = useId();

  return (
    <div className="group flex min-h-8 items-start gap-2 rounded px-1 py-0.5 hover:bg-[var(--surface-hover)]">
      <div className="flex w-40 shrink-0 items-center gap-1.5 pt-1 text-[13px] text-[var(--ink-secondary)]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" aria-hidden />
        {editingKey && !readOnly ? (
          <input
            autoFocus
            className="w-full rounded border border-[var(--accent)] bg-[var(--canvas)] px-1 py-0.5 text-xs text-[var(--ink)] outline-none"
            value={draftKey}
            aria-label="Property name"
            onChange={(e) => setDraftKey(e.target.value)}
            onBlur={() => { setEditingKey(false); p.onRename(draftKey.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraftKey(property.key); setEditingKey(false); } }}
          />
        ) : (
          <button
            type="button"
            className="interactive truncate text-left hover:text-[var(--ink)] disabled:cursor-default"
            title={readOnly ? property.label : 'Rename property'}
            disabled={readOnly}
            onClick={() => setEditingKey(true)}
          >
            {property.label}
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <PropertyValueEditor property={property} readOnly={readOnly} inputId={inputId} tagSuggestions={p.tagSuggestions} onTagClick={p.onTagClick} onValue={p.onValue} onViewRaw={p.onViewRaw} />
      </div>

      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Actions for ${property.label}`} className="interactive grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:bg-[var(--surface)] hover:text-[var(--ink)] group-focus-within:opacity-100 group-hover:opacity-100">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={p.isFirst} onSelect={() => p.onMove(-1)}>Move up</DropdownMenuItem>
            <DropdownMenuItem disabled={p.isLast} onSelect={() => p.onMove(1)}>Move down</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditingKey(true)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={p.onDelete} className="text-[var(--danger)] focus:text-[var(--danger)]">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ValueProps {
  property: DocumentProperty;
  readOnly: boolean;
  inputId: string;
  tagSuggestions: string[];
  onTagClick?: (tag: string) => void;
  onValue: (v: unknown) => void;
  onViewRaw?: () => void;
}

const INPUT_CLS = 'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] leading-5 text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--accent)] focus:bg-[var(--canvas)] focus:outline-none';
const VALUE_CLS = 'block w-full min-w-0 whitespace-pre-wrap break-words rounded px-1 py-0.5 text-left text-[13px] leading-5 text-[var(--ink)]';

function PropertyValueEditor({ property, readOnly, inputId, tagSuggestions, onTagClick, onValue, onViewRaw }: ValueProps) {
  const { type, value } = property;

  if (type === 'unknown' || !property.editable) {
    return (
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words px-1 py-0.5 font-mono text-xs text-[var(--ink-secondary)]">{formatUnknown(value)}</pre>
        {!readOnly && onViewRaw && <button type="button" className="interactive shrink-0 rounded px-1.5 py-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={onViewRaw}>Edit as YAML</button>}
      </div>
    );
  }

  if (type === 'boolean') {
    return (
      <label className="flex items-center gap-2 px-1 py-0.5 text-[13px] text-[var(--ink)]">
        <Checkbox id={inputId} className="shadow-none" checked={!!value} disabled={readOnly} onCheckedChange={(checked) => onValue(checked === true)} aria-label={property.label} />
        <span>{value ? 'Yes' : 'No'}</span>
      </label>
    );
  }

  if (type === 'tags' || type === 'aliases' || type === 'list') {
    return <ChipEditor id={inputId} values={Array.isArray(value) ? (value as string[]) : []} readOnly={readOnly} suggestions={type === 'tags' ? tagSuggestions : []} onTagClick={type === 'tags' ? onTagClick : undefined} onChange={onValue} label={property.label} />;
  }

  if (type === 'number') {
    return <NumberEditor id={inputId} value={typeof value === 'number' ? value : Number(value) || 0} readOnly={readOnly} onChange={onValue} label={property.label} />;
  }

  if (type === 'date') {
    const dateStr = typeof value === 'string' ? value : '';
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    if (valid || !dateStr) {
      return <TextEditor id={inputId} type="date" value={dateStr} readOnly={readOnly} onChange={onValue} label={property.label} />;
    }
    // Non-ISO date value: fall back to text so we never mangle it.
    return <TextEditor id={inputId} value={dateStr} readOnly={readOnly} onChange={onValue} label={property.label} />;
  }

  if (type === 'multiline') {
    return <MultilineEditor id={inputId} value={String(value ?? '')} readOnly={readOnly} onChange={onValue} label={property.label} />;
  }

  // text + link
  return <TextEditor id={inputId} value={String(value ?? '')} readOnly={readOnly} onChange={onValue} label={property.label} />;
}

function formatUnknown(value: unknown): string {
  if (value === null) return 'null';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

// Text: local draft, commit on blur / Enter (avoids caret jumps + churn).
function TextEditor({ id, value, readOnly, onChange, label, type = 'text' }: { id: string; value: string; readOnly: boolean; onChange: (v: string) => void; label: string; type?: 'text' | 'date' }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(value), [value]);
  if (!editing || readOnly) {
    const display = value ? (type === 'date' ? formatDate(value) : value) : <span className="text-[var(--ink-muted)]">Empty</span>;
    if (/^https?:\/\//i.test(value)) {
      return <div className="flex min-w-0 items-start gap-1">
        <a href={value} target="_blank" rel="noreferrer" title={value} className={`${VALUE_CLS} interactive text-[var(--accent-strong)] underline underline-offset-2`}>{hostOf(value)}</a>
        {!readOnly && <button type="button" aria-label={label} title={`Edit ${label}`} className="interactive shrink-0 rounded p-1 text-[var(--ink-muted)]" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /></button>}
      </div>;
    }
    return readOnly ? <div className={VALUE_CLS} aria-label={label}>{display}</div>
      : <button type="button" className={`${VALUE_CLS} interactive`} aria-label={label} onClick={() => setEditing(true)}>{display}</button>;
  }
  return (
    <input
      autoFocus
      type={type}
      id={id}
      className={INPUT_CLS}
      value={draft}
      disabled={readOnly}
      aria-label={label}
      placeholder="Empty"
      onChange={(e) => { setDraft(e.target.value); if (type === 'date') onChange(e.target.value); }}
      onBlur={() => { setEditing(false); if (draft !== value) onChange(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function MultilineEditor({ id, value, readOnly, onChange, label }: { id: string; value: string; readOnly: boolean; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(value), [value]);
  if (!editing || readOnly) {
    const display = value || <span className="text-[var(--ink-muted)]">Empty</span>;
    return readOnly ? <div className={VALUE_CLS} aria-label={label}>{display}</div>
      : <button type="button" className={`${VALUE_CLS} interactive`} aria-label={label} onClick={() => setEditing(true)}>{display}</button>;
  }
  return (
    <textarea
      autoFocus
      id={id}
      rows={Math.min(8, Math.max(2, draft.split('\n').length))}
      className={`${INPUT_CLS} resize-y font-sans leading-5`}
      value={draft}
      disabled={readOnly}
      aria-label={label}
      placeholder="Empty"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onChange(draft); }}
    />
  );
}

function NumberEditor({ id, value, readOnly, onChange, label }: { id: string; value: number; readOnly: boolean; onChange: (v: number) => void; label: string }) {
  // Keep a string draft so partial input ("1.", "-") doesn't get coerced away.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={`${INPUT_CLS} tabular-nums`}
      value={draft}
      disabled={readOnly}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const n = Number(draft); if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onChange(n); else setDraft(String(value)); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function ChipEditor({ id, values, readOnly, suggestions, onTagClick, onChange, label }: { id: string; values: string[]; readOnly: boolean; suggestions: string[]; onTagClick?: (t: string) => void; onChange: (v: string[]) => void; label: string }) {
  const [draft, setDraft] = useState('');
  const listId = `${id}-suggest`;
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((v) => (
        <span key={v} className={`${CHIP_CLASS} inline-flex max-w-full items-center gap-1 bg-[color-mix(in_srgb,var(--ink-secondary)_18%,transparent)] text-[var(--ink-secondary)]`}>
          {onTagClick ? (
            <button type="button" className="interactive min-w-0 break-words hover:text-[var(--accent-strong)]" onClick={() => onTagClick(v)} title={`Search #${v}`}>{v}</button>
          ) : <span className="min-w-0 break-words">{v}</span>}
          {!readOnly && (
            <button type="button" aria-label={`Remove ${v}`} className="interactive shrink-0 text-[var(--ink-muted)] hover:text-[var(--danger)]" onClick={() => onChange(values.filter((x) => x !== v))}>
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {readOnly && values.length === 0 && <span className="px-1 py-0.5 text-[13px] text-[var(--ink-muted)]">Empty</span>}
      {!readOnly && (
        <>
          <input
            id={id}
            list={suggestions.length ? listId : undefined}
            className="interactive min-w-0 basis-24 flex-1 rounded bg-transparent px-1 py-0.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-muted)]"
            value={draft}
            aria-label={`Add to ${label}`}
            placeholder={values.length ? 'Add…' : 'Empty'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={() => add(draft)}
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          )}
        </>
      )}
    </div>
  );
}

function AddPropertyRow({ existing, onAdd, onCancel }: { existing: string[]; onAdd: (key: string, type: PropertyType) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PropertyType>('text');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const duplicate = existing.includes(name.trim());
  const invalid = name.trim() === '' || duplicate;
  const submit = () => { if (!invalid) onAdd(name.trim(), type); };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--divider)] bg-[var(--surface-hover)] px-3 py-2">
      <input
        ref={ref}
        list="prop-name-suggest"
        className={`${INPUT_CLS} w-40`}
        placeholder="Property name"
        aria-label="New property name"
        aria-invalid={duplicate}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
      />
      <datalist id="prop-name-suggest">{SUGGESTED.filter((s) => !existing.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
      <select className={`${INPUT_CLS} w-32`} aria-label="Property type" value={type} onChange={(e) => setType(e.target.value as PropertyType)}>
        <option value="text">Text</option>
        <option value="multiline">Long text</option>
        <option value="number">Number</option>
        <option value="boolean">Checkbox</option>
        <option value="date">Date</option>
        <option value="tags">Tags</option>
        <option value="list">List</option>
      </select>
      <button type="button" className="interactive rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[var(--canvas)] disabled:opacity-50" disabled={invalid} onClick={submit}>Add</button>
      <button type="button" className="interactive rounded px-2 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={onCancel}>Cancel</button>
      {duplicate && <span role="alert" className="w-full text-[11px] text-[var(--danger)]">A property named “{name.trim()}” already exists.</span>}
    </div>
  );
}
