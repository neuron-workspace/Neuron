import { useEffect, useMemo, useRef, useState } from 'react';
import { searchPaths } from '../lib/search';

export interface NoteData {
  path: string;
  content: string;
}

interface PlacedNode {
  id: string;
  label: string;
  x: number;
  y: number;
  degree: number;
}

interface Link {
  source: string;
  target: string;
}

interface GraphCanvasProps {
  /** Notes to map. Nodes are these notes; links are wiki-links between them. */
  notesData: NoteData[];
  onSelectNote: (note: string) => void;
  selectedNote: string | null;
  /**
   * When set, the graph becomes a lens on the search rather than a filtered
   * list: matches stay lit and everything else recedes, so you can see where in
   * the workspace the answer lives.
   */
  searchQuery?: string;
  /** Optional empty-state hint. */
  emptyHint?: string;
}

const HEX = 46; // distance unit between hex cells

/**
 * Axial hex-spiral coordinates for `count` cells, starting at the center and
 * winding outward ring by ring. Deterministic — the layout is identical every
 * render, so the graph is stable from the first frame (no force simulation).
 */
function hexSpiral(count: number): Array<{ q: number; r: number }> {
  const dirs = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ];
  const cells: Array<{ q: number; r: number }> = [{ q: 0, r: 0 }];
  let ring = 1;
  while (cells.length < count) {
    let q = dirs[4][0] * ring;
    let r = dirs[4][1] * ring;
    for (let side = 0; side < 6 && cells.length < count; side++) {
      for (let step = 0; step < ring && cells.length < count; step++) {
        cells.push({ q, r });
        q += dirs[side][0];
        r += dirs[side][1];
      }
    }
    ring++;
  }
  return cells;
}

// Node radius grows with degree (link count) so hubs read as more important.
function radiusFor(degree: number): number {
  return 4.5 + Math.min(8, Math.sqrt(degree) * 2);
}

/**
 * Wiki-link graph on a deterministic hex lattice. Theme-aware (CSS variables),
 * node size scales with link count, and — when a note is active — the graph
 * focuses attention in three tiers: the active note is highlighted, its directly
 * connected notes stay a step lighter, and the rest of the graph dims but stays
 * visible so the wider structure is never lost.
 */
