import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { type KnowledgeGraph, type GraphPreferences, type Positions, physicsSettings } from './knowledge-graph';

/**
 * When the layout stops: after `quietTicks` updates in a row in which no node
 * moved `quietDistance`, after `maxTicks` updates, or after `timeCapMs`,
 * whichever comes first.
 */
export const SETTLE = { quietTicks: 6, quietDistance: 0.02, maxTicks: 120, timeCapMs: 2500 };
export type SettleLimits = typeof SETTLE;

/** What settleLayout needs of a layout: the library worker, or a stand-in in tests. */
export interface RunningLayout { start(): void; kill(): void }
type LayoutOptions = ConstructorParameters<typeof FA2Layout>[1];
export type LayoutFactory = (graph: KnowledgeGraph['graph'], options: LayoutOptions) => RunningLayout;
const forceAtlas2: LayoutFactory = (graph, options) => new FA2Layout(graph, options);

/** The library worker owns physics; this controller only bounds its lifetime. */
export function settleLayout(model: KnowledgeGraph, preferences: GraphPreferences, done: () => void, movable?: Set<string>,
  limits: SettleLimits = SETTLE, createLayout: LayoutFactory = forceAtlas2) {
  const graph = model.graph;
  if (!graph.order) { done(); return () => {}; }
  graph.forEachEdge(edge => graph.setEdgeAttribute(edge, 'weight', preferences.attraction));
  let ticks = 0, quiet = 0, stopped = false;
  const previous: Positions = Object.create(null);
  graph.forEachNode((id, a) => { previous[id] = { x: a.x, y: a.y }; });
  const layout = createLayout(graph, {
    settings: physicsSettings(preferences),
    outputReducer: (id, attrs) => {
      const old = previous[id];
      if ((movable && !movable.has(id)) || graph.getNodeAttribute(id, 'fixed') || !Number.isFinite(attrs.x) || !Number.isFinite(attrs.y)) return { ...attrs, x: old.x, y: old.y };
      return attrs;
    },
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout); graph.off('eachNodeAttributesUpdated', changed); layout.kill(); done();
  };
  const changed = () => {
    let displacement = 0;
    graph.forEachNode((id, a) => {
      const before = previous[id];
      displacement = Math.max(displacement, Math.hypot(a.x - before.x, a.y - before.y));
      previous[id] = { x: a.x, y: a.y };
    });
    quiet = displacement < limits.quietDistance ? quiet + 1 : 0;
    if (++ticks >= limits.maxTicks || quiet >= limits.quietTicks) queueMicrotask(stop);
  };
  const timeout = setTimeout(stop, limits.timeCapMs);
  graph.on('eachNodeAttributesUpdated', changed); layout.start();
  return stop;
}
