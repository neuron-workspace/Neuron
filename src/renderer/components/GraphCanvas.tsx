import { useMemo } from 'react';

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
export default function GraphCanvas({ notesData, onSelectNote, selectedNote, emptyHint }: GraphCanvasProps) {
  const { nodes, links, viewBox } = useMemo(() => {
    const cells = hexSpiral(notesData.length);
    const placed: PlacedNode[] = notesData.map((note, i) => {
      const { q, r } = cells[i];
      const x = HEX * Math.sqrt(3) * (q + r / 2);
      const y = HEX * 1.5 * r;
      return { id: note.path, label: note.path.replace(/\.(md|mdx)$/, ''), x, y, degree: 0 };
    });

    const byLabel = new Map<string, string>();
    placed.forEach((n) => {
      byLabel.set(n.label.toLowerCase(), n.id);
      const base = n.label.split('/').pop()!.toLowerCase();
      if (!byLabel.has(base)) byLabel.set(base, n.id);
    });

    const computedLinks: Link[] = [];
    const degree = new Map<string, number>();
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
    notesData.forEach((note) => {
      const re = /\[\[(.*?)\]\]/g;
      let match;
      while ((match = re.exec(note.content)) !== null) {
        const target = byLabel.get(match[1].trim().toLowerCase());
        if (target && target !== note.path) {
          computedLinks.push({ source: note.path, target });
          bump(note.path);
          bump(target);
        }
      }
    });
    placed.forEach((n) => { n.degree = degree.get(n.id) ?? 0; });

    const pad = 80;
    const xs = placed.map((n) => n.x);
    const ys = placed.map((n) => n.y);
    const minX = Math.min(0, ...xs) - pad;
    const minY = Math.min(0, ...ys) - pad;
    const w = Math.max(...xs, 0) - Math.min(...xs, 0) + pad * 2 || 200;
    const h = Math.max(...ys, 0) - Math.min(...ys, 0) + pad * 2 || 200;

    return { nodes: placed, links: computedLinks, viewBox: `${minX} ${minY} ${w} ${h}` };
  }, [notesData]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

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

  return (
    <div className="relative h-full w-full select-none">
      <svg className="h-full w-full" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {links.map((link, idx) => {
          const s = nodeById.get(link.source);
          const t = nodeById.get(link.target);
          if (!s || !t) return null;
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
              transform={`translate(${node.x}, ${node.y})`}
              className="graph-node cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Open ${node.label}`}
              style={{ opacity: nodeOpacity[tier] }}
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