export default function GraphCanvas({ notesData, onSelectNote, selectedNote, searchQuery, emptyHint }: GraphCanvasProps) {
  const { nodes, links, extent } = useMemo(() => {
    // Links first, because placement depends on them. Previously nodes were
    // laid out in array order and the links were derived afterwards, so two
    // notes that link to each other could land on opposite sides of the
    // lattice -- the reason connected notes did not fit in the window together.
    const byLabel = new Map<string, string>();
    notesData.forEach((note) => {
      const label = note.path.replace(/\.(md|mdx)$/, '');
      byLabel.set(label.toLowerCase(), note.path);
      const base = label.split('/').pop()!.toLowerCase();
      if (!byLabel.has(base)) byLabel.set(base, note.path);
    });

    const computedLinks: Link[] = [];
    const degree = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a)!.add(b);
    };
    notesData.forEach((note) => {
      const re = /\[\[(.*?)\]\]/g;
      let match;
      while ((match = re.exec(note.content)) !== null) {
        const target = byLabel.get(match[1].trim().toLowerCase());
        if (target && target !== note.path) {
          computedLinks.push({ source: note.path, target });
          degree.set(note.path, (degree.get(note.path) ?? 0) + 1);
          degree.set(target, (degree.get(target) ?? 0) + 1);
          link(note.path, target);
          link(target, note.path);
        }
      }
    });

    // Breadth-first from the open note, so cell 0 of the spiral is that note,
    // its direct links take the first ring, theirs the next, and unconnected
    // notes fill the outside. Everything is still drawn; what changes is that
    // the notes you care about are adjacent instead of scattered.
    const order: string[] = [];
    const seen = new Set<string>();
    const queue: string[] = [];
    if (selectedNote && notesData.some((n) => n.path === selectedNote)) {
      queue.push(selectedNote);
      seen.add(selectedNote);
    }
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      // Denser neighbours first, so hubs sit near the centre of their ring.
      const next = [...(adjacency.get(id) ?? [])]
        .filter((n) => !seen.has(n))
        .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
      for (const n of next) { seen.add(n); queue.push(n); }
    }
    for (const note of notesData) if (!seen.has(note.path)) order.push(note.path);

    const cells = hexSpiral(order.length);
    const position = new Map<string, { x: number; y: number }>();
    order.forEach((id, i) => {
      const { q, r } = cells[i];
      position.set(id, { x: HEX * Math.sqrt(3) * (q + r / 2), y: HEX * 1.5 * r });
    });

    const placed: PlacedNode[] = notesData.map((note) => {
      const at = position.get(note.path)!;
      return {
        id: note.path,
        label: note.path.replace(/\.(md|mdx)$/, ''),
        x: at.x,
        y: at.y,
        degree: degree.get(note.path) ?? 0,
      };
    });

    const pad = 80;
    const xs = placed.map((n) => n.x);
    const ys = placed.map((n) => n.y);
    const minX = Math.min(0, ...xs) - pad;
    const minY = Math.min(0, ...ys) - pad;
    const w = Math.max(...xs, 0) - Math.min(...xs, 0) + pad * 2 || 200;
    const h = Math.max(...ys, 0) - Math.min(...ys, 0) + pad * 2 || 200;

    return { nodes: placed, links: computedLinks, extent: { minX, minY, w, h } };
  }, [notesData, selectedNote]);

  // Opening a note re-lays the graph out breadth-first from that note, so nodes
  // move. Tweened in JS rather than with a CSS transition because a CSS
  // transform would animate the circles while the links snapped: x1/y1/x2/y2 are
  // not animatable geometry properties. Drawing edges from the same interpolated
  // positions keeps the whole graph moving as one thing.
  const [drawn, setDrawn] = useState<Map<string, { x: number; y: number }>>(new Map());
  const frameRef = useRef(0);

  useEffect(() => {
    const target = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // First paint, or a node set with nothing in common, has nothing to animate
    // from -- tweening in from a stale layout would look like a glitch.
    const from = new Map(drawn);
    const shared = [...target.keys()].filter((id) => from.has(id)).length;
    if (reduced || shared === 0) { setDrawn(target); return; }

    const start = performance.now();
    const DURATION = 320;
    cancelAnimationFrame(frameRef.current);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      // ease-out cubic: most of the distance early, settling gently.
      const e = 1 - Math.pow(1 - t, 3);
      const next = new Map<string, { x: number; y: number }>();
      for (const [id, to] of target) {
        const at = from.get(id);
        next.set(id, at ? { x: at.x + (to.x - at.x) * e, y: at.y + (to.y - at.y) * e } : to);
      }
      setDrawn(next);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
    // `drawn` is the animation's own output; depending on it would restart the
    // tween on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  /** Where a node is being painted right now, mid-tween or at rest. */
  const at = (node: PlacedNode) => drawn.get(node.id) ?? { x: node.x, y: node.y };

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Camera over the fitted extent. scale 1 shows everything; higher zooms in.
  // Selecting a note recentres on it: on a workspace of any size the fitted view
  // makes every node a dot, so you can see the shape but not read it. Panning is
  // left to the user from there rather than snapping back.
  const [cam, setCam] = useState<{ cx: number; cy: number; scale: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const node = selectedNote ? nodeById.get(selectedNote) : undefined;
    if (!node) { setCam(null); return; }
    // 1.6x: with the neighbourhood now laid out around the note rather than
    // scattered, less magnification is needed to read it, and a gentler zoom
    // keeps more of the surrounding shape in view.
    setCam({ cx: node.x, cy: node.y, scale: 1.6 });
  }, [selectedNote, nodeById]);

  const viewBox = useMemo(() => {
    if (!cam) return [extent.minX, extent.minY, extent.w, extent.h].join(' ');
    const w = extent.w / cam.scale;
    const h = extent.h / cam.scale;
    return [cam.cx - w / 2, cam.cy - h / 2, w, h].join(' ');
  }, [cam, extent]);

  const centred = () => ({ cx: extent.minX + extent.w / 2, cy: extent.minY + extent.h / 2, scale: 1 });

  /** Pixels to graph units at the current zoom, so a drag tracks the cursor. */
  const unitsPerPixel = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? (extent.w / (cam?.scale ?? 1)) / rect.width : 1;
  };

  const beginPan = (event: React.PointerEvent<SVGSVGElement>) => {
    // Only the background pans. A press on a node is a click, not a drag.
    if ((event.target as Element).closest('.graph-node')) return;
    const base = cam ?? centred();
    dragRef.current = { x: event.clientX, y: event.clientY, cx: base.cx, cy: base.cy };
    setCam(base);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pan = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const k = unitsPerPixel();
    setCam((prev) => (prev ? {
      ...prev,
      cx: drag.cx - (event.clientX - drag.x) * k,
      cy: drag.cy - (event.clientY - drag.y) * k,
    } : prev));
  };

  const endPan = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* never captured */ }
  };

  const zoom = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setCam((prev) => {
      const base = prev ?? centred();
      // Clamped: below 1 there is nothing further to reveal, and past 8 one node
      // fills the square.
      const scale = Math.min(8, Math.max(1, base.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      return { ...base, scale };
    });
  };

  // Direct neighbours of the active note (either link direction).
  const { hasFocus, neighbours } = useMemo(() => {
    const focus = !!selectedNote && nodeById.has(selectedNote);
    const near = new Set<string>();
    if (focus) {
      for (const l of links) {
        if (l.source === selectedNote) near.add(l.target);
        else if (l.target === selectedNote) near.add(l.source);
      }
    }
    return { hasFocus: focus, neighbours: near };
  }, [selectedNote, links, nodeById]);

  // Labels get noisy on big graphs; when focused, only the neighbourhood keeps
  // its label (others reveal on hover via the .graph-node:hover rule).
  const showAllLabels = nodes.length <= 120;

  // The same ranking the sidebar uses, so the two never disagree about what
  // matched.
  const matched = useMemo(() => {
    const q = (searchQuery ?? '').trim();
    return q ? new Set(searchPaths(notesData, q)) : null;
  }, [notesData, searchQuery]);

  type Tier = 'active' | 'near' | 'far' | 'plain';
  const tierOf = (id: string): Tier => {
    if (!hasFocus) return 'plain';
    if (id === selectedNote) return 'active';
    return neighbours.has(id) ? 'near' : 'far';
  };
  // Every node stays legible. Tiers are carried by COLOUR, not by fading the
  // unconnected ones out -- at 0.32 they read as absent, and the point of a
  // graph is the shape of the whole workspace, not just the current
  // neighbourhood. Opacity now only takes the far tier a shade back.
  const nodeOpacity: Record<Tier, number> = { active: 1, near: 1, far: 0.9, plain: 0.95 };

  // A search is the one case where fading IS the message: the question being
  // asked is "where is this", and a node that does not answer it should get out
  // of the way rather than stay equally legible.
  const opacityFor = (id: string, tier: Tier): number =>
    (matched && !matched.has(id) ? 0.12 : nodeOpacity[tier]);

  return (
    <div className="relative h-full w-full select-none">
      <svg
        ref={svgRef}
        data-graph-canvas
        className="h-full w-full touch-none"
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={beginPan}
        onPointerMove={pan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onWheel={zoom}
      >
        {links.map((link, idx) => {
          const sn = nodeById.get(link.source);
          const tn = nodeById.get(link.target);
          if (!sn || !tn) return null;
          const s = at(sn);
          const t = at(tn);
          const incident = hasFocus && (link.source === selectedNote || link.target === selectedNote);
          const bothNear = hasFocus && !incident
            && (link.source === selectedNote || neighbours.has(link.source))
            && (link.target === selectedNote || neighbours.has(link.target));
          const stroke = incident ? 'var(--accent)' : 'var(--divider)';
          // Distant links stay faintly drawn rather than vanishing: the overall
          // structure is information even when one note has focus.
          const opacity = !hasFocus ? 0.55 : incident ? 0.9 : bothNear ? 0.5 : 0.28;
          const width = incident ? 1.75 : 1.1;
          return (
            <line
              key={`link-${idx}`}
              x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke={stroke}
              strokeWidth={width}
              style={{ opacity }}
            />
          );
        })}

        {nodes.map((node) => {
          const tier = tierOf(node.id);
          const r = radiusFor(node.degree) + (tier === 'active' ? 1.5 : 0);
          const isActive = tier === 'active';
          // Three tiers, all from theme tokens so they follow every preset:
          // the selected note carries the accent, its neighbours the full ink,
          // and everything else the muted ink. Never a literal white or grey.
          const ringStroke = isActive ? 'var(--accent-strong)'
            : tier === 'near' ? 'var(--ink)'
            : 'var(--ink-muted)';
          const fill = isActive ? 'color-mix(in oklch, var(--accent) 24%, var(--surface))' : 'var(--surface)';
          const dotFill = isActive ? 'var(--accent-strong)' : tier === 'near' ? 'var(--ink)' : 'var(--ink-muted)';
          const showLabel = showAllLabels || tier === 'active' || tier === 'near';
          return (
            <g
              key={node.id}
              transform={`translate(${at(node).x}, ${at(node).y})`}
              className="graph-node cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Open ${node.label}`}
              style={{ opacity: opacityFor(node.id, tier) }}
              onClick={() => onSelectNote(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectNote(node.id);
                }
              }}
            >
              <title>{`${node.label.split('/').pop()} — ${node.degree} link${node.degree === 1 ? '' : 's'}`}</title>
              {isActive && <circle r={r + 7} fill="var(--accent)" style={{ opacity: 0.12 }} />}
              <circle r={r} fill={fill} stroke={ringStroke} strokeWidth={isActive ? 2 : 1.25} />
              <circle r={Math.max(1.5, r * 0.35)} fill={dotFill} />
              {showLabel && (
                <text
                  y={-(r + 7)}
                  className="pointer-events-none select-none text-center font-mono text-[9px] font-medium"
                  fill={isActive ? 'var(--accent-strong)' : 'var(--ink-secondary)'}
                  textAnchor="middle"
                >
                  {node.label.split('/').pop()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {nodes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-[var(--ink-muted)]">
          {emptyHint ?? 'Create two linked notes to map their relationship.'}
        </div>
      )}
    </div>
  );
}
