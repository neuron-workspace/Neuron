// Framing the graph: the camera that shows every node, with a small margin.
//
// Sigma does not draw graph coordinates. It normalises them into a "framed
// graph" square (0..1 across the larger side of the node extent) and the camera
// lives in that space: ratio 1 shows the whole extent inside the stage padding,
// smaller is closer. Fit used to set the ratio to the shown nodes' extent in
// that space, which ignored the stage padding (40 px of a 246 px panel), the
// panel's shape, and Sigma's aspect correction, so a tall cluster in a wide
// dock could still spill off the top and bottom.
//
// Instead this measures where the nodes land on screen at ratio 1, centred on
// them, and scales from there. With no rotation the camera scales about the
// viewport's centre, so a node's distance from it is its ratio-1 distance over
// the ratio: one division, exact for whatever projection Sigma uses.

export interface Point { x: number; y: number }
export interface CameraTarget { x: number; y: number; ratio: number }
export interface Viewport { width: number; height: number }
/** Sigma's framedGraphToViewport for a given camera state. */
export type Project = (point: Point, camera: CameraTarget & { angle: number }) => Point;

export interface FitOptions {
  /** Pixels left free on every side, so a node's dot is not cut by the edge. */
  margin?: number;
  /** Closest the camera goes, so one node (or two together) is not blown up. */
  minRatio?: number;
  maxRatio?: number;
}

export const FIT_MARGIN = 24;

/** The camera framing `points` (framed-graph coordinates) in `viewport`, or null when there is nothing to frame. */
export function fitCamera(points: readonly Point[], viewport: Viewport, project: Project, options: FitOptions = {}): CameraTarget | null {
  const { margin = FIT_MARGIN, minRatio = 0.1, maxRatio = 8 } = options;
  const shown = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!shown.length || !(viewport.width > 0) || !(viewport.height > 0)) return null;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of shown) {
    xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
  }
  const centre = { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
  const cx = viewport.width / 2, cy = viewport.height / 2;
  // A panel too small for the margin still frames its nodes, edge to edge.
  const halfWidth = cx - margin > 1 ? cx - margin : cx;
  const halfHeight = cy - margin > 1 ? cy - margin : cy;
  let need = 0;
  for (const p of shown) {
    const at = project(p, { ...centre, ratio: 1, angle: 0 });
    need = Math.max(need, Math.abs(at.x - cx) / halfWidth, Math.abs(at.y - cy) / halfHeight);
  }
  return { ...centre, ratio: Math.min(maxRatio, Math.max(minRatio, need)) };
}
