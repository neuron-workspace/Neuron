import { useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import { LocateFixed, RotateCcw, Search, Settings2, Share2 } from 'lucide-react';
import { type GraphNode, type GraphEdge, KnowledgeGraph, GRAPH_DEFAULTS, GRAPH_RANGES, graphPreferences, seedPositions, type GraphPreferences, type Positions } from '../lib/knowledge-graph';
import { settleLayout } from '../lib/graph-layout';
import { fitCamera } from '../lib/graph-fit';
import type { GraphCanvasProps } from './GraphCanvas';

const labels = { gravity: 'Centre / gravity', repel: 'Repel', attraction: 'Link attraction', distance: 'Link distance', nodeSize: 'Node size', linkThickness: 'Link thickness', labelThreshold: 'Label fade threshold', depth: 'Steps from this note' };
const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
// Links are the muted ink at low strength: visible as structure, never louder than a node.
const fade = (hex: string, alpha: number) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})` : hex;
};
const readColors = () => {
  const style = getComputedStyle(document.documentElement);
  const get = (key: string) => style.getPropertyValue(key).trim();
  return { accent: get('--accent'), ink: get('--ink'), label: get('--ink-secondary'), muted: get('--ink-muted'), faint: get('--surface-hover'), edge: fade(get('--ink-muted'), 0.55) };
};

export default function SigmaGraph(props: GraphCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const model = useRef(new KnowledgeGraph());
  // Carries the same attribute types as the graph it renders. Bare `Sigma`
  // defaults its generics to graphology's open `Attributes`, which does not
  // accept the typed node/edge payloads the reducers below read -- so the ref
  // and the instance it holds disagreed.
  const renderer = useRef<Sigma<GraphNode, GraphEdge> | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const userNavigated = useRef(false);
  const positions = useRef<Positions>(Object.create(null));
  const latest = useRef(props); latest.current = props;
  const pref = useRef<GraphPreferences>({ ...GRAPH_DEFAULTS });
  const [preferences, setPreferences] = useState(pref.current);
  const [key, setKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const hovered = useRef<string | null>(null);
  const relatedNodes = useRef(new Set<string>());
  const filter = useRef<Set<string> | null>(null);
  const queryRef = useRef(''); queryRef.current = query || props.searchQuery || '';
  const colors = useRef(readColors());

  const save = () => {
    if (!key || (!model.current.graph.order && Object.keys(positions.current).length)) return;
    const saved: Positions = Object.create(null);
    model.current.graph.forEachNode((id, a) => { saved[id] = { x: a.x, y: a.y }; });
    positions.current = saved;
    void window.electronAPI.settings.set(key, { preferences: pref.current, positions: saved }).then(result => {
      if (!result.success) setError('Could not save connection settings.');
    }).catch(() => setError('Could not save connection settings.'));
  };
  const saveRef = useRef(save); saveRef.current = save;
  const reheat = (movable?: Set<string>, then?: () => void) => {
    stop.current?.();
    setRunning(true);
    try {
      stop.current = settleLayout(model.current, pref.current, () => { setRunning(false); saveRef.current(); then?.(); }, movable);
    } catch {
      setRunning(false);
      setError('Layout could not start. Saved positions are still available.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repo = await window.electronAPI.getNotesDirectory();
      const storageKey = `graph:v1:${repo ?? ''}`;
      const stored = await window.electronAPI.settings.get<{ preferences?: unknown; positions?: Positions }>(storageKey);
      if (cancelled) return;
      pref.current = graphPreferences(stored?.preferences);
      setPreferences(pref.current);
      positions.current = Object.create(null);
      if (stored?.positions && typeof stored.positions === 'object') {
        for (const [id, point] of Object.entries(stored.positions)) {
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 1e9 && Math.abs(point.y) < 1e9) positions.current[id] = { x: point.x, y: point.y };
        }
      }
      setKey(storageKey);
    })().catch(() => { if (!cancelled) setError('Could not load connection settings.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!key || !host.current) return;
    const graph = model.current.graph;
    let sigma: Sigma<GraphNode, GraphEdge>;
    try {
    sigma = new Sigma(graph, host.current, {
      allowInvalidContainer: true, stagePadding: 40, labelSize: 11, zIndex: true, labelDensity: props.compact ? 0.3 : 0.7,
      labelRenderedSizeThreshold: 0, minCameraRatio: 0.03, maxCameraRatio: 8,
      labelFont: getComputedStyle(document.body).fontFamily,
      // Labels sit centred under their node and fade out as the view zooms
      // away, so a large graph reads as a shape first and names second.
      defaultDrawNodeLabel: (ctx, data, settings) => {
        if (!data.label) return;
        const ratio = sigma.getCamera().ratio;
        const alpha = data.forceLabel ? 1 : Math.max(0, Math.min(1, (pref.current.labelThreshold - ratio) * 3 + 0.5));
        if (!alpha) return;
        ctx.globalAlpha = alpha; ctx.fillStyle = data.forceLabel ? colors.current.ink : colors.current.label;
        ctx.font = `${data.forceLabel ? 500 : 400} ${settings.labelSize}px ${settings.labelFont}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(data.label, data.x, data.y + data.size + 4);
        ctx.globalAlpha = 1; ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      },
      // A quiet ring instead of Sigma's boxed, shadowed hover label.
      defaultDrawNodeHover: (ctx, data) => {
        ctx.beginPath(); ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
        ctx.strokeStyle = colors.current.accent; ctx.lineWidth = 1.5; ctx.stroke();
      },
      nodeReducer: (id, attrs) => {
        const p = pref.current;
        const active = id === latest.current.selectedNote;
        const related = !hovered.current || relatedNodes.current.has(id);
        const matches = !queryRef.current || attrs.label.toLowerCase().includes(queryRef.current.toLowerCase());
        return { ...attrs, size: p.nodeSize + Math.min(7, Math.sqrt(attrs.degree) * 1.2) + (active ? 2 : 0),
          color: !related || !matches ? colors.current.faint : active || id === hovered.current ? colors.current.accent : colors.current.muted,
          label: attrs.kind === 'unresolved' ? `${attrs.label} (missing)` : attrs.label,
          forceLabel: active || id === hovered.current,
          hidden: (!!filter.current && !filter.current.has(id)) || (!p.orphans && attrs.degree === 0) || (!p.unresolved && attrs.kind === 'unresolved'),
        };
      },
      edgeReducer: (id, attrs) => {
        const [a, b] = graph.extremities(id);
        const touching = !!hovered.current && (a === hovered.current || b === hovered.current);
        return { ...attrs, type: pref.current.arrows ? 'arrow' : 'line', size: pref.current.linkThickness * (touching ? 1.6 : 1),
          color: touching ? colors.current.accent : hovered.current ? colors.current.faint : colors.current.edge, zIndex: touching ? 1 : 0 };
      },
    });
    } catch {
      setError('Connections could not start. WebGL is unavailable.');
      return;
    }
    renderer.current = sigma;
    // Read-only inspection of the real renderer for development and Electron QA.
    if (import.meta.env.DEV) Object.defineProperty(host.current, 'sigma', { value: sigma, configurable: true });
    let dragged: string | null = null;
    let moved = false;
    sigma.on('enterNode', ({ node }) => { hovered.current = node; relatedNodes.current = new Set([node, ...model.current.neighbours(node)]); sigma.refresh(); });
    sigma.on('leaveNode', () => { hovered.current = null; sigma.refresh(); });
    sigma.on('clickNode', ({ node }) => { if (!moved && graph.getNodeAttribute(node, 'kind') !== 'unresolved') latest.current.onSelectNote(node); });
    sigma.on('downStage', () => { userNavigated.current = true; });
    sigma.getMouseCaptor().on('wheel', () => { userNavigated.current = true; });
    sigma.on('downNode', ({ node }) => {
      userNavigated.current = true; stop.current?.(); dragged = node; moved = false;
      graph.setNodeAttribute(node, 'fixed', true); sigma.setCustomBBox(sigma.getBBox());
    });
    sigma.getMouseCaptor().on('mousemovebody', event => {
      if (!dragged) return;
      moved = true; graph.mergeNodeAttributes(dragged, { ...sigma.viewportToGraph(event) });
      event.preventSigmaDefault(); event.original.preventDefault(); event.original.stopPropagation();
    });
    const release = () => {
      if (!dragged) return;
      graph.setNodeAttribute(dragged, 'fixed', false); dragged = null;
      if (moved) reheat();
    };
    sigma.getMouseCaptor().on('mouseup', release);
    window.addEventListener('blur', release);
    const observer = new MutationObserver(() => { colors.current = readColors(); sigma.refresh(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      stop.current?.(); saveRef.current(); observer.disconnect(); window.removeEventListener('blur', release);
      sigma.kill(); renderer.current = null;
    };
  }, [key]);

  useEffect(() => {
    if (!key || !renderer.current) return;
    stop.current?.();
    model.current.graph.forEachNode((id, a) => { positions.current[id] = { x: a.x, y: a.y }; });
    const changed = model.current.sync(props.notesData);
    const added = seedPositions(model.current, positions.current);
    renderer.current.refresh();
    if (added.length) reheat(added.length === model.current.graph.order ? undefined : new Set(added));
    if (changed) setRevision(r => r + 1);
  }, [props.notesData, key]);

  useEffect(() => {
    const g = model.current.graph;
    filter.current = (preferences.local || props.scope === 'active')
      ? model.current.local(props.selectedNote ?? '', preferences.depth)
      : props.scope === 'folder' ? new Set(g.nodes().filter(id => id.startsWith(props.folder ?? ''))) : null;
    renderer.current?.refresh();
  }, [preferences, props.selectedNote, props.scope, props.folder, revision, query, props.searchQuery]);

  const focus = (id: string) => {
    const sigma = renderer.current;
    if (!sigma || !model.current.graph.hasNode(id)) return;
    sigma.refresh(); const point = sigma.getNodeDisplayData(id);
    if (point) void sigma.getCamera().animate({ x: point.x, y: point.y }, { duration: duration() });
  };
  useEffect(() => {
    userNavigated.current = false;
    if (props.selectedNote) focus(props.selectedNote);
  }, [props.selectedNote, key]);
  useEffect(() => {
    if (!running && !userNavigated.current && props.selectedNote) focus(props.selectedNote);
  }, [revision, running]);

  const apply = (next: GraphPreferences) => { pref.current = next; setPreferences(next); renderer.current?.refresh(); };
  const update = (next: GraphPreferences) => { apply(next); saveRef.current(); };

  // A slider shows its value as it moves, but the picture only reacts when the
  // value is settled (pointer released, or key released). Restarting the layout
  // on every step made the graph thrash while dragging. A change with no
  // gesture around it (assistive tech, a script) is settled at once.
  const gesture = useRef(false);
  const dirty = useRef<string | null>(null);
  const settle = () => {
    gesture.current = false;
    const name = dirty.current;
    dirty.current = null;
    if (!name) return;
    if (['gravity', 'repel', 'attraction', 'distance'].includes(name)) reheat(); else saveRef.current();
  };
  const slide = (name: keyof typeof GRAPH_RANGES, value: number) => {
    apply({ ...pref.current, [name]: value });
    dirty.current = name;
    if (!gesture.current) settle();
  };

  const resetToDefaults = () => {
    stop.current?.();
    apply({ ...GRAPH_DEFAULTS });
    positions.current = Object.create(null);
    seedPositions(model.current, positions.current);
    renderer.current?.setCustomBBox(null);
    renderer.current?.refresh();
    saveRef.current();
    fit();
    reheat(undefined, fit);
  };
  const fit = () => {
    const sigma = renderer.current;
    if (!sigma) return;
    userNavigated.current = true; sigma.setCustomBBox(null); sigma.refresh();
    // Display data is in Sigma's framed-graph space, not graph coordinates; see lib/graph-fit.
    const nodes = model.current.graph.nodes().map(id => sigma.getNodeDisplayData(id)).filter((n): n is NonNullable<typeof n> => !!n && !n.hidden);
    const target = fitCamera(nodes, sigma.getDimensions(), (point, cameraState) => sigma.framedGraphToViewport(point, { cameraState }), { maxRatio: 8 });
    if (target) void sigma.getCamera().animate(target, { duration: duration() });
  };
  const matches = model.current.graph.nodes().filter(id => model.current.graph.getNodeAttribute(id, 'kind') !== 'unresolved' && model.current.graph.getNodeAttribute(id, 'label').toLowerCase().includes(query.toLowerCase()));

  // A host can pin the graph to the open note; the switch then shows that, and cannot be changed.
  const forced = props.scope === 'active';
  const aroundNote = forced || preferences.local;
  const emptyAround = aroundNote && !!key && !props.selectedNote;
  const groupHeading = 'text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]';
  const slider = (name: keyof typeof GRAPH_RANGES) => {
    const [min, max, step] = GRAPH_RANGES[name];
    return <label key={name} className="block">
      <span className="flex items-baseline justify-between gap-2">{labels[name]}<output className="tabular-nums text-[var(--ink-muted)]">{preferences[name]}</output></span>
      <input className="mt-1 block w-full accent-[var(--accent)]" type="range" aria-label={labels[name]} min={min} max={max} step={step} value={preferences[name]}
        onPointerDown={() => { gesture.current = true; }} onKeyDown={() => { gesture.current = true; }}
        onPointerUp={settle} onKeyUp={settle}
        onChange={e => slide(name, Number(e.target.value))} />
    </label>;
  };

  return <div className="relative h-full min-h-0 text-[var(--ink)]" data-graph-root data-layout-running={running}>
    <div ref={host} data-graph-canvas className="absolute inset-0" role="img" aria-label={`${model.current.graph.order} nodes in workspace connections`} />
    <div className="absolute left-1.5 top-1.5 flex gap-0.5">
      <button className="tool-button bg-[var(--surface)]" aria-label="Fit connections" title="Fit connections" onClick={fit}><LocateFixed size={14} /></button>
      <button className="tool-button bg-[var(--surface)]" aria-label="Search nodes" title="Search nodes" onClick={() => { setSearching(s => !s); setQuery(''); }}><Search size={14} /></button>
      <button className="tool-button bg-[var(--surface)]" aria-label="Connection settings" title="Connection settings" onClick={() => dialog.current?.showModal()}><Settings2 size={14} /></button>
    </div>
    {searching && <div className="absolute inset-x-2 top-10 max-h-[180px] overflow-auto rounded border border-[var(--divider)] bg-[var(--surface)] p-2 text-xs">
      <input autoFocus aria-label="Find a node" placeholder="Find a note…" value={query} onChange={e => setQuery(e.target.value)} className="w-full bg-transparent p-1" onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); setQuery(''); } }} />
      {matches.slice(0, 30).map(id => <button key={id} className="block w-full truncate rounded p-1 text-left hover:bg-[var(--surface-hover)]" aria-label={`Open ${model.current.graph.getNodeAttribute(id, 'label')}`} onClick={() => { latest.current.onSelectNote(id); focus(id); setSearching(false); setQuery(''); }}>{model.current.graph.getNodeAttribute(id, 'label')}</button>)}
      {!matches.length && <p role="status">No matching notes.</p>}
    </div>}
    {emptyAround && <p className="pointer-events-none absolute inset-x-4 top-1/2 text-center text-xs text-[var(--ink-muted)]">Open a note to see what it links to.</p>}
    {!emptyAround && !model.current.graph.order && key && <p className="pointer-events-none absolute inset-x-4 top-1/2 text-center text-xs text-[var(--ink-muted)]">{props.emptyHint ?? 'Add notes and links to see connections.'}</p>}
    {error && <p role="alert" className="absolute bottom-2 inset-x-2 bg-[var(--surface)] text-xs">{error}</p>}
    <dialog ref={dialog} aria-label="Connection settings" className="m-auto w-[320px] max-w-[90vw] max-h-[85vh] flex-col overflow-hidden rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-0 text-xs text-[var(--ink)] backdrop:bg-black/40 open:flex">
      <div className="shrink-0 px-4 pb-1 pt-4"><strong className="flex items-center gap-2"><Share2 className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />Connections</strong></div>
      {/* The groups scroll when the window is short; the footer stays in reach. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <h3 className={groupHeading}>Show</h3>
        <div>
          <div className="segmented" role="group" aria-label="Show">
            {([false, true] as const).map(local => <button key={String(local)} disabled={forced} aria-pressed={aroundNote === local} onClick={() => update({ ...preferences, local })}>{local ? 'Around this note' : 'Whole workspace'}</button>)}
          </div>
          {forced && <p className="mt-1.5 text-[var(--ink-muted)]">This panel always shows the links around the open note.</p>}
        </div>
        {aroundNote && slider('depth')}
        <div className="flex flex-col gap-2">
          {(['arrows', 'orphans', 'unresolved'] as const).map(name => <label key={name} className="flex items-center gap-2"><input type="checkbox" checked={preferences[name]} onChange={e => update({ ...preferences, [name]: e.target.checked })} />{{ arrows: 'Show arrows', orphans: 'Show unlinked notes', unresolved: 'Show missing links' }[name]}</label>)}
        </div>

        <h3 className={groupHeading + ' mt-1'}>Layout</h3>
        {(['gravity', 'repel', 'attraction', 'distance'] as const).map(slider)}

        <h3 className={groupHeading + ' mt-1'}>Appearance</h3>
        {(['nodeSize', 'linkThickness', 'labelThreshold'] as const).map(slider)}

        <p className="text-[var(--ink-muted)]">Drag a node to arrange it. Positions save after settling.</p>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--divider)] px-4 py-3">
        <button className="tool-button !flex items-center gap-2 !w-auto px-2" onClick={resetToDefaults}><RotateCcw size={14} />Reset to defaults</button>
        <button className="tool-button !w-auto px-3" aria-label="Close connection settings" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  </div>;
}
