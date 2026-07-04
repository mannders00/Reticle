// canvas/Renderer.js
// Translates topology state → DOM. All nodes and groups are HTML divs
// inside World.worldLayer. Edges are SVG paths inside World.edgeSvg.
// One parent, one transform — no drift between layers.

import { svg } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { getTopology, getSelectedIds } from "../core/store.js";
import { isGroupKind } from "./nodes/kinds.js";
import { NodeView } from "./nodes/NodeView.js";
import { GroupView } from "./nodes/GroupView.js";
import { EdgeView } from "./edges/EdgeView.js";

export class Renderer {
  constructor(world) {
    this.world = world;
    this.views = new Map();
    this.edgeViews = new Map();

    // All node + group divs go in worldLayer (HTML).
    this.nodeContainer = world.worldLayer;
    // Edge paths go in the edge SVG (also inside worldLayer).
    this.edgeLayer = world.edgeSvg;

    bus.on("topology:changed", () => this.syncAll());
    bus.on("node:added", ({ id }) => this.addView(getTopology().nodes[id]));
    bus.on("node:removed", ({ id }) => this.removeView(id));
    bus.on("edge:added", ({ id }) => this.addEdgeView(getTopology().edges[id]));
    bus.on("edge:removed", ({ id }) => this.removeEdgeView(id));
    bus.on("edge:meta", ({ id }) => {
      const e = getTopology().edges[id];
      if (e) this.edgeViews.get(id)?.setEdge(e);
    });
    bus.on("node:moved", ({ id }) => { this.views.get(id)?.update(); this.rerouteEdgesFor(id); });
    bus.on("node:resized", ({ id }) => { this.views.get(id)?.update(); this.rerouteEdgesFor(id); });
    bus.on("node:meta", ({ id }) => {
      // A kind change can cross the node/group boundary — swap view types.
      const node = getTopology().nodes[id];
      const v = this.views.get(id);
      if (node && v && isGroupKind(node.kind) !== (v instanceof GroupView)) {
        this.removeView(id);
        this.addView(node);
        this.applySelection();
        return;
      }
      v?.update();
    });
    // Guard: only apply ticks that carry a health payload — a bare {id}
    // tick must never scrub node.health to undefined (setHealth writes
    // onto the SHARED store node object).
    bus.on("health:tick", ({ id, health }) => { if (health) this.views.get(id)?.setHealth(health); });
    // Cron results repaint the card's per-check status strip.
    bus.on("cron:result", ({ server }) => this.views.get(server)?.update());
    bus.on("cron:status", () => { for (const v of this.views.values()) v.update(); });
    bus.on("selection:changed", () => this.applySelection());

    this.syncAll();
  }

  syncAll() {
    const topo = getTopology();
    for (const id of [...this.views.keys()]) {
      if (!topo.nodes[id]) this.removeView(id);
    }
    for (const id of [...this.edgeViews.keys()]) {
      if (!topo.edges[id]) this.removeEdgeView(id);
    }
    const groups = [];
    const nodes = [];
    for (const n of Object.values(topo.nodes)) {
      if (isGroupKind(n.kind)) groups.push(n);
      else nodes.push(n);
    }
    // Bigger groups first so nested groups stack above their parents and
    // their title bars stay reachable.
    groups.sort((a, b) => b.w * b.h - a.w * a.h);
    for (const n of groups) this.addView(n);
    for (const n of nodes) this.addView(n);
    for (const e of Object.values(topo.edges)) this.addEdgeView(e);
    this.applySelection();
  }

  addView(node) {
    if (!node) return;
    let v = this.views.get(node.id);
    if (v) {
      v.node = node;
      v.update();
      return;
    }
    v = isGroupKind(node.kind)
      ? new GroupView(node, this.nodeContainer)
      : new NodeView(node, this.nodeContainer);
    this.views.set(node.id, v);
  }

  removeView(id) {
    const v = this.views.get(id);
    if (!v) return;
    v.destroy();
    this.views.delete(id);
  }

  addEdgeView(edge) {
    if (!edge) return;
    let v = this.edgeViews.get(edge.id);
    if (v) {
      v.setEdge(edge);
      return;
    }
    v = new EdgeView(edge, this.edgeLayer);
    this.edgeViews.set(edge.id, v);
  }

  removeEdgeView(id) {
    const v = this.edgeViews.get(id);
    if (!v) return;
    v.destroy();
    this.edgeViews.delete(id);
  }

  rerouteEdgesFor(nodeId) {
    const topo = getTopology();
    for (const e of Object.values(topo.edges)) {
      if (e.from === nodeId || e.to === nodeId) {
        this.edgeViews.get(e.id)?.reroute();
      }
    }
  }

  applySelection() {
    const sel = new Set(getSelectedIds());
    for (const [id, v] of this.views) v.setSelected(sel.has(id));
    for (const [id, v] of this.edgeViews) v.setSelected(sel.has(id));
  }
}